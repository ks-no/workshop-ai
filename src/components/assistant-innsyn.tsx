'use client';

import { useEffect, useState } from 'react';
import { useAssistantLocale } from './assistant-i18n';
import { AssistantIcon } from './assistant-controls';
import type { AssistantCase, ModelRole } from '../domain/assistant-types';

type InnsynEvent = {
  id: string; at: string; kind: 'samtykke' | 'oppslag' | 'modellkall' | 'regelberegning' | 'bekreftelse';
  title: string; detail: string;
  endpoint?: string; scope?: string; syntetisk?: boolean;
  model?: string; role?: ModelRole; latencyMs?: number | null; strippedFields?: string[];
  terskel?: string; inndata?: Record<string, unknown>; beregning?: string; utfall?: string; hjemmel?: string;
};

const roleNames: Record<ModelRole, string> = { triage: 'Triage', draft: 'Utkast', critic: 'Kritiker', polish: 'Språkvask' };

const kindNames: Record<InnsynEvent['kind'], string> = {
  samtykke: 'Samtykke', oppslag: 'Registeroppslag', modellkall: 'Modellkall', regelberegning: 'Regelberegning', bekreftelse: 'Innbyggerbekreftelse',
};

/**
 * Read-only forvaltningsinnsyn: viser hele behandlingskjeden for den aktive saken, korrelert
 * på sporingsId (saken sin egen id). Henter kun via GET /api/assistant/innsyn, ingen mutasjon.
 */
export function AssistantInnsyn({ session, active }: { session: AssistantCase | null; active: boolean }) {
  const { t, dateTime } = useAssistantLocale();
  const [events, setEvents] = useState<InnsynEvent[] | null>(null);
  const [sporingsId, setSporingsId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active || !session) return;
    let cancelled = false;
    fetch('/api/assistant/innsyn', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{ sporingsId: string; events: InnsynEvent[] }>;
    }).then(data => { if (!cancelled) { setError(''); setEvents(data.events); setSporingsId(data.sporingsId); } })
      .catch(() => { if (!cancelled) setError('Kunne ikke hente forvaltningsinnsynet.'); });
    return () => { cancelled = true; };
  }, [active, session, session?.id, session?.revision]);

  if (!session) return <div className="assistant-empty"><AssistantIcon name="document-text" aria-hidden="true" /><p>{t('Ingen sak er lastet ennå.')}</p></div>;

  return <section className="assistant-case-section assistant-innsyn-panel" aria-labelledby="innsyn-heading">
    <div className="assistant-section-heading"><h2 id="innsyn-heading" tabIndex={-1}>{t('Forvaltningsinnsyn')}</h2></div>
    <p className="assistant-section-intro">{t('Hele behandlingskjeden for denne saken, sporet med samme id gjennom samtykke, registeroppslag, modellkall og regelberegning. Ingen fødselsnummer, navn eller adresser vises her.')}</p>
    {sporingsId && <p className="small">{t('Sporings-id:')} <code>{sporingsId}</code></p>}
    {error && <p className="assistant-error" role="alert">{t(error)}</p>}
    {!error && !events && <p className="small">{t('Henter behandlingskjeden…')}</p>}
    {!error && events && !events.length && <div className="assistant-empty"><AssistantIcon name="document-text" aria-hidden="true" /><p>{t('Ingen hendelser er registrert for denne saken ennå.')}</p></div>}
    {!!events?.length && <ol className="assistant-innsyn-timeline">{events.map(event => <li key={event.id}>
      <div className="assistant-innsyn-header"><strong>{t(kindNames[event.kind])}</strong><time className="small" dateTime={event.at}>{dateTime(event.at)}</time></div>
      <p>{t(event.title)}</p>
      <p className="small">{t(event.detail)}</p>
      {event.kind === 'oppslag' && <dl className="assistant-source-meta">
        {event.endpoint && <div><dt>{t('Endepunkt')}</dt><dd>{event.endpoint}</dd></div>}
        {event.scope && <div><dt>{t('Token-scope')}</dt><dd>{event.scope}</dd></div>}
        <div><dt>{t('Syntetiske data')}</dt><dd>{t(event.syntetisk ? 'Ja' : 'Ukjent')}</dd></div>
      </dl>}
      {event.kind === 'modellkall' && <dl className="assistant-source-meta">
        {event.model && <div><dt>{t('Modell')}</dt><dd>{event.model}</dd></div>}
        {event.role && <div><dt>{t('Rolle')}</dt><dd>{t(roleNames[event.role])}</dd></div>}
        <div><dt>{t('Responstid')}</dt><dd>{event.latencyMs == null ? t('Ukjent') : `${event.latencyMs} ms`}</dd></div>
        <div><dt>{t('Fjernede identitetsfelt før prompt')}</dt><dd>{event.strippedFields?.length ? event.strippedFields.join(', ') : t('Ingen')}</dd></div>
      </dl>}
      {event.kind === 'regelberegning' && <dl className="assistant-source-meta">
        {event.terskel && <div><dt>{t('Terskelverdi (satser)')}</dt><dd>{event.terskel}</dd></div>}
        {event.inndata && <div><dt>{t('Inndata')}</dt><dd>{Object.entries(event.inndata).map(([key, value]) => `${key}: ${value}`).join(', ')}</dd></div>}
        {event.beregning && <div><dt>{t('Beregning')}</dt><dd>{event.beregning}</dd></div>}
        {event.utfall && <div><dt>{t('Utfall')}</dt><dd>{t(event.utfall)}</dd></div>}
        {event.hjemmel && <div><dt>{t('Rettslig grunnlag')}</dt><dd>{event.hjemmel}</dd></div>}
      </dl>}
    </li>)}</ol>}
  </section>;
}
