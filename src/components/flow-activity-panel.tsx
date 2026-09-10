'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, CardBlock, Checkbox, Details, DetailsContent, DetailsSummary, Heading, Paragraph, Tag, Textfield } from '@digdir/designsystemet-react';
import type { ActionAttempt, FlowActivity, FlowReminder } from '../domain/flow-action-types';
import { reminderCalendar } from '../domain/flow-catalogue';
import type { FlowOutcome } from '../domain/flow-types';
import styles from './sok-wizard.module.css';

type ActivityCommand = { action: 'check-receipt'; id: string; caseId: string; revision: number } | { action: 'confirm-not-submitted'; id: string; caseId: string; revision: number; confirmed: true; note: string } | { action: 'cancel-reminder'; id: string; version: number } | { action: 'edit-reminder'; id: string; version: number; title: string; date: string; time: string | null; note: string } | { action: 'read-notification'; id: string };

export function FlowActivityPanel({ caseId, revision, activity, outcomes, onRefresh }: { caseId: string; revision: number; activity: FlowActivity; outcomes: FlowOutcome[]; onRefresh: () => Promise<unknown> }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function mutate(command: ActivityCommand) {
    setPending(true); setError('');
    try {
      const response = await fetch('/api/flow/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Kunne ikke lagre endringen.'); }
      await onRefresh();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kunne ikke lagre endringen.'); await onRefresh().catch(() => {}); return false; }
    finally { setPending(false); }
  }
  return <div className={styles.stack} aria-busy={pending}>
    {error && <Alert data-color="danger" role="alert">{error}</Alert>}
    {activity.attempts.filter(attempt => attempt.status !== 'completed').map(attempt => <RecoveryCard key={attempt.id} attempt={attempt} caseId={caseId} revision={revision} pending={pending} mutate={mutate} onRefresh={onRefresh} />)}
    {activity.notifications.filter(notification => !notification.readAt).map(notification => <Alert key={notification.id} data-color="info" role="status">
      <Heading level={2} data-size="xs">{notification.title}</Heading><Paragraph className={styles.preservedText}>{notification.body}</Paragraph>
      <Button variant="secondary" disabled={pending} onClick={() => void mutate({ action: 'read-notification', id: notification.id })}>Merk varsel som lest</Button>
    </Alert>)}
    {activity.reminders.length > 0 && <section aria-label="Påminnelser" className={styles.stackSm}>
      <Heading level={2} data-size="xs">Påminnelser</Heading>
      {activity.reminders.map(reminder => <ReminderCard key={`${reminder.id}-${reminder.version}`} reminder={reminder} outcome={outcomes.find(outcome => outcome.id === reminder.outcomeId)} pending={pending} mutate={mutate} />)}
    </section>}
    {activity.reviews.length > 0 && <section aria-label="Menneskelig vurdering" className={styles.stackSm}>
      <Heading level={2} data-size="xs">Menneskelig vurdering</Heading>
      {activity.reviews.map(review => <Card key={review.id} data-color="neutral"><CardBlock className={styles.cardStack}>
        <Heading level={3} data-size="2xs">{review.title}</Heading><Tag data-color={review.status === 'resolved' ? 'success' : 'info'}>{review.status === 'queued' ? 'I lokal kø' : review.status === 'in-progress' ? 'Under vurdering' : 'Besvart'}</Tag>
        <Paragraph data-size="sm">Referanse: {review.id}. Dette er en lokal vurderingskø, ikke en innsending til en offentlig tjeneste.</Paragraph>
        <Details><DetailsSummary>Oppsummeringen som ble delt</DetailsSummary><DetailsContent><Paragraph className={styles.preservedText}>{review.summary}</Paragraph></DetailsContent></Details>
        {review.reply && <Paragraph className={styles.preservedText}>Svar: {review.reply}</Paragraph>}
      </CardBlock></Card>)}
    </section>}
    {activity.outbox.length > 0 && <Details><DetailsSummary>Lokal testutboks ({activity.outbox.length})</DetailsSummary><DetailsContent className={styles.stack}>
      <Paragraph>Ingen e-post er sendt. Her ligger nøyaktig det du godkjente.</Paragraph>
      {activity.outbox.map(email => <Card key={email.id} data-color="neutral"><CardBlock className={styles.cardStack}>
        <Paragraph>Til: {email.to}</Paragraph><Heading level={2} data-size="2xs">{email.subject}</Heading><Paragraph className={styles.preservedText}>{email.body}</Paragraph>
      </CardBlock></Card>)}
    </DetailsContent></Details>}
  </div>;
}

function RecoveryCard({ attempt, caseId, revision, pending, mutate, onRefresh }: { attempt: ActionAttempt; caseId: string; revision: number; pending: boolean; mutate: (command: ActivityCommand) => Promise<boolean>; onRefresh: () => Promise<unknown> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  return <Card data-color="warning"><CardBlock className={styles.cardStack}>
    <Heading level={2} data-size="xs">{attempt.status === 'failed' ? 'Handlingen kan forberedes på nytt' : attempt.status === 'running' ? 'Handlingen behandles' : 'Avklar tidligere handling'}</Heading>
    {attempt.error && <Paragraph>{attempt.error}</Paragraph>}
    <Paragraph data-size="sm">Referanse: {attempt.id}</Paragraph>
    {attempt.status === 'failed' ? <Paragraph>{attempt.resolution ? attempt.resolution.note : 'Innsendingen startet ikke.'} Rett eventuelle problemer med tjenesten, og lag et nytt utkast i skjemaet ovenfor. Du må godkjenne det på nytt.</Paragraph> : <>
      <Paragraph>Vi sender ikke på nytt før utfallet er avklart. En tom kvitteringsliste er ikke bevis på at ingenting ble registrert.</Paragraph>
      <Button variant="secondary" disabled={pending} onClick={() => void onRefresh().catch(() => {})}>Oppdater status</Button>
      {attempt.status === 'uncertain' && <>
        {attempt.canCheckReceipt && <Button variant="secondary" disabled={pending} onClick={() => void mutate({ action: 'check-receipt', id: attempt.id, caseId, revision })}>Sjekk kvittering hos KS</Button>}
        <Details><DetailsSummary>Jeg har kontrollert at handlingen ikke ble registrert</DetailsSummary><DetailsContent className={styles.stack}>
          <Paragraph>Kontroller med mottakeren eller ansvarlig for tjenesten først. Dette valget sender ingenting og lagrer avklaringen i saken.</Paragraph>
          <Textfield label="Hvordan kontrollerte du utfallet?" value={note} onChange={event => setNote(event.target.value)} maxLength={400} />
          <Checkbox label="Jeg bekrefter at handlingen ikke ble registrert" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          <Button disabled={pending || !confirmed || note.trim().length < 10} onClick={() => void mutate({ action: 'confirm-not-submitted', id: attempt.id, caseId, revision, confirmed: true, note })}>Lagre avklaring og tillat nytt utkast</Button>
        </DetailsContent></Details>
      </>}
    </>}
  </CardBlock></Card>;
}

function ReminderCard({ reminder, outcome, pending, mutate }: { reminder: FlowReminder; outcome: FlowOutcome | undefined; pending: boolean; mutate: (command: ActivityCommand) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(reminder.title);
  const [date, setDate] = useState(reminder.date);
  const [time, setTime] = useState(reminder.time ?? '');
  const [note, setNote] = useState(reminder.note);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await mutate({ action: 'edit-reminder', id: reminder.id, version: reminder.version, title, date, time: time || null, note })) setEditing(false);
  }
  return <Card data-color="neutral"><CardBlock className={styles.cardStack}>
    <Heading level={3} data-size="2xs">{reminder.title}</Heading>
    <Tag data-color={reminder.status === 'cancelled' ? 'neutral' : 'info'}>{reminder.status === 'scheduled' ? 'Planlagt' : reminder.status === 'fired' ? 'Varsel opprettet' : 'Avbrutt'}</Tag>
    <Paragraph>{reminder.date} {reminder.time ?? ''} · {reminder.timezone}</Paragraph>
    {reminder.note && <Paragraph className={styles.preservedText}>{reminder.note}</Paragraph>}
    {editing ? <form className={styles.stack} onSubmit={submit}>
      <Textfield label="Tittel på påminnelsen" value={title} onChange={event => setTitle(event.target.value)} required />
      <div className={styles.fieldGrid}><Textfield label="Ny dato" type="date" value={date} onChange={event => setDate(event.target.value)} required /><Textfield label="Nytt klokkeslett" type="time" value={time} onChange={event => setTime(event.target.value)} /></div>
      <Textfield multiline label="Merknad til påminnelsen" value={note} onChange={event => setNote(event.target.value)} />
      <div className={styles.navRow}><Button type="submit" disabled={pending}>Lagre påminnelsen</Button><Button type="button" variant="tertiary" disabled={pending} onClick={() => setEditing(false)}>Lukk uten å lagre</Button></div>
    </form> : reminder.status === 'scheduled' && <div className={styles.navRow}>
      <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>Endre påminnelsen</Button>
      {outcome && <Button variant="secondary" onClick={() => {
        const current = { ...outcome, title: reminder.title, payload: { date: reminder.date, time: reminder.time, note: reminder.note } };
        const url = URL.createObjectURL(new Blob([reminderCalendar(current)], { type: 'text/calendar;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `paaminnelse-${reminder.id}.ics`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Last ned kalenderfil (.ics)</Button>}
      <Button variant="tertiary" disabled={pending} onClick={() => void mutate({ action: 'cancel-reminder', id: reminder.id, version: reminder.version })}>Avbryt påminnelsen</Button>
    </div>}
  </CardBlock></Card>;
}
