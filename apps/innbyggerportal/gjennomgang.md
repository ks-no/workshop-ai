# Gjennomgang av innbyggerportalen

Sikkerhetstest, kvalitetsvurdering og anbefalinger for veien videre. Utført
10. september 2026 mot stakken som kjørte i Docker Compose, med syntetiske data.

- [Sikkerhetstest](#sikkerhetstest)
- [Kvalitet](#kvalitet)
- [Videre arbeid](#videre-arbeid)

---

## Sikkerhetstest

### Omfang og metode

Svartboks- og gråbokstesting mot `innbyggerportal` på `:3002` og `sandbox-backend` på
`:8080`, med kildekoden tilgjengelig. Testet med `curl` og i nettleseren, mot en
kjørende stakk. Ingen automatiske skannere.

Dette er ikke en penetrasjonstest. Det er en gjennomgang av de kontrollene sandkassen
selv sier den har: autentisering, tilgang til andres data, samtykkeporten,
tokenintegritet og revisjonssporet. Testene og svarene er gjengitt så de kan kjøres
om igjen.

### Funn

| # | Alvorlighet | Funn |
| --- | --- | --- |
| 1 | **Høy** | `/api/minside/{personId}` er uautentisert og utleverer samtykkegatede opplysninger om hvem som helst, uten spor |
| 2 | Middels | Åpen videresending etter innlogging, via `state` |
| 3 | Lav | `/api/testbrukere` lister syntetiske fødselsnummer uautentisert |

---

#### 1. Portalens egen API krever ikke innlogging (høy)

`GET /api/minside/{personId}` tar en personId i stien, krever ingen `Authorization`,
og svarer for hvilken som helst innbygger i kommunen:

```
GET :3002/api/minside/person-008  -> 200
GET :3002/api/minside/person-036  -> 200
```

Svaret inneholder opplysninger `sandbox-backend` nekter å utlevere uten samtykke.
Samme opplysning, to dører:

```
GET :3002/api/minside/person-008              -> 200, med e-post og telefon i svaret
GET :8080/api/personer/person-008/kontaktinfo -> 401
```

Ruten leser fire filer som backend gater:

| Filen portalen leser | Datakilden backend gater den som |
| --- | --- |
| `data/inntekter.json` | `inntekt` |
| `data/krr.json` | `kontaktinfo` |
| `data/legeerklaeringer.json` | `helseopplysninger` |
| `data/politiattester.json` | `politiattest` |

**Lesingen etterlater heller ingen spor.** Revisjonsloggen sto på 1156 rader før og
etter et kall til `/api/minside`. Det samme oppslaget gjennom backend ga fire nye
rader, deriblant `DATA_LES inntekt` med innbyggeren som aktør.
[`docs/sikkerhet-og-personvern.md`](../../docs/sikkerhet-og-personvern.md) sier at
«all datatilgang skrives til `state/revisjonslogg.json`». Det stemmer for backend, og
ikke for denne ruten.

Ruten svarer `Access-Control-Allow-Origin: *`. En hvilken som helst nettside kan
dermed lese svaret fra nettleseren til en som har sandkassen kjørende:

```
< HTTP/1.1 200 OK
< Access-Control-Allow-Origin: *
```

**Reell risiko her:** lav. Dataene er syntetiske, og portene er bundet til
`127.0.0.1`. **Risiko ved å kopiere mønsteret:** høy, og det er poenget - portalen er
det deltakerne leser for å se hvordan en frontend skal settes opp.

**Anbefalt retting:** flytt de gatede kortene over på backend, slik tilgangskortet og
søknadsskjemaet alt gjør. Alternativet, å legge tokensjekk og samtykkesjekk inn i
portalen, gir sandkassen to implementasjoner av den samme porten.

#### 2. Åpen videresending etter innlogging (middels)

Returstien reiser i `state` gjennom ID-porten, og brukes uten validering:

```
Location: http://localhost:3002/callback?code=...&state=https%3A%2F%2Fangriper.example%2Fhent
```

`completeLogin` returnerer `parametere.get("state") || "/"`
(`apps/shared/client/felles.ts:491`), og `callback.ts:15` gjør `location.replace` på
den. En lenke med `state` satt til en absolutt URL sender innbyggeren videre til
angriperens side rett etter en vellykket innlogging - en troverdig ramme for phishing,
siden brukeren nettopp har logget inn.

Tokenet lekker ikke: koden veksles i offerets egen fane, og PKCE-verifieren ligger i
`sessionStorage` på riktig opphav.

Funnet ligger i delt kode og gjelder **også demo-gui**.

**Anbefalt retting:** avvis en `state` som ikke er en relativ sti på eget opphav. Én
linje i `completeLogin`: godta bare verdier som begynner med `/` og ikke med `//`.

#### 3. Testbrukerlisten er åpen (lav)

`GET :3002/api/testbrukere` svarer uten innlogging med navn, personId og syntetisk
fødselsnummer for alle 304 som kan logge inn. Det er med vilje - ID-porten-mocken
publiserer den samme listen på `:8086/idporten/testbrukere`, og forsiden trenger den
for å vise hvem man kan logge inn som. Verdt å vite om, ikke å rette.

### Det som holdt

Kontroller som ble testet og som virket:

| Kontroll | Resultat |
| --- | --- |
| Andres data gjennom backend | `403` for hver eneste annen person, også en i samme husstand |
| Samtykke på andres vegne | `403` både ved oppretting og tilbaketrekk |
| Manglende token | `401` |
| Tullestreng som token | `401` |
| Endret payload med gammel signatur | `401` |
| `alg=none` med tom signatur | `401` |
| Utløpt `exp` | `401` |
| Samtykkeporten, fire ulike veier til inntekt | `403` på alle fire |
| Stigjennomgang i filserveringen, fire varianter | `404` på alle fire |
| XSS | Ingen `innerHTML`, `document.write` eller `insertAdjacentHTML` i appkoden |
| Token i lagring | `sessionStorage`, ikke `localStorage`, og ikke i noen logg |
| Hemmeligheter | `.env` er gitignorert og usporet |

Særlig verdt å merke seg: tokenvalideringen avviste alle fem manipulasjonene, og
samtykkeporten holdt på alle fire veiene til inntektsopplysninger - også de indirekte
gjennom `/api/husstander/{id}/inntektsgrunnlag` og de to regelrutene.

### Det som ikke ble testet

Lastforhold og tjenestenekt, avhengighetssårbarheter, containeroppsett, og
`ai-gateway` mot en ekstern modellprovider. Sistnevnte er den største reelle
personvernflaten i sandkassen, og
[`docs/sikkerhet-og-personvern.md`](../../docs/sikkerhet-og-personvern.md) dekker
den.

---

## Kvalitet

Gjennomgangen er gjort av en egen kodegjennomgangsagent med kildekoden og repoets
konvensjoner tilgjengelig. De seks funnene under «Bør rettes» er etterprøvd mot koden
og bekreftet.

### Bør rettes

**Ukjent status kan stoppe tilgangskortet uten en feilmelding.**
`TILGANGSVISNING[post.status]` (`src/client/minside.ts:945`) har ingen reserveverdi,
og løkken som kaller `tegnTilgang` ligger etter `catch`-blokken i `tegnTilganger`. En
statusverdi backend legger til, men klienten ikke kjenner, gir en ufanget feil midt i
tegningen: kortet blir stående halvferdig, og ingenting sier hvorfor. Dette er nettopp
det AGENTS.md advarer mot - en unionstype over data fra en fil er dokumentasjon, ikke
en sjekk.

**Min side har ingen `h1`.** `overskrift()` (`src/client/minside.ts:165`) tillater
bare `h2`, `h3` og `h4`, og `minside.html` har ingen statisk overskrift. Hele siden
starter på nivå to, mens søknadsskjemaet gjør det riktig. En skjermleserbruker har
ingen sidenivåoverskrift å navigere fra.

**Kappløp mellom to brytere.** Samtykkebryterne (`src/client/minside.ts:835`,
`src/client/soknad.ts:421`) gjør et kall, henter friskt, og tegner så hele kortet om.
Ingen av kjedene har en sekvensteller. To brytere trykket rett etter hverandre kan la
det tidligste svaret komme sist og male over en nyere, riktig tilstand. Lite
sannsynlig med musepeker, fullt mulig med tastatur.

**`lesSamtykker()` svelger alle feil likt.** `src/client/soknad.ts:356` fanger
nettverksfeil, 401 og 500 og setter den samme tomme tilstanden som «ingen samtykke».
Innbyggeren kan ikke skille «du mangler samtykke» fra «vi klarte ikke å sjekke», og
forhåndsvarselet om avslag uteblir stille.

**Hardkodede prosess-id-er som svikter stille.** `PROSESS_PER_PLASS`
(`src/client/minside.ts:470`) binder tre plasstyper til faste id-er. Endres en id i
`data/prosessdefinisjoner.json`, faller oppslaget tilbake til å vise selve
id-strengen til innbyggeren. Ingen feil, ingen varsel, bare feil tekst.

**Duplisering, inkludert av kode som alt finnes delt.** `krevEl`, `lag`,
`attributter`, `avsnitt`, `overskrift`, `merkelapp`, `kortblokk` og `hentJson` er
kopiert i to eller tre av de tre sidescriptene. Verst: `alternativVerdi` og
`alternativLabel` i `src/client/soknad.ts:140` skygger for nesten identiske globale
funksjoner som alt står i `apps/shared/client/felles.ts:157`. Delt kode finnes, men
brukes ikke.

### Verdt å vurdere

- `oekt.resultaterRaa?.[...]` i `src/client/soknad.ts:799` er død kode. Backend
  destrukturerer `resultaterRaa` bort før svaret sendes
  (`apps/sandbox-backend/src/prosess.ts:446`), og et svar fra ruten bekrefter at
  nøkkelen ikke finnes. Ikke skadelig, men misvisende å lese.
- Portalen har ingen tester. Se [Videre arbeid](#videre-arbeid).

### Godt løst

- «Aktuelt for deg» holder bare ett element i DOM-en om gangen, med `aria-live`
  og riktig `aria-expanded`/`aria-controls`.
- `aria-describedby` binder samtykkebryteren til kildelisten framfor å gjenta navnene
  i etiketten.
- Avslag håndteres som et utfall og ikke som en feil i innsendingsløkken.
- Ingen `innerHTML` noe sted; DOM bygges med `createElement` og `textContent`.

---

## Videre arbeid

Portalen er bygget på et hackathon, og det synes på riktig måte: flatene er komplette,
og fundamentet under dem er ujevnt. Rekkefølgen under er etter hva som koster mest å
la ligge, ikke etter hva som er morsomst.

### Først: lukk de to hullene

**Flytt de samtykkegatede kortene over på backend.** Funn 1 er ikke farlig i
sandkassen, men portalen er referansen deltakerne kopierer, og den lærer bort det
motsatte av det resten av repoet håndhever. Kalenderen og kontaktblokken bør hentes
med token slik tilgangskortet gjør, og forsvinne når samtykket mangler. Da får de også
en rad i revisjonsloggen, som er halve poenget med porten.

**Valider `state` i `completeLogin`.** Én linje, i delt kode, som fjerner funn 2 for
både portalen og demo-gui.

### Deretter: gjør den til noe som tåler endring

**Portalen har ingen tester.** Repoet har rundt 25 `scripts/test-*.ts`, og
innbyggerportalen er ikke i noen av dem. En `scripts/test-innbyggerportal.ts` i samme
stil, som starter tjenesten og går gjennom rutene, ville fanget de tingene som brekker
stille: en `DATA_FETCH`-URL som ikke lar seg fylle ut, en prosess uten `INFO`-steg, en
person uten husstand.

**Klientkoden er kopiert tre ganger.** `forside.ts`, `minside.ts` og `soknad.ts` har
hver sin utgave av de samme byggeklossene. Det er billig å leve med i to uker og dyrt
i to måneder. Se kvalitetsdelen over for detaljene.

**Skjemaet dekker bare det prosessdefinisjonen kan uttrykke.** Tre felttyper, ingen
vedlegg, ingen «lagre og fortsett senere». Det siste er det mest savnede i et ekte
kommunalt skjema, og motoren har alt en prosessøkt å henge det på - skjemaet oppretter
bare økten i det man trykker send.

### Spørsmål prosjektet bør ta stilling til

**Skal en innbygger kunne sende inn en søknad som får avslag?** I dag avgjør
`SJEKK`-steget før `SUBMIT`, og en avvist økt blir aldri en søknad. Innbyggeren får
begrunnelsen, men det finnes ingen sak, ingen saksnummer og ingenting å klage på.
Forvaltningsretten peker den andre veien: et avslag er et enkeltvedtak. Dette er en
beslutning om prosessmotoren, ikke om frontenden, men det er skjemaet som gjør den
synlig.

**Hvor mange kommuner skal portalen kunne være?** Kommunen er to konstanter i
`src/minside.ts` i dag, og forsiden har Stavanger sin palett hardkodet i `--sk-*`.
Skal den kunne kjøre for flere samtidig, må kommunen bli en parameter i ruten framfor
en konstant, og profilen må hentes framfor å ligge i stilarket.

**Hvor mye skal portalen lese fra disk?** Snarveien i funn 1 er også grunnen til at
Min side virker uten at hele stakken kjører, som er en ekte fordel når tjue deltakere
skal opp å gå på en morgen. Retter man den fullt ut, mister man det. Et mellomstandpunkt
er å la de ugatede kortene bli liggende på disk og bare flytte de fire gatede - det er
det anbefalingen over legger opp til.
