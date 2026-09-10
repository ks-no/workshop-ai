'use client';
import Link from 'next/link';
import { ArrowUpRight, Check, ArrowRight, ShieldCheck, ArrowCounterClockwise } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Provenance, CaseView } from '../domain/types';
import { dateTime } from '../domain/format';

export function Header({ onReset, active = false }: { onReset?: () => void; active?: boolean }) {
  return <>
    <a className="skip-link" href="#main">Hopp til innhold</a>
    <div className="demo-banner"><span>Hackathondemo</span> Syntetiske opplysninger. Ingen søknad sendes.</div>
    <header className="site-header"><div className="header-inner">
      <Link href="/" className="brand" aria-label="Søk én gang, forsiden"><span className="brand-mark" aria-hidden="true">é</span><span>Søk én gang<span className="brand-tagline">Fra skjema til samtale.</span></span></Link>
      <nav aria-label="Hovedmeny"><Link href="/om-demoen">Om løsningen <ArrowUpRight size={18} /></Link>
        {active && onReset && <button className="text-button" onClick={onReset}><ArrowCounterClockwise size={18} /><span>Avslutt og slett demo</span></button>}
      </nav>
    </div></header>
  </>;
}
export function Footer() {
  return <footer className="site-footer"><span>Søk én gang <span className="footer-separator">/</span> KS Digital hackathon 2026</span><Link href="/om-demoen#personvern">Personvern i demoen <ArrowUpRight size={16} /></Link></footer>;
}
export function ArrowButton({ children, onClick, disabled = false, loading = false, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; type?: 'button' | 'submit';
}) {
  return <button type={type} className="button primary" onClick={onClick} disabled={disabled || loading} aria-busy={loading}>
    {children}<ArrowRight size={21} aria-hidden="true" />
  </button>;
}
export function SourceDetails({ source }: { source: Provenance }) {
  return <details className="source-details"><summary>Kilde og formål <ArrowUpRight size={16} aria-hidden="true" /></summary>
    <dl><div><dt>Kilde</dt><dd>{source.name}</dd></div><div><dt>Om opplysningen</dt><dd>{source.detail}</dd></div>
      <div><dt>Hentet i demoen</dt><dd>{dateTime(source.retrievedAt)}</dd></div>
      <div><dt>Gjelder</dt><dd>{source.period}</dd></div><div><dt>Hvorfor trenger vi dette?</dt><dd>{source.purpose}</dd></div></dl>
  </details>;
}
export function Stepper({ current }: { current: number }) {
  return <ol className="stepper" aria-label="Fremdrift">{['Opplysninger', 'Vurdering', 'Bekreftelse', 'Ferdig'].map((name, i) => <li key={name} className={i === current ? 'current' : i < current ? 'complete' : ''} aria-current={i === current ? 'step' : undefined}>
    <span className="step-number">{i < current ? <Check size={16} weight="bold" /> : i + 1}</span><span>{name}</span>
  </li>)}</ol>;
}
export function TrustAside({ session }: { session: CaseView | null }) {
  return <aside className="trust-aside" aria-label="Din kontroll"><ShieldCheck size={28} weight="duotone" />
    <h2>Du har oversikten.</h2><p>Se hva som brukes, hvor det kommer fra og hva du kan endre.</p>
    <div className="trust-item"><Check size={19} /><span>Du slipper å skrive inn det vi allerede har.</span></div>
    <div className="trust-item"><Check size={19} /><span>Du kan rette opplysninger før du bekrefter.</span></div>
    <div className="trust-item"><Check size={19} /><span>Faste regler gjør beregningen.</span></div>
    {session && <details className="history"><summary>Se hva som har skjedd <span>{session.audit.length}</span></summary>
      <ol>{session.audit.map(entry => <li key={entry.id}><strong>{entry.action}</strong><time dateTime={entry.at}>{dateTime(entry.at)}</time><p>{entry.detail}</p></li>)}</ol>
      <p className="small">Midlertidig demohistorikk. Ingen offentlig revisjonslogg.</p>
    </details>}
  </aside>;
}
