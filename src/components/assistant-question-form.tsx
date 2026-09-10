'use client';

import { useState, type FormEvent } from 'react';
import { PktRadioButton, PktSelect, PktTextarea, PktTextinput } from './punkt-react';
import { factKeys, type FollowUp, type StructuredAnswer } from '../domain/assistant-types';
import { AssistantButton } from './assistant-controls';
import { factLabel, factValue, useAssistantLocale, type UiLocale } from './assistant-i18n';

const booleanKeys = new Set(['job_lost', 'has_children', 'uses_sfo', 'needs_housing', 'moving', 'cohabitant_missing']);
const amounts = new Set(['household_income_annual', 'monthly_rent']);

function normalizedLabel(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function answerMessage(questions: FollowUp[], answers: Record<string, string>, locale: UiLocale) {
  return questions.flatMap(question => {
    const value = answers[question.key]?.trim();
    if (!value) return [];
    return `${factLabel(question.key, question.question, locale)}: ${factValue(value, locale)}${amounts.has(question.key) ? ' NOK' : ''}.`;
  }).join('\n');
}

export function structuredAnswers(questions: FollowUp[], answers: Record<string, string>, locale: UiLocale): StructuredAnswer[] {
  return questions.flatMap(question => {
    const value = answers[question.key]?.trim();
    if (!value || !factKeys.includes(question.key as typeof factKeys[number])) return [];
    const quote = `${factLabel(question.key, question.question, locale)}: ${factValue(value, locale)}${amounts.has(question.key) ? ' NOK' : ''}.`;
    return [{ key: question.key as typeof factKeys[number], value, quote }];
  });
}

export function AssistantQuestionForm({ questions, busy, replyLanguage, onSend }: {
  questions: FollowUp[]; busy: boolean; replyLanguage: string; onSend: (text: string, answers: StructuredAnswer[]) => Promise<boolean>;
}) {
  const { locale, t } = useAssistantLocale();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const draft = answerMessage(questions, answers, locale);
  function change(key: string, value: string) { setAnswers(previous => ({ ...previous, [key]: value })); setError(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) { setError('Fyll ut minst ett svar.'); return; }
    if (await onSend(draft, structuredAnswers(questions, answers, locale))) setAnswers({});
  }
  return <section className="assistant-questions" aria-labelledby="questions-heading" id="assistant-questions">
    <h2 id="questions-heading">{t('Dette trenger vi å vite')}</h2>
    <p className="small">{t('Svar på det du vet. Tomme felt sendes ikke. Det du skriver i disse tydelig merkede feltene bekreftes direkte av deg.')}</p>
    <form onSubmit={submit} aria-label={t('Svar på spørsmål')} className="assistant-question-form">
      {questions.map(question => {
        const id = `question-${question.key}`;
        const label = factLabel(question.key, question.question, locale);
        const showContext = normalizedLabel(question.question) !== normalizedLabel(label);
        const value = answers[question.key] ?? '';
        const common = { id, label, value, disabled: busy };
        return <div className="assistant-question-field" key={question.key} data-question-key={question.key}>
          {showContext && <p className="assistant-question-context small" lang={replyLanguage}>{question.question}</p>}
          {booleanKeys.has(question.key) ? <fieldset id={id}><legend>{label}</legend><div className="assistant-radio-options">{[['true', 'Ja'], ['false', 'Nei'], ['', 'Vet ikke']].map(([choice, text]) => <PktRadioButton hasTile key={choice} id={`${id}-${choice || 'unknown'}`} name={id} label={t(text)} value={choice} checked={answers[question.key] !== undefined && choice === value} disabled={busy} onChange={() => change(question.key, choice)} />)}</div></fieldset>
            : question.key === 'income_basis' ? <PktSelect {...common} fullwidth onChange={event => change(question.key, event.target.value)}><option value="">{t('Velg')}</option>{['household_year', 'individual_year', 'month', 'unknown'].map(option => <option key={option} value={option}>{factValue(option, locale)}</option>)}</PktSelect>
            : amounts.has(question.key) ? <PktTextinput {...common} type="number" min={0} max={question.key === 'monthly_rent' ? 1000000 : 100000000} step="1" suffix="NOK" onChange={event => change(question.key, event.target.value)} />
            : question.key === 'household_size' ? <PktTextinput {...common} type="number" min={1} max={30} step="1" suffix={t('personer')} onChange={event => change(question.key, event.target.value)} />
            : question.key === 'move_date' ? <PktTextinput {...common} type="date" onChange={event => change(question.key, event.target.value)} />
            : question.key === 'new_municipality' ? <PktTextinput {...common} maxLength={100} fullwidth onChange={event => change(question.key, event.target.value)} />
            : <PktTextarea {...common} rows={3} maxLength={1000} fullwidth onChange={event => change(question.key, event.target.value)} />}
        </div>;
      })}
      {draft && <details className="assistant-answer-preview"><summary>{t('Se meldingen før sending')}</summary><pre>{draft}</pre></details>}
      {error && <p className="field-error" role="alert">{t(error)}</p>}
      <AssistantButton type="submit" disabled={busy} skin="secondary">{t('Send svar')}</AssistantButton>
    </form>
  </section>;
}
