'use client';
import { Users, Backpack, Coins, Check, WarningCircle } from '@phosphor-icons/react';
import type { CitizenData } from '../domain/types';
import { kroner } from '../domain/format';
import { SourceDetails } from './ui';

export function DataSummary({ data }: { data: CitizenData }) {
  const { family, income, sfo } = data;
  return <div className="data-summary">
    <section className="data-block family-block"><div className="data-heading"><Users size={23} /><h2>Familien din</h2><span className="data-status"><Check size={16} /> Hentet</span></div>
      <div className="family-members"><div className="person"><span className="avatar" aria-hidden="true">SB</span><div><strong>{family.value.applicant.name}</strong><span>Forelder · {family.value.registeredAdults} registrert voksen</span></div></div>
        <div className="person"><span className="avatar child" aria-hidden="true">EB</span><div><strong>{family.value.child.name}</strong><span>{family.value.child.age} år · Barn</span></div></div></div>
      <SourceDetails source={family.source} />
    </section>
    <section className="data-block"><div className="data-heading"><Backpack size={23} /><h2>SFO-plassen</h2><span className="data-status"><Check size={16} /> Hentet</span></div>
      <p className="data-value">{sfo.value.school}</p><p className="data-description">{sfo.value.grade}. trinn · {sfo.value.placePercent} % plass · {sfo.value.hoursPerWeek} timer i uken</p>
      <SourceDetails source={sfo.source} />
    </section>
    <section className="data-block"><div className="data-heading"><Coins size={23} /><h2>Husholdningsinntekt</h2><span className={`data-status ${income.value.annualNok === null ? 'missing' : ''}`}>
      {income.value.annualNok === null ? <><WarningCircle size={16} /> Mangler</> : <><Check size={16} /> Hentet</>}</span></div>
      <p className="data-value number">{income.value.annualNok === null ? 'Ikke tilgjengelig' : kroner(income.value.annualNok)}</p><p className="data-description">Samlet årsinntekt · {income.value.year}</p>
      <SourceDetails source={income.source} />
    </section>
  </div>;
}
