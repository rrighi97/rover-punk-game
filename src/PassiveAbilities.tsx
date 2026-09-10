import { ShieldCheck } from 'lucide-react';

export type PassiveAbility = {
  id: string;
  name: string;
  text: string;
};

type Props = {
  passives?: PassiveAbility[];
  compact?: boolean;
  title?: string;
};

// Scheda condivisa: le passive sono sempre attive e non richiedono focus né un'azione.
export default function PassiveAbilities({ passives = [], compact = false, title = 'PASSIVE // SEMPRE ATTIVE' }: Props) {
  if (!passives.length) return null;

  if (compact) {
    return <div className="passive-chips" aria-label="Abilità passive">
      {passives.map((passive) => <span key={passive.id} title={passive.text}>{passive.name}</span>)}
    </div>;
  }

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
