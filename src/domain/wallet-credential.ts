import { z } from 'zod';
import type { AssistantCase } from './assistant-types';
import { sfoAnswer } from './sfo-answer';

/** A non-resolving demo vocabulary; JSON-LD only needs the terms mapped, not a live document. */
export const VC_CONTEXT = ['https://www.w3.org/ns/credentials/v2', {
  sokEnGang: 'https://sok-en-gang.hackathon.example/vocab#',
  ordning: 'sokEnGang:ordning', utfall: 'sokEnGang:utfall',
  gyldigFra: 'sokEnGang:gyldigFra', gyldigTil: 'sokEnGang:gyldigTil',
  demosignatur: 'sokEnGang:demosignatur', tillitsforankring: 'sokEnGang:tillitsforankring',
}] as const;

export const verifiableCredentialSchema = z.object({
  '@context': z.tuple([z.literal(VC_CONTEXT[0]), z.record(z.string(), z.string())]),
  type: z.array(z.string()).min(2).refine(list => list.includes('VerifiableCredential'), 'Mangler VerifiableCredential-typen.'),
  issuer: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  credentialSubject: z.object({
    ordning: z.string().min(1).max(200),
    utfall: z.enum(['innvilget', 'avslag']),
    gyldigFra: z.string().min(1),
    gyldigTil: z.string().min(1),
    demosignatur: z.literal(true),
    tillitsforankring: z.literal('ingen'),
  }).strict(),
  proof: z.object({
    type: z.literal('DemoEd25519Signature'),
    created: z.iso.datetime(),
    verificationMethod: z.string().min(1),
    proofPurpose: z.literal('assertionMethod'),
    publicKeyBase64: z.string().min(1),
    proofValue: z.string().min(1),
  }).strict(),
}).strict();
export type VerifiableCredential = z.infer<typeof verifiableCredentialSchema>;

export type WalletCredentialPackage = {
  credential: VerifiableCredential;
  credentialOfferUri: string;
  qrSvg: string;
  demoNotice: string;
};

export type ModerationCredentialClaims = { ordning: string; utfall: 'innvilget' | 'avslag'; gyldigFra: string; gyldigTil: string };

function addYears(isoDate: string, years: number): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

/**
 * Only the deterministic KS outcome the citizen's current answers still match is issuable —
 * a conflicting basis would let the wallet claim a right the situation no longer supports.
 */
export function moderationCredentialClaims(session: Pick<AssistantCase, 'sources' | 'facts'>): ModerationCredentialClaims | null {
  const answer = sfoAnswer(session);
  if (!answer || answer.basisConflict) return null;
  // gjelderFra is a free-form string in the KS response, and validFrom/validUntil are built from it.
  const effectiveFrom = answer.effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(answer.effectiveFrom) ? answer.effectiveFrom : null;
  const gyldigFra = effectiveFrom ?? new Date().toISOString().slice(0, 10);
  return {
    ordning: answer.scheme ?? 'Skolefritidsordning (SFO) – redusert foreldrebetaling',
    utfall: answer.eligible ? 'innvilget' : 'avslag',
    gyldigFra, gyldigTil: addYears(gyldigFra, 1),
  };
}
