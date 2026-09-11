'use client';

import type { WalletCredentialPackage } from '../domain/wallet-credential';
import { AssistantIcon } from './assistant-controls';
import { useAssistantLocale } from './assistant-i18n';
import { PktTag } from './punkt-react';

export function AssistantWalletCredential({ credential }: { credential: WalletCredentialPackage }) {
  const { t, dateTime } = useAssistantLocale();
  const subject = credential.credential.credentialSubject;
  return <section className="assistant-wallet-credential" aria-labelledby="wallet-credential-heading">
    <div className="assistant-section-heading">
      <h3 id="wallet-credential-heading">{t('Moderasjonsbevis for lommebok')}</h3>
      <PktTag size="small" skin="yellow"><AssistantIcon name="alert-warning" aria-hidden="true" />{t('Demosignatur – ingen tillitsforankring')}</PktTag>
    </div>
    <p className="small">{t(credential.demoNotice)}</p>
    <div className="assistant-wallet-credential-body">
      <div className="assistant-wallet-qr" role="img" aria-label={t('QR-kode med et OpenID4VCI credential-offer for dette beviset')} dangerouslySetInnerHTML={{ __html: credential.qrSvg }} />
      <dl className="assistant-wallet-attributes">
        <div><dt>{t('Ordning')}</dt><dd>{subject.ordning}</dd></div>
        <div><dt>{t('Utfall')}</dt><dd>{t(subject.utfall === 'innvilget' ? 'Innvilget' : 'Avslag')}</dd></div>
        <div><dt>{t('Gyldig fra')}</dt><dd>{subject.gyldigFra}</dd></div>
        <div><dt>{t('Gyldig til')}</dt><dd>{subject.gyldigTil}</dd></div>
        <div><dt>{t('Utsteder')}</dt><dd>{t(credential.credential.issuer.name)}</dd></div>
        <div><dt>{t('Signert')}</dt><dd>{dateTime(credential.credential.proof.created)}</dd></div>
      </dl>
    </div>
    <p className="small">{t('Ingen inntektstall eller fødselsnummer er lagt inn i beviset. Formatet er W3C Verifiable Credentials, med et OpenID4VCI credential-offer i QR-koden.')}</p>
  </section>;
}
