# Integrasjoner: undersøkt og neste steg

Kontrollert 4. september 2026. Arrangørens repo er lest på festet commit
`656a5c69edbddad4b0e3f194c44289f12f09ef0d`.
Søk én gang bruker KS workshop-tjenestene for syntetisk husstand, SFO,
inntektsgrunnlag, regelvurdering og samtykke. ID-porten- og Maskinporten-token
utstedes av `digdir-mock`. Ingen virkelige personopplysninger leses.

## Interaktive handlinger

Forsiden har en eksplisitt mock-utboks, en faktisk lokal vurderingskø og en
vedvarende påminnelsesarbeider. Se [oppsett og kontrakter](interactive-flow.md).
KS-søknader registrerer metadata via `/api/soknader`; skjemafeltene og vedlegg
lagres lokalt og sendes ikke av denne API-kontrakten.

## Tilgjengelig i hackathon-repoet

| Tjeneste | Port | Relevans |
|---|---:|---|
| Prosessbygger | 3000 | Redigerer sandkassens prosessdefinisjoner |
| Demo/oversikt/utforsker | 3001 | Viser tjenester, testpersoner og faktiske API-kall |
| sandbox-backend | 8080 | Person, husholdning, SFO, inntekt, prosess og revisjon |
| fiks-simulator | 8081 | Registerliknende tjenester og skatteberegning |
| ai-gateway | 8082 | Forklaringer med/uten lokal modell |
| digdir-mock | 8086 | Simulert ID-porten og Maskinporten |

Kilde: [API-oversikten](https://github.com/ks-no/workshop-ai/blob/main/docs/api-oversikt.md).
API-spesifikasjonene under `openapi/` er wire-kontraktene. Våre TypeScript-grensesnitt
er lokale domenekontrakter og skal ikke presenteres som offisielle Fiks-grensesnitt.

## Verifiserte ruter og viktige begrensninger

| Rute i sandbox-backend | Krav / betydning |
|---|---|
| GET `/helse` | Åpen helserute. Ikke `/health` |
| GET `/api/katalog/ressurser` | Åpen katalog over ressurser og tilgangskrav |
| GET `/api/regler/satser` | Åpne demoregler og satser |
| GET `/api/personer/{personId}/husstand` | Token for riktig person/hjemmel |
| GET `/api/personer/{personId}/sfo` | SFO-plassene for barna i husholdningen |
| GET `/api/personer/{personId}/inntekt` | Token og registrert inntektssamtykke i sandkassens modell |
| POST `/api/prosessoekter` | Oppretter prosessøkt med `personId` og `prosessId` |

Bruk **`person-022` Fatima Ali** og prosess **`sfo-moderasjon`** for arrangørens SFO-case.
`person-001` Maja Solberg er egnet for barnehage, men har ikke SFO-plass.
Kilde: [Deltakerstart](https://github.com/ks-no/workshop-ai/blob/main/docs/deltakerstart.md).

Sandkassen håndhever samtykke for inntekt som en demonstrasjon. Det kan ikke ukritisk
overføres som juridisk behandlingsgrunnlag for en produksjonstjeneste.

## Hvorfor vi ikke bare koblet SFO-data rett inn

`Sfoplass` i `openapi/sandbox-backend.yaml` har `personId`, `sfoId`, `sfonavn`,
`kommune`, `trinn`, `manedspris` og `syntetisk`. Den beskriver ikke uketimer,
betalingsmåneder, matpris eller tydelig om månedsprisen allerede inkluderer gratisandel.
Disse feltene kan ikke fylles med antakelser og samtidig kalles registeropplysninger.

Husholdningen returnerer medlems-ID-er, ikke ferdige navn. Inntekt returneres som
beregningsgrunnlag med `inntektsaar`, `stadie`, `beregningsbeloep`, personposter,
visningsposter og eventuelle `feilmeldinger`. Feil eller manglende oppgjør må ikke bli
til nullinntekt.

Dette er grunnen til at lokal demo har et eget, eksplisitt prisgrunnlag.

## Praktisk bruk av sandkassen

1. Start arrangørens repo med `./start.sh --mock`, og kjør `npm run sandbox:inspect`
   i denne appen. Dette leser bare åpne, ikke-personlige ruter.
2. Bruk `person-022` i SFO-flyten. Serveradapteren henter et avgrenset
   innbyggertoken fra `digdir-mock`; en synlig testbrukerinnlogging er neste UI-steg.
3. La innbyggeren svare i samtykkesteget før inntektsoppslag. Ikke omgå 401/403.
4. Behold norske wire-felt og normaliser bare på serveren. Inntektsgrunnlaget
   fylles inn med KS som kilde, men innbyggeren kan lagre en korrigert verdi separat.
5. Avklar uketimer og tariffdata med arrangør/fagperson. Opplysninger som tilføres
   lokalt, må ha egen kilde og merkes syntetisk. Ved uklar pris: manuell vurdering.
6. Kjør kontraktstester for token, samtykke, skjerming, ufullstendig inntekt og timeout.
7. Koble **etter** innbyggerbekreftelse til en konkret prosessdefinisjon med entydig
   mapping. Ikke spill automatisk gjennom en SUBMIT-flyt på grunnlag av et lokalt prisanslag.

Prosessmotoren er lineær. Kokeboken viser `handling`, `neste`, samtykkesvar, regelsjekk,
oppsummering og SUBMIT. Den lokale `application.confirmed`-hendelsen kan bli et
integrasjonspunkt, men er **ikke et oppdiktet Prosessbygger-API**.
Kilde: [Curl-kokeboken](https://github.com/ks-no/workshop-ai/blob/main/examples/curl/README.md).

## Reelle Fiks-tjenester

**Folkeregister:** Oppslag, uttrekk og hendelser er dokumentert. Bruksavtaler,
virksomhetssertifikat, Maskinporten, scope og kommunal konfigurasjon må på plass.
Kilde: [Fiks Folkeregister](https://developers.fiks.ks.no/tjenester/register/folkeregister/).

**Skatt og inntekt:** Tjenesten dokumenterer beregningstype `BARNEHAGE_SFO` og riktig
tjenesteområde/rolle. Den dokumenterte POST-ruten for overbygget er
`/register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`.
Selve payloaden skal tas fra gjeldende Swagger, ikke konstrueres fra dette notatet.
Kilde: [Fiks skatt og inntekt](https://developers.fiks.ks.no/tjenester/register/skatteoginntektsopplysninger/index.html).

**Prosessbygger:** Verifisert som del av hackathonets repo. Det er ikke grunnlag for
å påstå at en tilsvarende produksjonstjeneste har samme kontrakt. Repoet omtaler også
Altinn Studio som alternativ prosessplattform.

**Digital lommebok:** Digdir tilbyr en separat nasjonal sandkasse med utstedelse,
lommebøker og brukersted/verifisering. Ingen lommebok simuleres av KS-repoet. Avklar
bevistype, selektiv deling, gyldighet og tilbakekalling med Digdir før implementasjon.
Kilde: [Digdir, teknisk dokumentasjon](https://docs.digdir.no/docs/lommebok/lommebok_om.html).

## Forbedringer når ekte testtilgang finnes

- Erstatt én dataleverandør om gangen; behold tydelig kilde, periode og hentetid.
- Etabler husholdningsgrunnlag, korrekt inntektsstadium og behandling av manglende data.
- Konfigurer kommunale tariffer, gratisordninger og skoleår med faglig godkjente tester.
- Koble godkjent autentisering og autorisering før noen persondata hentes.
- La hendelsen gå til faktisk saksprosess, journalføring, kvittering og klageinformasjon.
- Flytt økter og historikk til egnet lagring med fastsatt sletting og tilgangsstyring.
- Test språk og tilgjengelighet med innbyggere. Legg til barnehage som egen regelmodell.
- Utforsk lovlig revurdering innenfor søknadsperioden og eventuelt et lommebokbevis.
