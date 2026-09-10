# Søk én gang: MVP-plan

Status: ferdig. Opprettet og verifisert 3. september 2026.

## Utfall

En kjørbar, presentasjonsklar innbyggertjeneste på norsk: hent kjente opplysninger,
spør kun om mangler, utfør en etterprøvbar SFO-beregning, forklar, bekreft og vis
muligheten for ny vurdering neste skoleår.

## Rammer og avgrensning

- Full SFO-flyt for én syntetisk familie. Barnehage er neste adapter/regelfamilie.
- Next.js, TypeScript, lokale leverandører, én serverprosess på 127.0.0.1:3210.
- Ingen reelle persondata, autentisering, kommunale vedtak eller innsending.
- Registeropplysninger beholdes uendret når innbyggeren melder avvik.
- 6 %-prinsippet bygger på Udir; priser, timefordeling og datasett er demoforutsetninger.
- Ingen automatisk overgang fra en utilgjengelig ekstern kilde til lokale data.
- KI får aldri skrive til regelresultat eller sende inn en sak.
- Ingen endringer under sources/ eller i arrangørens repo.

## Faser

| Fase | Status | Leveranse |
|---|---|---|
| Kilder og API-er | Ferdig | [Kildearbeid](research/official-sources.md) |
| Arkitektur og datamodell | Ferdig | [Arkitektur](../../docs/architecture.md) |
| Domene og leverandører | Ferdig | Datakilder, regelmotor, sesjoner, prosesshendelse |
| Norsk brukerreise | Ferdig | Start, henting, kontroll, avvik, resultat, bekreftelse, 2027 |
| Verifikasjon | Ferdig | 22 enhets-/tjenestetester, 9 nettleser-/API-tester, bygg og kodegjennomgang |
| Presentasjonspakke | Ferdig | README, diagram, pitch, demoskript, juryspørsmål, sjekkliste |

## Akseptansekriterier

1. Hovedflyten fungerer uten internett etter installasjon og bygg.
2. Hvert datasett har opprinnelse, formål, hentetid og gyldig periode.
3. Manglende husholdningsopplysning spørres etter før vurdering.
4. Lavere nåværende inntekt bevares som innbyggeropplysning; manuell behandling.
5. Null, høye, manglende og ugyldige inntekter håndteres uten feilaktig innvilgelse.
6. Regelresultatet er uavhengig av forklaringstjenesten.
7. Bekreftelse kreves, er idempotent og gir en uttrykkelig lokal demokvittering.
8. 2027-visningen er en visjon med forutsetninger, ingen faktisk overvåking.
9. Hele flyten virker ved 375 px og med tastatur; ingen alvorlige automatiske a11y-funn.
10. Oppstart, begrensninger og alle presentasjonsleveranser er dokumentert.

## Avhengigheter og risiko

Pakker lastes ned én gang. Ingen eksterne skrifter lastes i nettleseren.
Sandkassens kontrakter er undersøkt på commit `656a5c69edbddad4b0e3f194c44289f12f09ef0d`.
Sandbox-SFO-data mangler timer og entydig prisgrunnlag for vår beregning; vi later ikke
som en rå API-kobling alene gir korrekt pris. Lokal testdata er derfor standard.
Regler og sakstilstand ligger på serveren; midlertidige sesjoner slettes ved omstart.

## Leveranse

Alle akseptansekriterier er kontrollert mot [verifikasjonsrapporten](reports/verification.md).
To samtidighetsfeil fra [kodegjennomgangen](reports/code-review.md) er rettet og dekket
av tester. De dokumenterte pilotspørsmålene er avgrensninger for videre integrasjon,
ikke uferdig lokal MVP-funksjonalitet.
