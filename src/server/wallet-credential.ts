import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signEd25519, type KeyObject } from 'node:crypto';
import qrcode from 'qrcode-generator';
import type { AssistantCase } from '../domain/assistant-types';
import { moderationCredentialClaims, verifiableCredentialSchema, VC_CONTEXT, type VerifiableCredential, type WalletCredentialPackage } from '../domain/wallet-credential';

const ISSUER_ID = 'urn:sok-en-gang:demo-issuer';
const ISSUER_NAME = 'Søk én gang – hackathondemo (ingen kommune eller nasjonal instans har signert dette)';
const VERIFICATION_METHOD = `${ISSUER_ID}#demo-key-1`;
const DEMO_NOTICE = 'Demosignatur med en lokal nøkkel generert av demoen. Ingen kommune, Digdir eller annen tillitsforankring har godkjent eller signert dette beviset, og signaturtypen er ikke en registrert W3C-kryptosuite. En ekte lommebok vil ikke kunne verifisere den.';

/** Ephemeral by default; WALLET_VC_PRIVATE_KEY_PEM lets a demo run keep the same issuer key across restarts without committing one. */
function loadKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  const pem = process.env.WALLET_VC_PRIVATE_KEY_PEM;
  if (pem) {
    try {
      // A PEM pasted into .env keeps its line breaks escaped.
      const privateKey = createPrivateKey(pem.includes('-----BEGIN') && pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem);
      return { privateKey, publicKey: createPublicKey(privateKey) };
    } catch {
      // This module loads on every assistant request; an unusable demo key must not take the app down with it.
      console.warn('WALLET_VC_PRIVATE_KEY_PEM kunne ikke leses. Bruker en flyktig demonøkkel i stedet.');
    }
  }
  return generateKeyPairSync('ed25519');
}
const state = globalThis as typeof globalThis & { walletCredentialKeyPair?: ReturnType<typeof loadKeyPair> };
const keyPair = state.walletCredentialKeyPair ??= loadKeyPair();
const publicKeyBase64 = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function signPayload(payload: unknown): string {
  return signEd25519(null, Buffer.from(JSON.stringify(payload), 'utf8'), keyPair.privateKey).toString('base64');
}

/** Not a registered W3C cryptosuite: no JSON-LD canonicalization is done, only a plain JSON signature over the unsigned fields. */
export function buildModerationCredential(session: AssistantCase): VerifiableCredential | null {
  const claims = moderationCredentialClaims(session);
  if (!claims) return null;
  const unsigned = {
    '@context': VC_CONTEXT,
    type: ['VerifiableCredential', 'ModerasjonsbevisCredential'],
    issuer: { id: ISSUER_ID, name: ISSUER_NAME },
    validFrom: `${claims.gyldigFra}T00:00:00.000Z`,
    validUntil: `${claims.gyldigTil}T00:00:00.000Z`,
    credentialSubject: {
      ordning: claims.ordning, utfall: claims.utfall, gyldigFra: claims.gyldigFra, gyldigTil: claims.gyldigTil,
      demosignatur: true as const, tillitsforankring: 'ingen' as const,
    },
  };
  const proof = {
    type: 'DemoEd25519Signature' as const, created: new Date().toISOString(), verificationMethod: VERIFICATION_METHOD,
    proofPurpose: 'assertionMethod' as const, publicKeyBase64, proofValue: signPayload(unsigned),
  };
  return verifiableCredentialSchema.parse({ ...unsigned, proof });
}

/** OpenID4VCI credential-offer shape only; no issuer endpoint actually serves it — the live wallet gateway is out of scope for this demo. */
function credentialOfferUri(session: AssistantCase): string {
  const offer = {
    credential_issuer: 'https://demo.sok-en-gang.local/issuer',
    credential_configuration_ids: ['ModerasjonsbevisCredential'],
    grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': `demo-${session.id}-${session.revision}` } },
  };
  return `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(offer))}`;
}

function renderQrSvg(uri: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}

export function walletCredentialPackage(session: AssistantCase): WalletCredentialPackage | null {
  try {
    const credential = buildModerationCredential(session);
    if (!credential) return null;
    const uri = credentialOfferUri(session);
    return { credential, credentialOfferUri: uri, qrSvg: renderQrSvg(uri), demoNotice: DEMO_NOTICE };
  } catch (error) {
    // The bevis rides along with the overlevering; it must never be what blocks it.
    console.warn(`Moderasjonsbeviset kunne ikke utstedes: ${error instanceof Error ? error.message : 'ukjent feil'}`);
    return null;
  }
}
