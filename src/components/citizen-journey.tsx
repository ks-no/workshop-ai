'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle, Users, Backpack, Coins, ShieldCheck, CalendarBlank, DownloadSimple, Info, PencilSimple } from '@phosphor-icons/react';
import type { Answers, CaseView, Scenario } from '../domain/types';
import { dateTime, kroner } from '../domain/format';
import { Header, Footer, ArrowButton, Stepper, TrustAside } from './ui';
import { DataSummary } from './data-summary';
import { AssessmentResult } from './assessment-result';
import { ExplanationPanel } from './explanation-panel';

type Screen = 'start' | 'fetching' | 'review' | 'missing' | 'result' | 'confirm' | 'done' | 'future';
const stages: Record<Screen, number> = { start: 0, fetching: 0, review: 0, missing: 0, result: 1, confirm: 2, done: 3, future: 3 };
const scenarioNames: Record<Scenario, string> = {
  standard: 'Vanlig sjekk', 'missing-income': 'Inntekt mangler', 'high-income': 'Høyere inntekt', unavailable: 'Datakilden svarer ikke',
};
async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Noe gikk galt. Prøv igjen.');
  return data;
}
function parseIncome(value: string): number | undefined {
  const clean = value.replace(/\s/g, '');
  if (!/^\d+$/.test(clean)) return undefined;
  const amount = Number(clean);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 100_000_000 ? amount : undefined;
}

export function CitizenJourney() {
  const [screen, setScreen] = useState<Screen>('start');
  const [session, setSession] = useState<CaseView | null>(null);
  const [scenario, setScenario] = useState<Scenario>('standard');
  const [answers, setAnswers] = useState<Answers>({});
  const [income, setIncome] = useState('');
  const [correction, setCorrection] = useState(false);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchDone, setFetchDone] = useState(false);
  const [error, setError] = useState('');
  const [incomeError, setIncomeError] = useState('');
  const [notice, setNotice] = useState('');
  const [resuming, setResuming] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/case', { signal: controller.signal }).then(async response => {
      if (response.status === 401) return;
      if (!response.ok) throw new Error('Kunne ikke hente demoøkten. Du kan starte på nytt.');
      const existing: CaseView = await response.json();
      setSession(existing); setScenario(existing.scenario); setAnswers(existing.answers);
      setIncome(existing.answers.currentIncomeNok?.toString() ?? '');
      setScreen(existing.receipt ? 'done' : existing.assessment && existing.assessment.status !== 'missing' ? 'result' : 'review');
    }).catch(err => { if (err.name !== 'AbortError') setNotice(err.message); }).finally(() => { if (!controller.signal.aborted) setResuming(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (screen !== 'start') { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }, [screen]);

  async function start(chosen = scenario) {
    if (loading) return;
    setLoading(true); setError(''); setNotice(''); setFetchDone(false); setScreen('fetching');
    try {
      const [newSession] = await Promise.all([request<CaseView>('/api/case', { scenario: chosen, allowed: true }), new Promise(resolve => setTimeout(resolve, 700))]);
      setFetchDone(true);
      await new Promise(resolve => setTimeout(resolve, 250));
      setSession(newSession); setScenario(chosen); setAnswers({}); setIncome(''); setCorrection(false); setFinalConfirmed(false); setScreen('review');
    } catch (err) { setError(err instanceof Error ? err.message : 'Datakilden svarte ikke.'); setScreen('start'); }
    finally { setLoading(false); }
  }
  async function reset() {
    if (loading) return;
    setLoading(true); setError('');
    try {
      await request('/api/case', undefined, 'DELETE');
      setSession(null); setScreen('start'); setAnswers({}); setCorrection(false); setIncome(''); setFinalConfirmed(false); setIncomeError(''); setNotice('Demoøkten er slettet. Du kan begynne på nytt.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Kunne ikke slette økten. Prøv igjen.'); }
    finally { setLoading(false); }
  }
  function validateIncome() {
    const amount = parseIncome(income);
    setIncomeError(amount === undefined ? 'Oppgi samlet årsinntekt i hele kroner, fra 0 til 100 000 000.' : '');
    return amount;
  }
  function changeIncome(value: string) {
    setIncome(value);
    // Clear stale feedback while editing, so blur cannot move the submit button during a click.
    setIncomeError('');
  }
  function reviewContinue(isCorrection: boolean) {
    setError('');
    if (isCorrection) {
      if (answers.correction === 'income') {
        const amount = validateIncome();
        if (amount === undefined) return;
        setAnswers(current => ({ ...current, currentIncomeNok: amount, informationConfirmed: true }));
      } else if (answers.correction === 'other') {
        if ((answers.note?.trim().length ?? 0) < 5) { setError('Beskriv kort hva som er feil, med minst fem tegn.'); return; }
        setAnswers(current => ({ ...current, currentIncomeNok: undefined, informationConfirmed: true }));
      } else { setError('Velg hva som har endret seg.'); return; }
    } else {
      setAnswers(current => ({ cohabitant: current.cohabitant, informationConfirmed: true }));
      setIncome(''); setCorrection(false);
    }
    setScreen('missing');
  }
  async function evaluate() {
    if (!session || loading) return;
    setError('');
    if (!answers.cohabitant) { setError('Svar på spørsmålet om samboer før vi går videre.'); return; }
    let nextAnswers = { ...answers };
    if (session.data.income.value.annualNok === null && answers.correction !== 'other') {
      const amount = validateIncome();
      if (amount === undefined) return;
      nextAnswers = { ...answers, currentIncomeNok: amount, correction: 'income' };
    }
    setLoading(true);
    try {
      const updated = await request<CaseView>('/api/assessment', nextAnswers);
      setSession(updated); setAnswers(updated.answers); setFinalConfirmed(false);
      if (updated.assessment?.status === 'missing') { setError('Vi mangler fortsatt en opplysning. Kontroller svarene.'); return; }
      setScreen('result');
    } catch (err) { setError(err instanceof Error ? err.message : 'Vurderingen kunne ikke gjennomføres.'); }
    finally { setLoading(false); }
  }
  async function confirm() {
    if (!finalConfirmed || loading) return;
    setLoading(true); setError('');
    try { setSession(await request<CaseView>('/api/confirm', { confirmed: true })); setScreen('done'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Bekreftelsen kunne ikke lagres. Prøv igjen.'); }
    finally { setLoading(false); }
  }
  async function refreshAudit() {
    try {
      const snapshot = await request<CaseView>('/api/case', undefined, 'GET');
      setSession(current => {
        // A delayed history read must not restore a deleted case or replace a newer assessment/receipt.
        if (!current || current.id !== snapshot.id || current.receipt) return current;
        const events = new Map([...current.audit, ...snapshot.audit].map(entry => [entry.id, entry]));
        return { ...current, audit: [...events.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-100) };
      });
    } catch { /* Keep the existing view; the next action reports an expired session. */ }
  }
  const missingIncome = session?.data.income.value.annualNok === null && answers.correction !== 'other';

  return <div className="app-shell"><Header onReset={reset} active={!!session} />
    <main id="main" className={screen === 'start' ? 'landing-main' : 'journey-main'}>
      {notice && <p className="status-notice" role="status">{notice}</p>}
      {screen === 'start' ? <>
        <section className="landing-grid">
          <div className="landing-copy"><p className="service-label">En enklere hverdag med kommunen</p>
            <h1 ref={heading} tabIndex={-1}>Kan du betale<br className="desktop-break" /> mindre for SFO?</h1>
            <p className="hero-description">Du trenger ikke fylle ut opplysninger kommunen allerede har. Se over, rett og bekreft.</p>
            <ArrowButton onClick={() => start()} loading={loading || resuming}>{resuming ? 'Gjør klar demoen' : 'Start sjekken'}</ArrowButton>
            <p className="start-disclosure">Når du starter, henter demoen syntetiske familie-, SFO- og inntektsopplysninger.</p>
          </div>
          <div className="landing-story" aria-label="Slik blir det enklere"><div className="story-header"><span>Din SFO-sjekk</span><span>2026 / 2027</span></div>
            <h2>Du begynner<br />ikke på nytt.</h2>
            <div className="story-row"><Users size={26} /><div><strong>Familien din</strong><span>Opplysningene finnes allerede</span></div><Check size={20} /></div>
            <div className="story-row"><Backpack size={26} /><div><strong>SFO-plassen</strong><span>Opplysningene finnes allerede</span></div><Check size={20} /></div>
            <div className="story-row"><Coins size={26} /><div><strong>Husholdningsinntekten</strong><span>Opplysningene finnes allerede</span></div><Check size={20} /></div>
            <div className="story-question"><span>Kommunen spør bare om<br /><strong>det som mangler.</strong></span><ArrowRight size={28} /></div>
            <p className="small">Illustrert hovedscenario med syntetiske opplysninger.</p>
          </div>
        </section>
        <section className="landing-bottom" aria-label="Om sjekken"><div><ShieldCheck size={25} /><h2>Du har siste ord.</h2><p>Faste regler vurderer. Forklaringene hjelper deg å forstå. Du kontrollerer før saken går videre.</p></div>
          <div className="demo-controls"><label htmlFor="scenario">Prøv en demosituasjon</label><select id="scenario" value={scenario} onChange={e => { setScenario(e.target.value as Scenario); setError(''); }}>{Object.entries(scenarioNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><p className="small">Du prøver som Sofia Berg i Eksempel kommune.</p></div>
        </section>
        {error && <div className="error-box" role="alert"><strong>Vi fikk ikke hentet opplysningene.</strong><p>{error}</p><button className="button secondary" onClick={() => start('standard')}>Start lokal demo <ArrowRight size={19} /></button></div>}
      </> : <>
        <Stepper current={stages[screen]} />
        <div className="journey-grid"><div className="journey-content">
          {screen === 'fetching' && <section className="fetch-screen" aria-busy="true"><h1 ref={heading} tabIndex={-1}>Vi finner det vi allerede vet.</h1><p>Henter syntetiske opplysninger for SFO-sjekken.</p><div className="fetch-list">{[{ icon: Users, text: 'Familien din' }, { icon: Backpack, text: 'SFO-plassen' }, { icon: Coins, text: 'Husholdningsinntekten' }].map(({ icon: Icon, text }) => <div key={text}><Icon size={24} /><span>{text}</span>{fetchDone ? <Check size={22} /> : <span className="loading-line" aria-label="Henter" />}</div>)}</div><p className="small">Ingen ekte registre kontaktes.</p></section>}

          {screen === 'review' && session && <>
            <p className="greeting">Hei, {session.data.family.value.applicant.name.split(' ')[0]}.</p><h1 ref={heading} tabIndex={-1}>Dette vet kommunen om deg</h1><p className="page-intro">Vi har samlet det som trengs for å sjekke SFO-betalingen din. Du kan se kilden til hver opplysning.</p>
            <DataSummary data={session.data} />
            {!correction ? <section className="review-actions"><h2>Stemmer disse opplysningene?</h2><div className="action-row"><ArrowButton onClick={() => reviewContinue(false)}>Ja, dette stemmer</ArrowButton><button className="text-button" onClick={() => { setCorrection(true); setAnswers(current => ({ ...current, correction: current.correction || 'income' })); }}>Noe er feil eller har endret seg <PencilSimple size={18} /></button></div></section>
              : <section className="correction-panel"><h2>Hva har endret seg?</h2><p>Det du oppgir nå lagres ved siden av registeropplysningene.</p><fieldset><legend className="sr-only">Velg endring</legend><label className="choice"><input type="radio" name="correction" checked={answers.correction === 'income'} onChange={() => setAnswers(current => ({ ...current, correction: 'income' }))} />Inntekten min er lavere nå</label><label className="choice"><input type="radio" name="correction" checked={answers.correction === 'other'} onChange={() => setAnswers(current => ({ ...current, correction: 'other' }))} />Familien, SFO-plassen eller noe annet er feil</label></fieldset>
                {answers.correction === 'income' ? <IncomeField value={income} onChange={changeIncome} error={incomeError} onBlur={validateIncome} /> : <div className="field"><label htmlFor="correction-note">Hva trenger kommunen å vite?</label><textarea id="correction-note" maxLength={500} rows={3} value={answers.note || ''} onChange={e => setAnswers(current => ({ ...current, note: e.target.value }))} aria-describedby="note-help" /><p id="note-help" className="small">Bruk bare testopplysninger. Kommunen må avklare endringen.</p></div>}
                <div className="notice compact"><Info size={21} /><p>Nye opplysninger må vurderes av en saksbehandler. Du trenger ikke laste opp dokumentasjon i demoen.</p></div><div className="action-row"><ArrowButton onClick={() => reviewContinue(true)}>Legg til endringen</ArrowButton><button className="text-button" onClick={() => { setCorrection(false); setError(''); }}>Avbryt endring</button></div>
              </section>}
          </>}

          {screen === 'missing' && session && <>
            <button className="back-button" onClick={() => { setScreen('review'); setError(''); }}><ArrowLeft size={18} /> Til opplysningene</button>
            <h1 ref={heading} tabIndex={-1}>{missingIncome ? 'Vi mangler litt for å gå videre' : 'Bare én ting til.'}</h1><p className="page-intro">Noen forhold finnes ikke i registrene. Derfor trenger vi et svar fra deg.</p>
            <form onSubmit={e => { e.preventDefault(); void evaluate(); }}>
              <fieldset className="missing-question"><legend>Har du en samboer som ikke er med i oversikten?</legend><p id="cohabitant-help">Det kan påvirke hvem sin inntekt som skal regnes med. Vi kan ikke fastslå dette fra adressen alene.</p><p className="small">Her mener vi en partner du har felles barn med, eller har bodd sammen med som par i minst 12 av de siste 18 månedene. Begge må være ugifte og over 18 år.</p>
                <label className={`choice ${answers.cohabitant === 'no' ? 'selected' : ''}`}><input type="radio" name="cohabitant" value="no" checked={answers.cohabitant === 'no'} onChange={() => setAnswers(current => ({ ...current, cohabitant: 'no' }))} aria-describedby="cohabitant-help" />Nei, oversikten over husholdningen stemmer</label>
                <label className={`choice ${answers.cohabitant === 'yes' ? 'selected' : ''}`}><input type="radio" name="cohabitant" value="yes" checked={answers.cohabitant === 'yes'} onChange={() => setAnswers(current => ({ ...current, cohabitant: 'yes' }))} />Ja, jeg har en samboer som mangler</label>
                {answers.cohabitant === 'yes' && <p className="notice-text" role="status">Takk. Kommunen må avklare husholdningen og inntektsgrunnlaget. Det blir ingen automatisk prisberegning.</p>}
              </fieldset>
              {missingIncome && <section className="missing-income"><h2>Vi fikk ikke inntekten din</h2><p>Oppgi et anslag for hele husholdningen. En saksbehandler må kontrollere grunnlaget.</p><IncomeField value={income} onChange={changeIncome} error={incomeError} onBlur={validateIncome} /></section>}
              <ArrowButton type="submit" loading={loading}>{loading ? 'Vurderer opplysningene' : 'Se vurderingen'}</ArrowButton>
            </form>
          </>}

          {screen === 'result' && session?.assessment && <>
            <div className="section-status"><CheckCircle size={21} />{session.assessment.status === 'manual' ? 'Klar for manuell vurdering' : 'Opplysningene er vurdert'}</div>
            <h1 ref={heading} tabIndex={-1}>{session.assessment.title}</h1><p className="page-intro">{session.assessment.status === 'manual' ? 'Vi har beholdt registeropplysningene og lagt til det du fortalte oss.' : session.assessment.explanation}</p>
            <AssessmentResult session={session} /><div className="action-row result-actions"><ArrowButton onClick={() => { setFinalConfirmed(false); setScreen('confirm'); }}>Gå til bekreftelse</ArrowButton><button className="text-button" onClick={() => { setCorrection(!!answers.correction); setScreen('review'); }}><PencilSimple size={18} />Endre opplysninger</button></div>
            <ExplanationPanel onChanged={refreshAudit} />
          </>}

          {screen === 'confirm' && session?.assessment && <>
            <button className="back-button" onClick={() => setScreen('result')}><ArrowLeft size={18} /> Til vurderingen</button><h1 ref={heading} tabIndex={-1}>Du har siste ord.</h1><p className="page-intro">Se over hva du bekrefter. Deretter gjør vi saken klar for videre behandling i demoen.</p>
            <section className="confirmation-summary"><h2>Dette følger med saken</h2><dl><div><dt>Gjelder</dt><dd>{session.data.family.value.child.name} · SFO</dd></div><div><dt>Registrert årsinntekt</dt><dd>{session.data.income.value.annualNok === null ? 'Ikke tilgjengelig' : kroner(session.data.income.value.annualNok)}</dd></div>{answers.currentIncomeNok !== undefined && <div><dt>Ny årsinntekt, oppgitt av deg</dt><dd>{kroner(answers.currentIncomeNok)}</dd></div>}<div><dt>Husholdningen</dt><dd>{answers.cohabitant === 'yes' ? 'Samboer mangler i oversikten' : 'Bekreftet av deg'}</dd></div>{answers.note && <div><dt>Din merknad</dt><dd>{answers.note}</dd></div>}<div><dt>Videre behandling</dt><dd>{['manual', 'out-of-scope'].includes(session.assessment.status) ? 'Krever manuell vurdering' : 'Klar for kommunens vurdering'}</dd></div></dl></section>
            <label className="choice confirmation-choice"><input type="checkbox" checked={finalConfirmed} onChange={e => setFinalConfirmed(e.target.checked)} /><span>Jeg bekrefter opplysningene og eventuelle endringer jeg har oppgitt.</span></label>
            <ArrowButton onClick={confirm} disabled={!finalConfirmed} loading={loading}>{loading ? 'Lagrer bekreftelsen' : 'Bekreft og gå videre'}</ArrowButton><p className="small after-button">Dette oppretter bare en lokal demokvittering. Ingen søknad sendes til kommunen.</p>
          </>}

          {screen === 'done' && session?.receipt && <>
            <CheckCircle size={48} className="success-icon" weight="duotone" /><h1 ref={heading} tabIndex={-1}>{session.receipt.status === 'manual-review' ? 'Takk. Endringen er registrert.' : 'Ferdig. Det var alt fra deg.'}</h1><p className="page-intro">{session.receipt.status === 'manual-review' ? 'Saken er merket for manuell behandling i demoen. I en virkelig sak kan kommunen be deg om dokumentasjon.' : 'Opplysningene er bekreftet. Saken er klar for videre behandling i demoen.'}</p>
            <ol className="completion-list"><li><Check size={21} />Opplysningene er bekreftet</li><li><Check size={21} />Vurderingen er gjennomført</li><li><Check size={21} />{session.receipt.status === 'manual-review' ? 'Saken er merket for manuell behandling' : 'Saken er klar for videre behandling'}</li></ol>
            <div className="receipt"><div><span>Din demokvittering</span><strong>{session.receipt.reference}</strong><time dateTime={session.receipt.createdAt}>{dateTime(session.receipt.createdAt)}</time></div><a className="button secondary" href="/api/receipt" download><DownloadSimple size={19} />Last ned kvittering</a></div><p className="small">Lagret midlertidig i demoen. Ikke sendt til kommunen. Ikke et vedtak.</p>
            <section className="future-invitation"><CalendarBlank size={28} /><h2>Men hva med neste skoleår?</h2><p>Den samme familien. Den samme SFO-plassen. Må du virkelig begynne på nytt?</p><ArrowButton onClick={() => setScreen('future')}>Se neste skoleår</ArrowButton></section>
          </>}

          {screen === 'future' && <>
            <button className="back-button" onClick={() => setScreen('done')}><ArrowLeft size={18} /> Til kvitteringen</button><div className="future-date"><CalendarBlank size={22} />August 2027 <span>Fremtidsscenario</span></div><h1 ref={heading} tabIndex={-1}>Et nytt skoleår.<br />Ingen ny runde.</h1>
            <div className="future-letter"><span className="letter-from">En tenkt melding fra kommunen</span><h2>Hei igjen, Sofia.</h2><p>Vi har vurdert retten din på nytt basert på oppdaterte opplysninger.</p><p>Du trenger ikke sende inn de samme opplysningene på nytt.</p><div className="letter-footer"><CheckCircle size={22} /><span>Se over det som har endret seg.<br /><strong>Resten har vi allerede.</strong></span></div></div>
            <div className="future-conditions"><Info size={22} /><p>Dette er en visjon, ikke en aktiv tjeneste. Ny vurdering forutsetter at søknaden fortsatt dekker perioden, barnet fortsatt går i SFO og kommunen har rettslig grunnlag og tilstrekkelige opplysninger. Nye eller usikre forhold må avklares.</p></div>
            <Link className="inline-link" href="/om-demoen#neste-skolear">Les forutsetningene og kilden <ArrowUpRight size={18} /></Link><div className="closing-line">Søk én gang.<span>Kommunen spør bare om det den ikke vet.</span></div><button className="button secondary" onClick={reset}>Avslutt og slett demo <ArrowRight size={18} /></button>
          </>}
          {error && <div className="error-box" role="alert"><p>{error}</p>{error.includes('utløpt') && <button className="text-button" onClick={reset}>Start på nytt</button>}</div>}
        </div><TrustAside session={session} /></div>
      </>}
    </main><Footer />
  </div>;
}

function IncomeField({ value, onChange, error, onBlur }: { value: string; onChange: (value: string) => void; error: string; onBlur: () => void }) {
  return <div className="field"><label htmlFor="current-income">Samlet forventet årsinntekt for husholdningen</label><p id="income-help" className="small">Brutto personinntekt og skattepliktig kapitalinntekt for 2026. Oppgi hele kroner, ikke månedsinntekt.</p><div className="amount-input"><input id="current-income" inputMode="numeric" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} aria-invalid={!!error} aria-describedby={`income-help${error ? ' income-error' : ''}`} placeholder="For eksempel 320 000" /><span>kr per år</span></div>{error && <p className="field-error" id="income-error" role="alert">{error}</p>}<p className="source-caption">Kilde: Oppgitt av deg · Må dokumenteres ved videre behandling</p></div>;
}
