import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = new URL('./data/', import.meta.url);
const DATA_FILE = new URL('./data/game-state.json', import.meta.url);

// Finestra entro cui un telefono è considerato collegato (3 ping persi).
const LINK_TIMEOUT = 15000;
// Un giocatore che mette giù il telefono per un attimo resta parte del round: la squadra
// lo aspetta fino a questa soglia invece di risolvere il turno senza di lui.
const LINK_GRACE = 45000;
// Durata massima di un round: se qualcuno non risponde, il round si chiude comunque.
const ROUND_SECONDS = { recluta: 90, standard: 75, brutale: 60 };

// PLANCIA DI GIOCO // HELIX TOWER LIVELLO 27
// La mappa è una griglia 3x3 di stanze collegate da corridoi: ogni operativo occupa una
// stanza e può muoversi solo verso quelle elencate in `links`. Il combattimento avviene
// esclusivamente fra unità che condividono la stessa stanza.
const MAP = [
  { id:'A02', name:'CONDOTTI',    col:1, row:1, links:['A01','B07'],             cover:true },
  { id:'B07', name:'SERVER FARM', col:2, row:1, links:['A02','C02','D03'],       node:true },
  { id:'D03', name:'SICUREZZA',   col:3, row:1, links:['B07','C09'],             node:true },
  { id:'A01', name:'ACCESSO',     col:1, row:2, links:['A02','C02','A03'],       exit:true },
  { id:'C02', name:'NEXUS',       col:2, row:2, links:['A01','B07','B04','C09'], exposed:true },
  { id:'C09', name:'LAB NERO',    col:3, row:2, links:['C02','D03','E05'],       vault:true },
  { id:'A03', name:'GARAGE',      col:1, row:3, links:['A01','B04'],             cover:true },
  { id:'B04', name:'ARCHIVIO',    col:2, row:3, links:['A03','C02','E05'],       node:true },
  { id:'E05', name:'PONTE',       col:3, row:3, links:['B04','C09'],             cover:true },
];
const EXIT_ROOM = 'A01';
const NODE_ROOMS = MAP.filter((room) => room.node).map((room) => room.id);
const roomById = (id) => MAP.find((room) => room.id === id) || MAP[0];
const roomLabel = (id) => `${id} // ${roomById(id).name}`;

// Distanze in numero di corridoi da una stanza a tutte le altre (BFS sul grafo della plancia).
function distancesFrom(origin) {
  const dist = { [origin]: 0 };
  const queue = [origin];
  while (queue.length) {
    const current = queue.shift();
    for (const next of roomById(current).links) {
      if (dist[next] === undefined) { dist[next] = dist[current] + 1; queue.push(next); }
    }
  }
  return dist;
}
// Primo passo del percorso più breve: i nemici avanzano di una stanza per round.
function stepToward(from, destination) {
  if (from === destination) return from;
  const dist = distancesFrom(destination);
  let best = from;
  let bestDistance = dist[from] ?? 99;
  for (const next of roomById(from).links) {
    if ((dist[next] ?? 99) < bestDistance) { bestDistance = dist[next]; best = next; }
  }
  return best;
}

const templates = [
  { id:'ghost', callsign:'VEX', role:'GHOST', specialty:'Infiltrazione', color:'#62f4ff', stats:{corpo:5,riflessi:9,mente:7,presenza:4}, maxHp:82, armor:3, focus:7, weapon:'Monofilo VX', ability:'Passo fantasma', abilityText:'Colpisce un ostile nella tua stanza senza allarme e ottiene scudo 8.' },
  { id:'chrome', callsign:'ROOK', role:'CHROME', specialty:'Assalto pesante', color:'#ffcf4a', stats:{corpo:9,riflessi:6,mente:3,presenza:4}, maxHp:112, armor:9, focus:4, weapon:'Mastiff AR', ability:'Sovraccarico cromo', abilityText:'Danno massiccio a un ostile nella tua stanza, ma aumenta l’allarme.' },
  { id:'cipher', callsign:'NYX', role:'CIPHER', specialty:'Guerra di rete', color:'#b895ff', stats:{corpo:3,riflessi:6,mente:10,presenza:5}, maxHp:70, armor:2, focus:10, weapon:'Pistola ad arco', ability:'Zero-day', abilityText:'Viola a distanza un nodo nella tua stanza o in una adiacente e brucia i droni vicini.' },
  { id:'ripper', callsign:'KORA', role:'RIPPER', specialty:'Supporto biotecnico', color:'#7dff9b', stats:{corpo:6,riflessi:5,mente:8,presenza:5}, maxHp:88, armor:4, focus:8, weapon:'Needler', ability:'Protocollo Lazarus', abilityText:'Cura e rianima tutti i compagni presenti nella tua stanza.' },
  { id:'face', callsign:'ECHO', role:'FACE', specialty:'Manipolazione', color:'#ff73ca', stats:{corpo:4,riflessi:6,mente:6,presenza:10}, maxHp:76, armor:3, focus:9, weapon:'Kestrel silenziata', ability:'Identità sintetica', abilityText:'Abbassa l’allarme di tutto il livello e distrae gli ostili nella tua stanza.' },
  { id:'driver', callsign:'JAX', role:'DRIVER', specialty:'Droni e mobilità', color:'#ff8b4a', stats:{corpo:6,riflessi:9,mente:6,presenza:3}, maxHp:86, armor:4, focus:6, weapon:'Vector SMG', ability:'Sciame MANTA', abilityText:'Colpisce due ostili nella tua stanza o in una adiacente.' },
];

let game = null;
if (existsSync(DATA_FILE)) {
  try { game = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { game = null; }
}
// Una partita salvata da una versione senza plancia non ha le stanze: va scartata.
if (game && !Array.isArray(game.map)) game = null;

const nowTime = () => new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
const makeCode = () => `${['NEON','VOID','NOVA','GRID'][Math.floor(Math.random()*4)]}-${Math.floor(10+Math.random()*90)}`;
const alive = (unit) => unit.hp > 0;
const connected = (player) => Boolean(player.deviceId && Date.now() - (player.lastSeen || 0) < LINK_TIMEOUT);
const participant = (player) => Boolean(player.deviceId && Date.now() - (player.lastSeen || 0) < LINK_GRACE);
const roundLength = () => (ROUND_SECONDS[game?.difficulty] || ROUND_SECONDS.standard) * 1000;
const enemiesIn = (roomId) => game.enemies.filter((e) => alive(e) && e.room === roomId);
const alliesIn = (roomId) => game.players.filter((p) => alive(p) && p.room === roomId);
const breachCount = () => NODE_ROOMS.filter((id) => game.nodes[id]).length;
const bossDown = () => !game.enemies.some((e) => e.id === 'k9' && alive(e));

async function save() {
  await mkdir(DATA_DIR,{recursive:true});
  await writeFile(DATA_FILE, JSON.stringify(game,null,2));
}

function publicGame() {
  if (!game) return null;
  const players = game.players.map((p)=>({...p,connected:connected(p)}));
  const waiting = game.players.filter((p)=>alive(p)&&participant(p)&&!p.action).map((p)=>p.name);
  const linked = players.filter((p)=>p.connected).length;
  // Il timer scorre solo quando c'è almeno un telefono collegato: nessuno resta bloccato.
  const secondsLeft = game.phase==='active'&&linked>0 ? Math.max(0,Math.ceil((game.roundEndsAt-Date.now())/1000)) : null;
  return {...game, players, waiting, secondsLeft, roundSeconds:Math.round(roundLength()/1000)};
}

function createGame(body) {
  const picks = body.players.slice(0,6);
  const players = picks.map((pick,index)=>{
    const t = templates.find((item)=>item.id===pick.characterId) || templates[index];
    return {id:`p${index+1}`, name:String(pick.name||t.callsign).slice(0,14).toUpperCase(), characterId:t.id, callsign:t.callsign, role:t.role, specialty:t.specialty, color:t.color, stats:t.stats, maxHp:t.maxHp, hp:t.maxHp, armor:t.armor, focus:t.focus, maxFocus:t.focus, weapon:t.weapon, ability:t.ability, abilityText:t.abilityText, stress:0, shield:0, room:EXIT_ROOM, action:null, deviceId:null, lastSeen:0};
  });
  const hpScale=1+0.34*(players.length-3);
  const dmgScale=1+0.12*(players.length-3);
  const scaled=(e)=>({...e,hp:Math.round(e.hp*hpScale),maxHp:Math.round(e.maxHp*hpScale),damage:Math.round(e.damage*dmgScale)});
  return {
    code:makeCode(), phase:'lobby', difficulty:body.difficulty||'standard', round:1, alarm:18, breach:0, roundEndsAt:0, hpScale, dmgScale,
    title:'SPEZZARE LA GABBIA', location:'HELIX TOWER // LIVELLO 27', objective:'Violate i tre nodi di sicurezza, neutralizzate il Custode K-9 e rientrate all’ACCESSO.',
    map:MAP, exitRoom:EXIT_ROOM, nodes:Object.fromEntries(NODE_ROOMS.map((id)=>[id,false])),
    players,
    enemies:[
      // Il Custode presidia il LAB NERO: esce a caccia solo quando la rete è compromessa.
      {id:'k9',name:'CUSTODE K-9',type:'ÉLITE',hp:145,maxHp:145,armor:7,damage:18,threat:5,room:'C09',home:'C09',guard:true,hunting:false},
      {id:'wasp',name:'WASP D-2',type:'DRONE',hp:54,maxHp:54,armor:2,damage:11,threat:2,room:'B07',home:'B07',hunting:false},
      {id:'trooper',name:'HELIX SEC-4',type:'FANTERIA',hp:72,maxHp:72,armor:4,damage:13,threat:3,room:'B04',home:'B04',hunting:false},
    ].map(scaled),
    feed:[{time:nowTime(),tone:'system',text:'Canale clandestino aperto. Squadra in posizione all’ACCESSO A01.'}],
    event:{title:'FINESTRA OPERATIVA',text:'Il blackout coprirà l’infiltrazione per altri 6 round.'},
    createdAt:Date.now(),updatedAt:Date.now(),
  };
}

function log(text,tone='system') {
  game.feed.unshift({time:nowTime(),text,tone});
  game.feed = game.feed.slice(0,10);
}

function damageEnemy(enemy,raw,actor) {
  const dealt=Math.max(1,raw-enemy.armor);
  enemy.hp=Math.max(0,enemy.hp-dealt);
  log(`${actor} infligge ${dealt} danni a ${enemy.name} in ${enemy.room}.`, 'combat');
  if(enemy.hp===0) log(`${enemy.name} neutralizzato in ${enemy.room}.`, 'success');
}

function revive(target,healer,amount) {
  target.hp=Math.min(target.maxHp,amount);
  target.stress=Math.max(0,target.stress-20);
  log(`${healer} rianima ${target.name} in ${target.room}.`, 'success');
}

function breachNode(roomId,actor,mente){
  game.nodes[roomId]=true;
  game.breach=breachCount();
  game.alarm=Math.max(0,game.alarm-(5+mente));
  log(`${actor} viola il nodo di ${roomLabel(roomId)} — breccia ${game.breach}/3.`, 'hack');
}

// FASE 1 // MANOVRA: tutti gli spostamenti si risolvono prima del fuoco, così la posizione
// dichiarata durante il round è quella che conta per il combattimento.
function resolveMovement(actors){
  for(const p of actors){
    if(p.action?.type!=='move') continue;
    const destination=p.action.roomId;
    if(!roomById(p.room).links.includes(destination)){
      log(`${p.name} non trova un passaggio verso ${destination}: resta in ${p.room}.`,'system');
      continue;
    }
    // Sganciarsi da una stanza presidiata costa: gli ostili colpiscono chi volta le spalle.
    const guards=enemiesIn(p.room);
    if(guards.length){
      const hit=Math.max(1,Math.round(guards[0].damage*0.5)-p.armor);
      p.hp=Math.max(0,p.hp-hit);
      game.alarm=Math.min(100,game.alarm+3);
      log(`${p.name} si sgancia sotto il fuoco di ${guards[0].name}: ${hit} danni.`,'danger');
    }
    p.room=destination;
    if(alive(p)) log(`${p.name} raggiunge ${roomLabel(destination)}.`,'system');
    else log(`${p.name} crolla nel corridoio verso ${destination}.`,'danger');
  }
}

// FASE 2 // AZIONI: risolte in ordine di Riflessi, sempre limitate alla stanza occupata.
function resolveActions(actors){
  const ordered=[...actors].sort((a,b)=>b.stats.riflessi-a.stats.riflessi);
  for(const p of ordered){
    if(!alive(p)) continue;
    const action=p.action;
    if(!action||action.type==='move') continue;
    const room=roomById(p.room);
    const hostiles=enemiesIn(p.room);
    const target=hostiles.find((e)=>e.id===action.targetId)||hostiles[0];

    if(action.type==='attack'){
      if(!target){ p.shield+=5; log(`${p.name} non ha bersagli in ${p.room}: tiene la posizione.`,'system'); }
      else damageEnemy(target,12+p.stats.riflessi+Math.floor(Math.random()*8),p.name);
    }

    if(action.type==='hack'){
      if(!room.node) log(`${p.name} non trova terminali in ${roomLabel(p.room)}.`,'system');
      else if(game.nodes[p.room]) log(`${p.name}: il nodo di ${p.room} è già violato.`,'system');
      else {
        breachNode(p.room,p.name,p.stats.mente);
        const drone=hostiles.find((e)=>e.type==='DRONE');
        if(drone) damageEnemy(drone,8+p.stats.mente,p.name);
      }
    }

    if(action.type==='guard'){
      const bonus=room.cover?6:0;
      p.shield=10+Math.floor(p.stats.corpo/2)+bonus;
      log(bonus?`${p.name} sfrutta la copertura di ${p.room} (scudo ${p.shield}).`:`${p.name} assume posizione di copertura in ${p.room}.`,'system');
    }

    if(action.type==='heal'){
      p.focus=Math.max(0,p.focus-2);
      // Priorità ai caduti nella stessa stanza: la barella non attraversa i corridoi.
      const down=game.players.filter((x)=>!alive(x)&&x.room===p.room)[0];
      if(down) revive(down,p.name,Math.round(down.maxHp*0.35));
      else{
        const wounded=[...alliesIn(p.room)].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
        if(!wounded){ log(`${p.name} non ha nessuno da curare in ${p.room}.`,'system'); }
        else{
          const amount=12+p.stats.mente;
          wounded.hp=Math.min(wounded.maxHp,wounded.hp+amount);
          wounded.stress=Math.max(0,wounded.stress-6);
          log(`${p.name} ripristina ${amount} integrità a ${wounded.name} in ${p.room}.`,'success');
        }
      }
    }

    if(action.type==='ability'){
      p.focus=Math.max(0,p.focus-3);
      if(p.characterId==='ghost'){
        p.shield+=8;
        if(target) damageEnemy(target,20+p.stats.riflessi,p.name);
        else log(`${p.name} svanisce nelle ombre di ${p.room}.`,'system');
      }
      else if(p.characterId==='chrome'){
        if(target){ damageEnemy(target,29+p.stats.corpo,p.name); game.alarm=Math.min(100,game.alarm+9); }
        else log(`${p.name} scarica il cromo a vuoto: nessun ostile in ${p.room}.`,'system');
      }
      else if(p.characterId==='cipher'){
        // La guerra di rete raggiunge anche la stanza accanto: il CIPHER non deve esporsi.
        const reach=[p.room,...room.links];
        const nodeRoom=reach.find((id)=>roomById(id).node&&!game.nodes[id]);
        if(nodeRoom) breachNode(nodeRoom,p.name,p.stats.mente);
        else log(`${p.name} lancia uno zero-day ma non aggancia nodi da ${p.room}.`,'system');
        for(const e of game.enemies.filter((x)=>alive(x)&&x.type==='DRONE'&&reach.includes(x.room))) damageEnemy(e,25,p.name);
      }
      else if(p.characterId==='ripper'){
        for(const ally of game.players.filter((x)=>x.room===p.room)){
          if(alive(ally)) ally.hp=Math.min(ally.maxHp,ally.hp+15);
          else revive(ally,p.name,Math.round(ally.maxHp*0.5));
        }
        log(`${p.name} attiva Protocollo Lazarus in ${roomLabel(p.room)}.`,'success');
      }
      else if(p.characterId==='face'){
        game.alarm=Math.max(0,game.alarm-18);
        for(const e of hostiles) e.distracted=true;
        log(`${p.name} inietta credenziali sintetiche: allarme in calo, ostili di ${p.room} distratti.`,'hack');
      }
      else if(p.characterId==='driver'){
        const reach=[p.room,...room.links];
        const swarm=game.enemies.filter((e)=>alive(e)&&reach.includes(e.room)).slice(0,2);
        if(!swarm.length) log(`${p.name} lancia lo sciame MANTA ma non trova ostili nel settore.`,'system');
        for(const e of swarm) damageEnemy(e,18+p.stats.riflessi,p.name);
      }
    }
  }
}

// Raggio di rilevamento in corridoi: con l'allarme basso gli Helix vedono solo la stanza
// accanto, quindi restare a distanza è una scelta tattica reale e non un dettaglio.
const huntRange = () => game.alarm>=75 ? 3 : game.alarm>=45 ? 2 : 1;

// FASE 3 // RISPOSTA HELIX: si combatte solo condividendo la stanza. Fuori contatto un
// ostile insegue soltanto se vi ha agganciati, altrimenti rientra nella sua zona di pattuglia.
function resolveEnemies(){
  for(const enemy of game.enemies.filter(alive)){
    if(enemy.distracted){ enemy.distracted=false; enemy.hunting=false; log(`${enemy.name} perde il contatto: turno saltato.`,'hack'); continue; }
    const inRoom=alliesIn(enemy.room);
    if(inRoom.length){
      enemy.hunting=true;
      const target=inRoom[(game.round+enemy.threat)%inRoom.length];
      const absorbed=Math.min(target.shield,enemy.damage);
      target.shield-=absorbed;
      const difficultyScale=game.difficulty==='recluta'?0.75:game.difficulty==='brutale'?1.3:1;
      const dealt=Math.max(1,Math.round((enemy.damage-absorbed-target.armor)*difficultyScale));
      target.hp=Math.max(0,target.hp-dealt);
      target.stress=Math.min(100,target.stress+4+enemy.threat);
      log(`${enemy.name} colpisce ${target.name} in ${enemy.room}: ${dealt} danni.`,'danger');
      if(target.hp===0) log(`${target.name} è fuori combattimento in ${enemy.room}.`,'danger');
      continue;
    }
    // Il Custode non abbandona il LAB NERO finché la rete regge.
    if(enemy.guard&&game.breach<3){ enemy.hunting=false; continue; }
    const targets=game.players.filter(alive);
    if(!targets.length) continue;
    const dist=distancesFrom(enemy.room);
    const ranked=targets.map((p)=>({p,d:dist[p.room]??99})).sort((a,b)=>a.d-b.d)[0];
    const detected=ranked.d<=huntRange()||(enemy.guard&&game.breach>=3);
    if(detected){
      if(!enemy.hunting) log(`${enemy.name} aggancia la squadra: contatto a ${ranked.d} corridoi.`,'danger');
      enemy.hunting=true;
      const step=stepToward(enemy.room,ranked.p.room);
      if(step!==enemy.room){ enemy.room=step; log(`${enemy.name} avanza verso ${roomLabel(step)}.`,'danger'); }
      continue;
    }
    // Contatto perso: l'unità torna alla propria zona invece di inseguire alla cieca.
    if(enemy.hunting){ enemy.hunting=false; log(`${enemy.name} perde le tracce e rientra in pattuglia.`,'system'); }
    const back=stepToward(enemy.room,enemy.home||enemy.room);
    if(back!==enemy.room){ enemy.room=back; log(`${enemy.name} pattuglia verso ${roomLabel(back)}.`,'system'); }
  }
}

function resolveRound() {
  const actors=game.players.filter(alive);
  for(const p of actors) if(!p.action) p.action={type:'guard',targetId:null,label:'Copertura automatica'};

  resolveMovement(actors);
  resolveActions(actors);
  resolveEnemies();

  // Il NEXUS è scoperto: chi ci resta a fine round alza l'allarme.
  const exposedCount=game.players.filter((p)=>alive(p)&&roomById(p.room).exposed).length;
  if(exposedCount) log(`${exposedCount} operativi esposti nel NEXUS: le telecamere li agganciano.`,'danger');

  const livingEnemies=game.enemies.filter(alive);
  const alarmPressure=game.difficulty==='recluta'?2:game.difficulty==='brutale'?7:4;
  game.alarm=Math.min(100,game.alarm+alarmPressure+livingEnemies.length+exposedCount);
  game.breach=breachCount();
  game.round+=1;
  game.players.forEach((p)=>{p.action=null;p.shield=Math.max(0,p.shield-3);p.focus=Math.min(p.maxFocus,p.focus+1);});

  const living=game.players.filter(alive);
  const extracted=living.length>0&&living.every((p)=>p.room===EXIT_ROOM);
  if(game.breach>=3&&bossDown()&&extracted){
    game.phase='victory';log('Squadra estratta dall’ACCESSO A01. MNEMOSYNE è nostro.','success');
  }
  else if(!living.length||game.alarm>=100){
    game.phase='defeat';log('Protocollo Helix completato. La squadra è perduta.','danger');
  }
  else{
    if(game.breach>=3&&!bossDown()) game.event={title:'CUSTODE SGANCIATO',text:'La rete è compromessa: il Custode K-9 ha lasciato il LAB NERO e vi sta dando la caccia.'};
    else if(game.breach>=3&&bossDown()) game.event={title:'ESTRAZIONE APERTA',text:'Portate ogni operativo vivo nella stanza A01 // ACCESSO per chiudere l’operazione.'};
    else if(game.round===4) game.event={title:'PORTE IN BLOCCO',text:'Il Settore B è sotto pressione: i corridoi verso il NEXUS sono sorvegliati.'};
    else if(game.round===6){
      game.event={title:'RINFORZI IN ARRIVO',text:'Una nuova unità Helix entra dal PONTE E05.'};
      const hp=Math.round(62*(game.hpScale||1));
      game.enemies.push({id:`reinforcement-${game.round}`,name:'HELIX RAZOR',type:'FANTERIA',hp,maxHp:hp,armor:3,damage:Math.round(14*(game.dmgScale||1)),threat:3,room:'E05',home:'E05',hunting:false});
      log('HELIX RAZOR entra dal PONTE E05.','danger');
    }
  }
  game.roundEndsAt=Date.now()+roundLength();
  game.updatedAt=Date.now();
}

// Un round si chiude quando tutti i telefoni collegati hanno risposto, oppure allo scadere
// del tempo. Senza telefoni collegati il timer resta fermo invece di far avanzare la partita.
function tryResolve() {
  if(!game||game.phase!=='active') return false;
  const expected=game.players.filter((p)=>alive(p)&&participant(p));
  // Senza nessun telefono vivo il timer resta fermo: la partita si mette in pausa, non avanza da sola.
  if(!expected.length||!game.players.some(connected)){game.roundEndsAt=Date.now()+roundLength();return false;}
  if(expected.every((p)=>p.action)){resolveRound();return true;}
  if(Date.now()>=game.roundEndsAt){
    const late=expected.filter((p)=>!p.action).map((p)=>p.name).join(', ');
    if(late) log(`Tempo scaduto: ${late} in copertura automatica.`,'system');
    resolveRound();return true;
  }
  return false;
}

// Preferisce le reti domestiche reali (Wi-Fi/Ethernet) rispetto a VPN e interfacce virtuali.
function networkCandidates(){
  const skip=/^(utun|awdl|llw|bridge|ap\d|vmnet|vboxnet|docker)/i;
  const out=[];
  for(const [name,group] of Object.entries(networkInterfaces())){
    if(skip.test(name)) continue;
    for(const item of group||[]){
      if(item.family!=='IPv4'||item.internal) continue;
      const a=item.address;
      const rank=a.startsWith('192.168.')?0:a.startsWith('10.')?1:/^172\.(1[6-9]|2\d|3[01])\./.test(a)?2:3;
      out.push({url:`http://${a}:${PORT}`,rank,name});
    }
  }
  out.sort((x,y)=>x.rank-y.rank);
  return out.map((x)=>x.url);
}
function getNetworkUrl(){ return networkCandidates()[0] || `http://localhost:${PORT}`; }

async function jsonBody(req){let raw='';for await(const chunk of req)raw+=chunk;if(!raw)return {};return JSON.parse(raw);}
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}

async function api(req,res,url){
  try{
    if(req.method==='GET'&&url.pathname==='/api/state'){
      if(tryResolve()) await save();
      return send(res,200,{game:publicGame(),templates,map:MAP,networkUrl:getNetworkUrl(),networkUrls:networkCandidates()});
    }
    if(req.method==='POST'&&url.pathname==='/api/setup'){
      const body=await jsonBody(req);
      if(!Array.isArray(body.players)||body.players.length<2||body.players.length>6)return send(res,400,{error:'Servono da 2 a 6 giocatori.'});
      if(new Set(body.players.map((p)=>p.characterId)).size!==body.players.length)return send(res,400,{error:'Ogni personaggio deve essere unico.'});
      game=createGame(body);await save();return send(res,200,{game:publicGame(),networkUrl:getNetworkUrl()});
    }
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const body=await jsonBody(req);if(!game||body.code?.toUpperCase()!==game.code)return send(res,404,{error:'Codice partita non valido.'});
      const p=game.players.find((x)=>x.id===body.playerId);if(!p)return send(res,404,{error:'Operativo non trovato.'});
      if(p.deviceId&&p.deviceId!==body.deviceId&&connected(p))return send(res,409,{error:'Questo operativo è già collegato da un altro telefono.'});
      const returning=p.deviceId===body.deviceId;
      p.deviceId=body.deviceId;p.lastSeen=Date.now();
      if(!returning) log(`${p.name} collegato al canale.`,'success');
      await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/ping'){
      const body=await jsonBody(req);const p=game?.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);
      if(!p)return send(res,404,{error:'Sessione non trovata.'});
      p.lastSeen=Date.now();
      if(tryResolve()) await save();
      return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/start'){
      const body=await jsonBody(req);if(!game||body.code!==game.code)return send(res,404,{error:'Partita non trovata.'});
      if(game.phase!=='lobby')return send(res,409,{error:'Operazione già avviata.'});
      if(!game.players.some(connected))return send(res,409,{error:'Collega almeno un telefono prima di avviare.'});
      game.phase='active';game.roundEndsAt=Date.now()+roundLength();
      log('Il blackout è iniziato. Muovetevi, violate i nodi, sparite.','combat');await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p||!alive(p))return send(res,403,{error:'Accesso operativo negato.'});
      if(p.action)return send(res,409,{error:'Azione già trasmessa.'});
      const allowed=['move','attack','hack','guard','heal','ability'];if(!allowed.includes(body.type))return send(res,400,{error:'Azione non valida.'});
      if(body.type==='ability'&&p.focus<3)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='heal'&&p.focus<2)return send(res,400,{error:'Focus insufficiente.'});
      // La plancia comanda: si può entrare solo in una stanza collegata a quella occupata.
      if(body.type==='move'&&!roomById(p.room).links.includes(body.roomId))return send(res,400,{error:'Quella stanza non è collegata alla tua posizione.'});
      if(body.type==='attack'&&!enemiesIn(p.room).length)return send(res,400,{error:'Nessun ostile nella tua stanza.'});
      if(body.type==='hack'&&!roomById(p.room).node)return send(res,400,{error:'Nessun terminale in questa stanza.'});
      if(body.type==='hack'&&game.nodes[p.room])return send(res,400,{error:'Il nodo di questa stanza è già violato.'});
      p.action={type:body.type,targetId:body.targetId||null,roomId:body.roomId||null};p.lastSeen=Date.now();log(`${p.name} ha trasmesso la propria azione.`,'system');
      tryResolve();
      await save();return send(res,200,{game:publicGame()});
    }
    // Sblocco manuale dalla plancia: chiude subito il round in corso.
    if(req.method==='POST'&&url.pathname==='/api/resolve'){
      if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      resolveRound();await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/reset'){game=null;await save();return send(res,200,{ok:true});}
    return send(res,404,{error:'Endpoint non trovato.'});
  }catch(error){console.error(error);return send(res,500,{error:'Errore del sistema di gioco.'});}
}

let vite;
if(process.env.NODE_ENV!=='production'){
  const {createServer:createVite}=await import('vite');
  // HMR disattivato: il suo WebSocket gira su una porta separata non raggiungibile dai
  // telefoni sulla rete locale e riempirebbe ogni console di errori di riconnessione.
  vite=await createVite({server:{middlewareMode:true,hmr:false},appType:'spa'});
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/'))return api(req,res,url);
  if(vite)return vite.middlewares(req,res,()=>{});
  try{
    const requested=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
    let filePath=join(process.cwd(),'dist',requested);
    if(!existsSync(filePath))filePath=join(process.cwd(),'dist','index.html');
    const data=await readFile(filePath);res.writeHead(200,{'Content-Type':mime[extname(filePath)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nROVERPUNK operativo:`);
  console.log(`  Plancia:  http://localhost:${PORT}`);
  for(const candidate of networkCandidates()) console.log(`  Telefoni: ${candidate}/?mode=player`);
  console.log('');
});

setInterval(async()=>{ if(tryResolve()) await save(); },1000);
