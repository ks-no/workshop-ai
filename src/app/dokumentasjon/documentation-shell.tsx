'use client';

import Link from 'next/link';
import { PktSelect } from '../../components/punkt-react';
import type { ReactNode } from 'react';
import { AssistantLocaleProvider, useAssistantLocale } from '../../components/assistant-i18n';
import styles from './documentation.module.css';

export function useDocumentationText() {
  const { locale } = useAssistantLocale();
  return (norwegian: string, english: string) => locale === 'en' ? english : norwegian;
}

function Shell({ children, active }: { children: ReactNode; active: 'about' | 'docs' }) {
  const { locale, setLocale } = useAssistantLocale();
  const text = useDocumentationText();
  return <div className={`app-shell assistant-app ${styles.shell}`} lang={locale}>
    <a className="skip-link" href="#main">{text('Hopp til innhold', 'Skip to content')}</a>
    <div className="demo-banner"><span>{text('Hackathondemo · Team Oslo', 'Hackathon demo · Team Oslo')}</span> {text('Bruk bare testopplysninger. Ingen søknad sendes.', 'Use test information only. No application is submitted.')}</div>
    <header className="site-header"><div className="header-inner">
      <Link href="/" className="brand" aria-label={text('Søk én gang, forsiden', 'Søk én gang, home')}><span className="brand-mark" aria-hidden="true">é</span><span>Søk én gang<span className="brand-tagline">{text('Fra skjema til samtale.', 'From forms to conversation.')}</span></span></Link>
      <nav aria-label={text('Hovedmeny', 'Main navigation')}><Link href="/dokumentasjon" aria-current={active === 'docs' ? 'page' : undefined}>{text('Dokumentasjon', 'Documentation')}</Link><Link href="/om-demoen" aria-current={active === 'about' ? 'page' : undefined}>{text('Om løsningen', 'About this demo')}</Link></nav>
      <div className="assistant-locale"><PktSelect id="documentation-locale" label={text('Grensesnittspråk', 'Interface language')} inputSize="small" value={locale} onChange={event => setLocale(event.target.value as 'nb' | 'en')}><option value="nb">NO – Norsk</option><option value="en">EN – English</option></PktSelect></div>
    </div></header>
    {children}
    <footer className="site-footer"><span>Søk én gang · Team Oslo</span><Link href="/om-demoen#personvern">{text('Personvern i demoen', 'Demo privacy')}</Link></footer>
  </div>;
}

export function DocumentationShell({ children, active }: { children: ReactNode; active: 'about' | 'docs' }) {
  return <AssistantLocaleProvider><Shell active={active}>{children}</Shell></AssistantLocaleProvider>;
}
