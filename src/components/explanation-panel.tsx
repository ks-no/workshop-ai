'use client';
import { useState } from 'react';
import { ChatCircleText, ArrowUp, ArrowUpRight } from '@phosphor-icons/react';
import type { Explanation, Topic } from '../domain/types';

export function ExplanationPanel({ onChanged }: { onChanged: () => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Explanation | null>(null);
  const [asked, setAsked] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const questions: { label: string; topic: Topic }[] = [
    { label: 'Hvorfor blir betalingen slik?', topic: 'why' },
    { label: 'Hvilke opplysninger er brukt?', topic: 'data' },
    { label: 'Hva hvis inntekten har gått ned?', topic: 'income-change' },
    { label: 'Hvor kommer opplysningene fra?', topic: 'source' },
    { label: 'Hva skjer videre?', topic: 'next' },
  ];
  async function ask(text: string, topic?: Topic) {
    if (!text.trim() || loading) return;
    setLoading(true); setError(''); setAsked(text); setAnswer(null);
    try {
      const response = await fetch('/api/explanation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, topic }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAnswer(data); setQuestion(''); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Forklaringen kunne ikke hentes. Prøv igjen.'); }
    finally { setLoading(false); }
  }
  return <section className="explanation-panel" aria-labelledby="explanation-heading">
    <div className="explanation-heading"><ChatCircleText size={27} /><div><h2 id="explanation-heading">Lurer du på noe?</h2><p>Få vurderingen forklart, med vanlige ord.</p></div></div>
    <div className="question-list">{questions.map(item => <button key={item.topic} disabled={loading} onClick={() => ask(item.label, item.topic)}>{item.label}<ArrowUpRight size={16} /></button>)}</div>
    {(loading || answer) && <div className="answer" aria-live="polite" aria-busy={loading}><strong>{asked}</strong>{loading ? <p>Henter forklaring …</p> : <><p>{answer?.text}</p><a href={answer?.source} target="_blank" rel="noreferrer">Se grunnlaget <ArrowUpRight size={16} /></a><p className="small explanation-mode">{answer?.mode === 'local-ai' ? 'Lokal KI tolket spørsmålet. Svaret er kontrollert maltekst.' : 'Forhåndsskrevet forklaring. Ingen språkmodell er brukt.'}{answer?.fallback && ' Lokal KI svarte ikke, så demoen bruker reserveforklaringen.'}</p></>}</div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <form className="question-form" onSubmit={event => { event.preventDefault(); void ask(question); }}><label htmlFor="question">Eller spør med egne ord</label><div className="question-input"><input id="question" placeholder="For eksempel: Hva betyr årsinntekt?" value={question} onChange={event => setQuestion(event.target.value)} maxLength={300} autoComplete="off" /><button type="submit" disabled={!question.trim() || loading} aria-label="Still spørsmål"><ArrowUp size={22} /></button></div></form>
    <p className="small">Bruk bare testopplysninger. Forklaringstjenesten kan aldri endre vurderingen.</p>
  </section>;
}
