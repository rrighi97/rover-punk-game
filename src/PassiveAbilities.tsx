import { ShieldCheck } from 'lucide-react';

export type PassiveAbility = {
  id: string;
  name: string;
  text: string;
};

type Props = {
  passives?: PassiveAbility[];
  title?: string;
};

// Scheda condivisa: le passive sono sempre attive e non richiedono focus né un'azione.
export default function PassiveAbilities({ passives = [], title = 'PASSIVE // SEMPRE ATTIVE' }: Props) {
  if (!passives.length) return null;

  return <section className="passive-abilities">
    <small><ShieldCheck size={12}/>{title}</small>
    <div>
      {passives.map((passive) => <article key={passive.id}>
        <b>{passive.name}</b>
        <p>{passive.text}</p>
      </article>)}
    </div>
  </section>;
}
