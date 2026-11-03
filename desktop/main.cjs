// Processo principale Electron: avvia il server di gioco (server.mjs, invariato) dentro lo stesso
// processo e mostra la plancia in una finestra. I telefoni si collegano come sempre via LAN.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const PORT = 5174;
const URL_PLANCIA = `http://localhost:${PORT}`;

// La musica della plancia parte da sola, senza un click dell'utente.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

process.env.NODE_ENV = 'production';
process.env.PORT = String(PORT);
process.env.ROVERPUNK_ROOT = __dirname;
process.env.ROVERPUNK_DATA_DIR = join(app.getPath('userData'), 'data');

process.on('uncaughtException', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    dialog.showErrorBox('Roverpunk', `La porta ${PORT} è già occupata (un altro Roverpunk è aperto?). Chiudilo e riprova.`);
  } else {
    dialog.showErrorBox('Roverpunk', String((error && error.stack) || error));
  }
  app.exit(1);
});

async function attendiServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${URL_PLANCIA}/api/state`);
      if (res.ok) return;
    } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Il server Roverpunk non è partito.');
}

function creaFinestra() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Roverpunk',
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
  });
  // I link esterni si aprono nel browser di sistema, non dentro la plancia.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL_PLANCIA)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.loadURL(URL_PLANCIA);
}

app.whenReady().then(async () => {
  const { main } = await import(pathToFileURL(join(__dirname, 'server.mjs')).href);
  await main();
  await attendiServer();
  creaFinestra();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) creaFinestra(); });
});

// Chiudere la finestra chiude anche il server (e libera la porta).
app.on('window-all-closed', () => app.quit());
