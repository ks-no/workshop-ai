# Hva sandkassen logger

Sandkassen fører to logger med vilje, og skriver dessuten kjøretilstanden sin til
disk.

## Kort svar

**Loggene sier hva sandkassen gjorde, ikke hvem som kjørte den.** Det finnes ingen
brukerkonto, ingen tilgangslogg, ingen IP-registrering, ingen bruksmålinger og ingen
feilrapportering ut av maskinen. Ingen tjeneste logger et eneste kall den tar imot.

Det som lagres, er hva flyten gjorde med de syntetiske testpersonene. Alt ligger i
`state/` på din egen maskin, og den eneste som ser det er den som sitter ved
maskinen.

Ett forbehold: velger du en KI-provider som ikke kjører lokalt, forlater prompten
maskinen. Se [Hva som forlater maskinen](#hva-som-forlater-maskinen) under.

## Hva som skrives, og hvor

| Fil i `state/` | Hva den inneholder | Hvem skriver den |
|---|---|---|
| `revisjonslogg.json` | Én hendelse per datatilgang, avvist tilgang, samtykkeendring, prosessteg, KI-kall, søknad, forsendelse og oppgave | `sandbox-backend`, i `revisjon.ts` |
| `ai-trace.jsonl` | Full prompt og fullt svar per modellkall, med modell, varighet og om kallet feilet | `ai-gateway`, i `writeTrace` |
| `prosessoekter.json` | Alt innbyggeren svarte underveis, og alt stegene hentet inn | `sandbox-backend`, i `lagreProsessoekt` |
| `soknader.json` | Søknadsdokumentet: navn, personId, adresse, inntektsposter, vedtaket og KI-oppsummeringen | `sandbox-backend`, når et `SUBMIT`-steg kjører |
| `samtykker.json` | Formålet innbyggeren sa ja til, hvilke datakilder det gjaldt, status, utløpsdato og hele historikken | `fiks-simulator` |
| `oppgaver.json` | Saksbehandleroppgaven. Tittelen røper hvilken tjeneste personen søkte på | `fiks-simulator` |
| `forsendelser.json` | Mottakerens navn, fødselsnummer og postadresse, pluss kanalvalget. Den mest identifiserende raden i hele `state/` | `fiks-simulator` |
| `meldinger.json` | Fritekstmelding. Ingen av casene skriver den i dag | `fiks-simulator` |
| `prosessdefinisjoner.json` | Prosesskatalogen, men bare når prosessbyggeren har lagret. Da skygger den seeden i `data/` | `sandbox-backend` |
| `ai-provider-override.json` | Hvilken KI-provider som er valgt. To strenger, ingen persondata | `ai-gateway` |
| `digdir-nokkel.json` | Signeringsnøkkelen tokenene hviler på. Ingen persondata, men roten til all tillit i sandkassen | `digdir-mock`, ved første oppstart |
| `kontrakt-dump.json` | Resultatet av `pnpm test:kontrakt`. Et testartefakt, ikke kjøretilstand, men det er stort og inneholder hele svar fra rutene testen går gjennom | `scripts/kontrakt-smoke.ts` |

De to øverste er logger i egentlig forstand. Resten er tilstand som blir liggende, og
som derfor svarer på det samme spørsmålet. Tabellen dekker en vanlig kjøring: kjører du
testskriptene, slipper de egne filer i `state/` i tillegg.

`sandbox-backend` eier revisjonsloggen alene. `ai-gateway` og `fiks-simulator` sender
hendelsene sine dit over `POST /api/revisjonslogg` framfor å skrive filen selv.

## Hvordan det lagres

- **Alt er JSON på disk, i klartekst.** Ingenting krypteres.
- `state/` står i `.gitignore`, så ingenting av dette havner i git.
- `ai-trace.jsonl` er den eneste som legges til linje for linje. De andre leses og
  skrives i sin helhet gjennom `updateJson` i `apps/shared/jsonstore.ts`, som kjører
  hele les-endre-skriv i én kø.
- **Ingenting maskeres på skrivetidspunktet.** Adressebeskyttelsen i
  `apps/shared/skjerming.ts` gjelder når befolkningen leses, ikke radene som alt står
  i `soknader.json` og `forsendelser.json`.
- `syntetisk: true` står på praktisk talt hver rad, som stående påminnelse om at
  ingenting her er ekte.
- `sporingsId` binder radene sammen på tvers av filene. Har du én, har du hele flyten:
  hvilke data som ble lest, hvilket samtykke som lå bak, og hva modellen fikk se.
  `forsendelser.json` er unntaket, og kobles via `eksternReferanse`.

Feltnavnene står i `openapi/sandbox-backend.yaml` og `openapi/ai-gateway.yaml`, og
det er listen å stole på. Revisjonshendelsen har uvanlig fyldig prosa per felt
der, blant annet om hvorfor `DATA_NEKTET` og `TILGANG_NEKTET` aldri skal slås sammen.

Hendelsestypene i `handling` bor som strengliteraler ute i tjenestene og ikke i noe
kodeverk, så en avskrift her ville drevet fra hverandre. Slik ser du hvilke din egen
kjøring har brukt:

```bash
jq -r '.[].handling' state/revisjonslogg.json | sort -u
```

## Hvor du leser det

| Logg | Endepunkt | Hvem kommer inn |
|---|---|---|
| Hele revisjonsloggen | `GET /api/revisjonslogg` | Maskinklient med `ks:innbyggerdialog:les` |
| Én flyt | `GET /api/revisjonslogg/{sporingsId}` | Innbyggeren selv med ID-porten, eller en maskinklient |
| KI-sporet som side | `GET /trace` | Kall fra tjenestens egen side, eller fra en klient uten `Origin`-header, som `curl` |
| KI-sporet som JSON | `GET /trace.json` | Samme vakt, med `?limit=`, `?sporingsId=` og `?task=` |

Hvem som slipper inn står i `openapi/*.yaml`, og `pnpm test:openapi` måler det mot
koden. Kolonnen over er en lesehjelp, ikke fasit.

Innsyn i én flyt er også det innbyggersidene viser: både `/chat` og `/stegvis` henter
`GET /api/revisjonslogg/{sporingsId}` og legger den frem underveis.

Vakten foran KI-sporet er der fordi CORS er `*` og sporet bærer hele prompten. Uten
den kunne hvilken som helst nettside i nettleseren din lese den.

## Hva som forlater maskinen

- **KI-provideren avgjør.** Kjører modellen lokalt, går ingenting ut. Gjør den ikke
  det, går hele prompten til en tredjepart, med konteksten som rå JSON.
  [`docs/sikkerhet-og-personvern.md`](sikkerhet-og-personvern.md) har listen.
- **Geonorge** får et adressesøk når et gateoppslag bommer på seeden. Gatenavnet går
  ut, ikke fødselsnummeret.
- Ingenting annet. Ingen analyse, ingen sporing, ingen feilrapportering.

## Hvordan du sletter det

- **Det finnes ingen sletteflate.** Ingen tjeneste har en `DELETE`-rute. Du kan ikke
  fjerne en enkelt hendelse eller en enkelt søknad gjennom API-et.
- **Å trekke et samtykke fjerner ingen rader,** men porten sitter på lesetidspunktet
  og ikke på hentetidspunktet, så dataene slutter å bli servert. Selve hendelsen om at
  samtykket ble trukket blir stående, og det er meningen.
- **Den eneste slettingen er `./start.sh --reset`.** Den fjerner hele `state/`, og
  tjenestene seeder seg selv fra `data/` neste gang de starter. Den rullerer også
  signeringsnøkkelen, så tokener noen har limt inn et sted slutter å virke.
- **`./start.sh --reload` og `docker compose down` sletter ingenting.** `state/` ligger
  på din egen maskin gjennom bind-mounten, ikke inne i containerne.
- Vil du bare bli kvitt én fil, kan du slette den for hånd. Leserne faller tilbake til
  `data/` når filen mangler - se
  [`docs/syntetiske-data.md`](syntetiske-data.md) om hvordan `state/` skygger for
  `data/`, og [`docs/feilsoking.md`](feilsoking.md) om tokenene som slutter å virke.
- **Ingen rotasjon, ingen oppbevaringsgrense, ingen størrelsesgrense.** Begge loggene
  vokser til du tømmer dem selv.

## Containerloggene

`docker compose logs` gir én oppstartslinje per tjeneste og ellers stillhet. Det er
ingen request-logging noe sted, og ingen tjeneste skriver fødselsnummer, navn eller
adresser dit med vilje.

Det som kan dukke opp, er en håndfull feilmeldinger: at revisjonsloggen eller
KI-sporet ikke lot seg skrive, at et Geonorge-oppslag feilet, eller at et token ikke
kunne hentes. Den første er verdt å merke seg. En mislykket skriving til loggen
svelges med vilje, slik at loggingen aldri velter operasjonen den logger, og da er
linjen i containerloggen det eneste sporet som er igjen.

Heller ikke disse roteres: `docker-compose.yml` setter ingen `logging`-blokk, så de
følger Docker-standarden.

---

## Neste steg

**Skal du demonstrere for andre?** Les
[`docs/sikkerhet-og-personvern.md`](sikkerhet-og-personvern.md) først, og sjekk hvilken
KI-provider som er aktiv på <http://localhost:8082/admin>.

**Vil du se hva modellen faktisk fikk?** <http://localhost:8082/trace> viser det, ett
kall per linje.

**Tilbake til kartet:** [`docs/README.md`](README.md).
