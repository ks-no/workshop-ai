'use client';

import { AssistantIcon } from './assistant-controls';
import { useAssistantLocale } from './assistant-i18n';

import type { Citation, EvidenceSource } from '../domain/assistant-types';

const sourceKinds: Record<EvidenceSource['kind'], string> = {
  conversation: 'Samtale', document: 'Opplastet dokument', register: 'Registeropplysning', guidance: 'Veiledning',
};

export function AssistantEvidence({ citation, sources }: { citation: Citation; sources: EvidenceSource[] }) {
  const { t } = useAssistantLocale();
  const source = sources.find(item => item.id === citation.sourceId);
  return <details className="assistant-evidence">
    <summary>{t("Se kilde")}{citation.page !== null ? ` · ${t('side')} ${citation.page}` : ''}</summary>
    <div className="assistant-evidence-body">
      <blockquote>{citation.quote}</blockquote>
      <p className="small">{t(source?.title ?? 'Kilden er ikke tilgjengelig')} · {citation.page !== null ? `${t('Side')} ${citation.page}, ` : ''}{t("linje")} {citation.lineStart}{citation.lineEnd !== citation.lineStart ? `–${citation.lineEnd}` : ''}</p>
      {source && <SourceMetadata source={source} />}
    </div>
  </details>;
}

function SourceMetadata({ source }: { source: EvidenceSource }) {
  const { t, dateTime } = useAssistantLocale();
  const safeUrl = source.url && /^https?:\/\//i.test(source.url) ? source.url : null;
  return <>
    <dl className="assistant-source-meta">
      <div><dt>{t("Kildetype")}</dt><dd>{t(sourceKinds[source.kind])}</dd></div>
      <div><dt>{t("Hentet")}</dt><dd><time dateTime={source.retrievedAt}>{dateTime(source.retrievedAt)}</time></dd></div>
      <div><dt>{t("Gjelder")}</dt><dd>{t(source.period || 'Ikke angitt')}</dd></div>
      <div><dt>{t("Formål")}</dt><dd>{t(source.purpose)}</dd></div>
    </dl>
    {safeUrl && <a className="assistant-source-link" href={safeUrl} target="_blank" rel="noreferrer">{t("Åpne originalkilden")} <AssistantIcon name="arrow-up-right" aria-hidden="true"  /></a>}
    <details className="assistant-raw-source"><summary>{t("Les lagret kildetekst")}</summary><pre tabIndex={0}>{source.text}</pre></details>
  </>;
}

export function AssistantSource({ source }: { source: EvidenceSource }) {
  const { t } = useAssistantLocale();
  return <details className="assistant-source">
    <summary><span>{t(source.title)}</span><span className="small">{t(sourceKinds[source.kind])}</span></summary>
    <SourceMetadata source={source} />
  </details>;
}
