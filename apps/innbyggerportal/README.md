# Innbyggerportal

**For deg som vil se hvordan en kommunal «Min side» kan se ut når den bare får lov til
å vise det sandkassen faktisk har.** Én side på `:3002`, bygget på KS Digital sitt
designsystem, med profil, saksstatus, tjenester og kalender for den innbyggeren som er
logget inn.

Siden er en **demo av en flate**, ikke en tvungen klient. Skal du bygge din egen
frontend, hører den hjemme i ditt eget prosjekt mot de dokumenterte API-ene -
oppskriften står i [`docs/bygg-selv.md`](../../docs/bygg-selv.md).

## Hva den viser

| Kort | Hva som står der | Hvor tallene kommer fra |
| --- | --- | --- |
| Min profil | Navn, adresse, kommune, maskert fødselsnummer, husstand og fast eiendom | `data/personer.json`, `data/husstander.json`, `data/matrikkel.json`, `data/eierforhold.json` |
| Hva du kan søke på | Hver publiserte prosess med status: innvilget, avslått, til behandling, krever samtykke, ikke aktuell eller kan søkes nå | `GET /api/personer/{personId}/tilganger` i sandbox-backend |
| Pågående sak | Søknaden eller den påbegynte prosessen, med stegene fra prosessdefinisjonen | `state/soknader.json`, `state/oppgaver.json`, `state/prosessoekter.json`, `data/prosessdefinisjoner.json` |
| Tjenester | Fem snarveier som folder seg ut med det innbyggeren faktisk har | `state/forsendelser.json`, `data/eierforhold.json`, `data/barnehageplasser.json`, `data/sfoplasser.json`, `data/fritidsdeltakelse.json`, `data/tjenestetilbud.json` |
| Kalender | Frister og datoer som allerede står i dataene | `data/satser.json`, `state/samtykker.json`, `data/inntekter.json`, `data/legeerklaeringer.json`, `data/politiattester.json`, `data/krr.json` |

Hvert kort skriver kilden sin nederst, så et tall på skjermen kan følges tilbake til
raden det står i.

## Kommunen følger innbyggeren

Det er ingen kommune innstilt noe sted. `kommuneFor()` i `src/minside.ts` leser
`bostedsadresse.kommunenummer` og `.kommune` fra den som er logget inn, og det avgjør
resten: hvilke tilbud som telles, hva toppfeltet sier og hvilket kommunevåpen som
hentes. Filnavnet på våpenet er kommunenummeret, så en ny kommune trenger ingen
konfigurasjon.

Det satt som to konstanter før, og da måtte siden avvise alle som ikke bodde i den ene
kommunen. Det gikk ikke sammen med ID-porten, som lar deg logge inn som hvem som helst
av testbrukerne: 299 av 304 innlogginger endte i en 404. Nå svarer siden for alle.

Toppfeltet i `minside.html` står tomt til klienten vet hvem som er logget inn. Det er
med vilje - det finnes ingen riktig kommune å fylle inn på forhånd, og et Stavanger-våpen
over en innbygger fra Bergen er verre enn et tomt felt.

To kanttilfeller er håndtert, og begge finnes i seeden:

- **Adressebeskyttelse.** `apps/shared/skjerming.ts` beholder `kommunenummer` og
  `kommune` også for kode 6 og 7 - se listen i filhodet der - så en skjermet innbygger
  får sin egen kommune i toppfeltet, ikke en standardverdi. Navn og adresse er maskert
  som ellers.
- **Ingen registrert bostedsadresse.** 18 personer i seeden mangler den. Da står det
  «Kommunen» uten våpen, og tjenestelisten er tom, i stedet for at siden feiler.

**Datagrunnlaget er ujevnt mellom kommuner, og det er seeddata.**
`data/tjenestetilbud.json` dekker 82 av de 105 kommunene befolkningen bor i, så en
innbygger utenfor de 82 får et tomt tjenestekort. Satsene i `data/satser.json` er
framstilt for Bergen: maksgrensen på 6 % og de elleve betalingsmånedene er nasjonale og
gjelder uansett kommune, men SFO-inntektsgrensene ved siden av er kommunale og hentet
fra Bergen sine vedtekter.

**Ingen av de pinnede demo-casene i `data/deltakercaser.json` er knyttet til en bestemt
kommune her.** Sakskortet står tomt til noen kjører en flyt for innbyggeren i demo-GUI-et
på `:3001`. Da skrives `state/`, og saken dukker opp ved neste sidelasting. Kortet «Hva du
kan søke på» er ikke avhengig av det: det kjører reglene på forhånd og svarer for alle sju
prosessene fra første sidelasting.

**Ingenting er funnet på.** En kommunal Min side ville også vist tømmedager,
feiing og eiendomsskatt. Sandkassen har ingen datoer for noe av det, så de står ikke
her. Kalenderen er kortere enn en ekte, og det er hele poenget: den viser hva
datagrunnlaget rekker til.

## Ruter

| Rute | Hva den gjør |
| --- | --- |
| `GET /` | Siden. Krever innlogging |
| `GET /callback` | Der ID-porten sender nettleseren tilbake |
| `GET /api/minside/{personId}` | Datagrunnlaget siden tegnes fra |
| `GET /helse` | `{ "status": "ok", "tjeneste": "innbyggerportal" }` |

Datagrunnlaget leser portalen fra `data/` og `state/` rett fra disken gjennom `readJson`
i `apps/shared/jsonstore.ts`, som ser i `state/` først. Kjører du en flyt i demo-GUI-et
på `:3001`, dukker søknaden opp her ved neste sidelasting.

## Innlogging

Siden krever et ID-porten-token, og velgeren er ID-porten sin egen. `requireLogin()` i
`apps/shared/client/felles.ts` sender nettleseren til
<http://localhost:8086/idporten/authorize>, der du søker opp en testbruker blant de 304
som kan ha en elektronisk ID. Runden er en ekte authorization_code-flyt med PKCE, og
tokenet er signert - `sandbox-backend` verifiserer det mot `/jwks` som ellers.

Tokenet ligger i `sessionStorage` og overlever ikke fanen. «Logg ut» og «bytt bruker» er
samme handling: utstederen har ingen sesjon å avslutte, så veien tilbake er en ny runde
gjennom velgeren.

Hvem du er logget inn som avgjør hvem siden viser. Klienten slår `pid` fra tokenet opp
mot `GET :8080/api/personer`, som svarer med nøyaktig én rad for et innbyggertoken -
derfor er det ingen personvelger her, og derfor kan ruten være åpen for innbyggere uten
å bli en befolkningsliste.

Alle de 304 som kan logge inn får sin egen side. `/api/minside` svarer `404` bare på en
personId som ikke finnes i det hele tatt.

Portalen snakker ellers bare med `sandbox-backend`. Den er ikke avhengig av at demo-GUI-et
kjører: `felles.ts` serveres av portalen selv på `/delt/felles.ts`.

## Kjøring

```bash
pnpm start:innbyggerportal      # eller: docker compose up -d innbyggerportal
```

Så <http://localhost:3002>.

## Teknisk

- Statisk HTML og to sidescript, null avhengigheter og ingen byggesteg.
  `apps/innbyggerportal/src/client/minside.ts` og `client/callback.ts` serveres som
  `.ts` og type-strippes ved servering, slik demo-gui gjør det. Det samme gjelder den
  delte `felles.ts` på `/delt/felles.ts`.
- Sidescriptene har `export {}` øverst. De lastes allerede som `<script type="module">`,
  så det gjør bare typebildet likt kjøringen - og det er det som lar `felles.ts` ligge i
  samme TypeScript-program uten at `krevEl` og `Tjeneste` kolliderer med de globale.
- Designsystemet lastes fra `/assets/ds-base.css` og `/assets/ds-ksdigital.css`.
  Siden laster med vilje **ikke** `felles.css`: den har ingen `@layer` og ville
  overstyrt hele designsystemet. Se [`docs/designsystem.md`](../../docs/designsystem.md).
- Sidens eget oppsett ligger i laget `side`, som er deklarert etter `ksd`. Derfor
  trengs verken `!important` eller spesifisitetstriks, og hver verdi er et `--ds-*`-token
  slik at mørk modus fortsatt virker.
- DOM bygges med `createElement` og `textContent`, aldri `innerHTML`.
- Maskeringen av adressebeskyttede personer gjøres av `apps/shared/skjerming.ts`, ikke
  av denne appen. Fødselsnummeret vises alltid med de fem siste sifrene skjult.
- Den eneste tunge filen er `data/matrikkel.json` på 13 MB. Oppslagstabellen bygges
  én gang per prosess; alt annet leses per forespørsel, slik at `state/` er ferskt.

## Videre

Vil du bygge videre: legg til et kort, ikke en side. Datagrunnlaget samles ett sted, i
`src/minside.ts`, og klienten tegner det den får. Et nytt kort er en ny nøkkel i
`Minside` og en ny `tegn`-funksjon.
