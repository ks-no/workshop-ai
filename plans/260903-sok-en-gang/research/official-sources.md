# Kildearbeid: hackathon og SFO

Undersøkt 3. september 2026. Metode: arrangørens e-post, primære nettsider og direkte
lesing av det offentlige repoets dokumenter, OpenAPI og relevante implementasjoner.
Repo-referanse: `656a5c69edbddad4b0e3f194c44289f12f09ef0d`.

## Konklusjon

Bruksområdet passer godt til arrangørens problemstilling om tjenester som kan starte
uten skjema og KI med etterprøvbar ansvarsdeling. Sandkassen tilbyr faktiske kjørbare
API-er med syntetiske data. Reell Fiks-tilgang følger ikke automatisk med.

MVP-valget er en selvstendig SFO-klient med egne syntetiske data og dokumenterte
tilkoblingspunkter. Den kjører uten Docker og eksterne modeller. Dette gir en stabil
demo, samtidig som den ikke later som uavklarte felt eller tilganger eksisterer.

## Offisielle kilder

| Kilde | Kontrollert funn | Konsekvens |
|---|---|---|
| [Dokumentasjonskart](https://github.com/ks-no/workshop-ai/blob/main/docs/README.md) | Anbefalt lesesti og tjenestekart | Leste oppdrag, deltakerstart og bygg-selv |
| [Oppdraget](https://github.com/ks-no/workshop-ai/blob/main/docs/oppdraget.md) | Fritt grensesnitt, data og regler skilt fra KI, tre priser | Innbyggerkontroll er kjernen i vår demo |
| [Deltakerstart](https://github.com/ks-no/workshop-ai/blob/main/docs/deltakerstart.md) | SFO-person `person-022`; oversikt 3001, prosessbygger 3000 | Appen bruker port 3210; testpersonene blandes ikke |
| [Bygg selv](https://github.com/ks-no/workshop-ai/blob/main/docs/bygg-selv.md) | Egen frontend tillatt; token og samtykke håndheves på sentrale flater | Egne adaptere; ingen omgåelse av tilgang |
| [API-oversikt](https://github.com/ks-no/workshop-ai/blob/main/docs/api-oversikt.md) | OpenAPI er autoritet; `/helse` er riktig rute | Inspeksjonsskript bruker faktisk dokumenterte ruter |
| [Backend OpenAPI](https://github.com/ks-no/workshop-ai/blob/main/openapi/sandbox-backend.yaml) | SFO, husholdning og inntekt har ulike responsformer | Pris/timer må avklares før reell kobling |
| [Curl-kokebok](https://github.com/ks-no/workshop-ai/blob/main/examples/curl/README.md) | Prosessøkt, samtykke og innlevering er en ordnet flyt | Lokal bekreftelse er foreløpig bare egen prosesshendelse |
| [Fiks Folkeregister](https://developers.fiks.ks.no/tjenester/register/folkeregister/) | Reell tjeneste for oppslag, uttrekk og hendelser; avtalte tilganger | Produksjonsadapter krever avtaler, sertifikater og Maskinporten |
| [Fiks skatt og inntekt](https://developers.fiks.ks.no/tjenester/register/skatteoginntektsopplysninger/index.html) | BARNEHAGE_SFO og redusert-foreldrebetaling er dokumentert | Inntektsintegrasjon er plausibel, men ikke aktivert |
| [Udir, SFO-finansiering](https://www.udir.no/regelverk-og-tilsyn/skole-og-opplaring/rundskriv-om-skolefritidsordninga/finansiering-av-skolefritidsordninga/) | Inntektsavhengig moderasjon, gratistimer og behandling | Avgrenset, kildeforankret demoberegning |
| [Digdir, lommebok](https://docs.digdir.no/docs/lommebok/lommebok_om.html) | Nasjonal sandkasse med egen arkitektur og tjenester | Mulig ny beviskilde; separat integrasjon |
| [Digdir, tjenester](https://docs.digdir.no/docs/lommebok/lommebok_tjenester.html) | Utstedere, lommebøker og verifiseringstjenester | Ingen oppdiktet lommebokkontrakt |
| [Next.js installasjon](https://nextjs.org/docs/app/getting-started/installation) | Gjeldende oppsett for App Router | Next.js/React/TypeScript, låst av package-lock |

Dato/sted og organisering bygger på e-posten brukeren la ved. Oppdraget omtaler 15
minutter per team fredag; treminutters-pitchen er vår korte versjon, ikke en påstand
om endelig tildelt presentasjonstid.

## Validering av bruksområdet

Udir beskriver inntektsavhengig moderasjon på 1.–4. trinn. Lokale prisdata er nødvendig.
Samboerforhold kan kreve innbyggeropplysninger, og varig inntektsfall kan kreve
dokumentasjon og skjønn. Derfor har demoen både et manglende spørsmål og manuell flyt.

Muligheten for nye vurderinger gjennom søknadsperioden gir et reelt utgangspunkt for
2027-visjonen. Den er fortsatt en visjon med forutsetninger, ikke en implementert
automatisk fornyelsesordning.

## Teknisk beslutning

Adaptere normaliserer data til en liten intern modell. De er ikke tomme skall eller
falske live-integrasjoner: mock-implementasjonene leser et faktisk lokalt datasett.
Den rene regelmotoren har ingen avhengighet til nettverk eller KI. Forklaringer kan
aldri skrive saken eller beregningen. Priser og timefordeling er merket som demo.

## Sikkerhet og pålitelighet

Trusselbildet i denne leveransen er en lokal prototype med syntetiske data, ikke et
kommunalt produksjonssystem. Viktige grenser er ingen umerket ekstern overføring,
ingen KI-beslutning, ingen stille endring av registergrunnlag og ingen faktisk innsending.
Cookie, opprinnelsessjekk og validering støtter demoen; de erstatter ikke reell eID.

Ingen internettavhengighet i standardbruk etter pakkeinstallasjon og bygg. Lokal KI
er valgfri og avgrenset til emneklassifisering. Den leverte demoen bruker maltekst.

## Uavklarte spørsmål før integrert pilot

1. Hvilken kommune eier prisgrunnlaget, regeltolkning og vedtaksprosess?
2. Hvor hentes avtalte uketimer, matpris og betalingsmåneder?
3. Hvilken søknadsperiode kan omfattes av ny vurdering uten ny søknad?
4. Hvilke Fiks-/sandbox-tilganger er tilgjengelige for laget, med hvilke hjemler?
5. Hvilken prosessdefinisjon skal motta bekreftelsen, og hva skal utløse manuell behandling?

Disse spørsmålene blokkerer ikke den lokale demonstrasjonen. Neste steg er beskrevet i
[integrasjonsnotatet](../../../docs/integrations.md).
