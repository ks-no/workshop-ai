'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardBlock, Checkbox, Details, DetailsContent, DetailsSummary, Heading, Paragraph, Select, SelectOption, Tabs, TabsList, TabsTab, TabsPanel, Tag } from '@digdir/designsystemet-react';
import { House, UsersThree, Truck, ChatCircle, ArrowRight } from '@phosphor-icons/react';
import { familyTimeline, supportMap } from '../domain/family-overview';
import type { FlowCase, FlowResponse } from '../domain/flow-types';
import type { FlowActivity } from '../domain/flow-action-types';
import styles from './family-overview.module.css';

const icons = { family: UsersThree, home: House, moving: Truck, help: ChatCircle };
const date = (at: string) => new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo' }).format(new Date(at));

export function FamilyOverview({ session, activity, onChoose, onReview, onRefresh }: {
  session: FlowCase; activity?: FlowActivity;
  onChoose: (type: 'form' | 'reminder' | 'contact', templateId?: string) => void;
  onReview: () => void; onRefresh: () => Promise<FlowResponse>;
}) {
  const [tab, setTab] = useState('map');
  const [selected, setSelected] = useState('sfo-reduced-payment');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const services = supportMap(session);
  const service = services.find(item => item.templateId === selected)!;
  const marks = activity?.checklist ?? [];
  const timeline = familyTimeline(session, activity);
  const confirmed = session.facts.filter(fact => fact.status === 'confirmed');
  const checked = service.documents.filter(document => marks.find(mark => mark.key === document.key)?.checked).length;

  async function toggle(key: string, value: boolean) {
    setPending(true); setError('');
    try {
      const response = await fetch('/api/flow/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'checklist', caseId: session.id, key, checked: value, version: marks.find(mark => mark.key === key)?.version ?? 0 }) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? 'Kunne ikke lagre sjekkpunktet.'); }
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kunne ikke lagre sjekkpunktet.');
      await onRefresh().catch(() => {});
    } finally { setPending(false); }
  }

  return <section className={styles.overview} aria-label="Familieoversikt">
    <header className={styles.heading}>
      <Tag data-color="accent">Din sak · samlet oversikt</Tag>
      <Heading level={1} data-size="md" tabIndex={-1} ref={heading}>Familieoversikt</Heading>
      <Paragraph>Se mulige tjenester, hva du må ha klart, og hva som skjer videre.</Paragraph>
    </header>
    <Tabs value={tab} onChange={setTab}>
      <TabsList className={styles.tabs} aria-label="Visning i familieoversikten">
        <TabsTab value="map">Støttekart</TabsTab>
        <TabsTab value="checklist">Sjekkliste</TabsTab>
        <TabsTab value="timeline">Tidslinje</TabsTab>
      </TabsList>
      <TabsPanel value="map" className={styles.panel}>
        <Card data-color="accent" variant="tinted" className={styles.family}><CardBlock>
          <UsersThree size={32} aria-hidden="true" />
          <Heading level={2} data-size="xs">Familien og situasjonen din</Heading>
          <Paragraph className={styles.text}>{session.situation}</Paragraph>
          <Details><DetailsSummary>Bekreftede opplysninger ({confirmed.length})</DetailsSummary><DetailsContent>
            {confirmed.length ? <dl>{confirmed.map(fact => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : <Paragraph>Ingen opplysninger er bekreftet ennå.</Paragraph>}
            <Button variant="tertiary" onClick={onReview}>Kontroller opplysninger</Button>
          </DetailsContent></Details>
        </CardBlock></Card>
        <Paragraph data-size="sm">Dette er tjenester du kan utforske, ikke en vurdering av hva du har rett på.</Paragraph>
        <div className={styles.branches} aria-label="Mulige tjenester">
          {services.map(item => { const Icon = icons[item.icon]; const known = item.requirements.filter(field => field.confirmed).length;
            return <Card key={item.templateId} data-color="neutral" className={styles.service}><CardBlock className={styles.stack}>
              <Icon size={28} aria-hidden="true" /><Heading level={2} data-size="xs">{item.title}</Heading>
              <Paragraph data-size="sm">{item.description}</Paragraph>
              <Tag data-color="info" data-size="sm">{known} av {item.requirements.length} opplysninger bekreftet</Tag>
              <Paragraph data-size="xs">{item.form.recipient.name} · {item.form.submission === 'ks-sandbox' ? 'KS-testsøknad' : 'Lokal forberedelse'}</Paragraph>
              <Button variant="secondary" onClick={() => { setSelected(item.templateId); setTab('checklist'); }}>Se sjekkliste for {item.title.toLocaleLowerCase('nb-NO')}</Button>
              <Button variant="tertiary" onClick={() => onChoose('form', item.templateId)}>Åpne skjema <ArrowRight aria-hidden="true" /></Button>
            </CardBlock></Card>;
          })}
        </div>
        <Button variant="secondary" onClick={() => onChoose('contact')}>Be om menneskelig hjelp</Button>
      </TabsPanel>
      <TabsPanel value="checklist" className={styles.panel}>
        <Heading level={2} data-size="sm">Din sjekkliste</Heading>
        <div className={styles.stack}>
          <label htmlFor="family-service">Velg tjeneste</label>
          <Select id="family-service" value={selected} onChange={event => setSelected(event.target.value)}>{services.map(item => <SelectOption key={item.templateId} value={item.templateId}>{item.title}</SelectOption>)}</Select>
        </div>
        <Card data-color="neutral"><CardBlock className={styles.stack}>
          <Heading level={3} data-size="xs">Opplysninger til skjemaet</Heading>
          <ul className={styles.requirements}>{service.requirements.map(field => <li key={field.id}>
            <Tag data-size="sm" data-color={field.confirmed ? 'success' : 'warning'}>{field.confirmed ? 'Bekreftet' : 'Mangler bekreftelse'}</Tag>
            <div><strong>{field.label}</strong>{field.value && <Paragraph data-size="sm">{field.value}</Paragraph>}{field.source && <Paragraph data-size="xs">Kilde: {field.source}</Paragraph>}</div>
          </li>)}</ul>
          <Button variant="tertiary" onClick={onReview}>Kontroller eller rett opplysninger</Button>
        </CardBlock></Card>
        <Card data-color="neutral"><CardBlock className={styles.stack}>
          <Heading level={3} data-size="xs">Dokumenter du har klare</Heading>
          <Paragraph data-size="sm">Avkrysningene er din huskeliste. De laster ikke opp dokumenter og godkjenner ikke opplysninger eller søknader.</Paragraph>
          {error && <Alert data-color="danger" role="alert">{error}</Alert>}
          {service.documents.length ? <>
            <Paragraph role="status">{checked} av {service.documents.length} dokumenter markert klare</Paragraph>
            {service.documents.map(document => <Checkbox key={document.key} label={document.label} checked={marks.find(mark => mark.key === document.key)?.checked ?? false} disabled={pending} onChange={event => void toggle(document.key, event.target.checked)} />)}
          </> : <Paragraph>Ingen fast dokumentliste for denne tjenesten. Avklar behovet med mottakeren.</Paragraph>}
        </CardBlock></Card>
        <Button onClick={() => onChoose('form', selected)}>Fortsett med dette skjemaet <ArrowRight aria-hidden="true" /></Button>
      </TabsPanel>
      <TabsPanel value="timeline" className={styles.panel}>
        <Heading level={2} data-size="sm">Sakens tidslinje</Heading>
        <Paragraph data-size="sm">Registrerte steg og oppfølging, i tidsrekkefølge. Alle klokkeslett er i Europe/Oslo.</Paragraph>
        <ol className={styles.timeline}>{timeline.map(entry => <li key={entry.id} data-scheduled={entry.scheduled}>
          <time dateTime={entry.at}>{date(entry.at)}</time>
          <Heading level={3} data-size="xs">{entry.title}</Heading>
          <Tag data-size="sm" data-color={entry.scheduled ? 'accent' : 'neutral'}>{entry.status}</Tag>
          <Paragraph data-size="sm" className={styles.text}>{entry.detail}</Paragraph>
        </li>)}</ol>
        <Button variant="secondary" onClick={() => onChoose('reminder')}>Legg til en påminnelse</Button>
        <Paragraph data-size="sm">Påminnelser kan endres eller avbrytes i veiviserens påminnelsesoversikt.</Paragraph>
      </TabsPanel>
    </Tabs>
  </section>;
}
