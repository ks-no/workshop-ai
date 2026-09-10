# Innbyggerportal

**For deg som vil se hvordan en «Min side» for Stavanger kommune kan se ut når den
bare får lov til å vise det sandkassen faktisk har.** To sider på `:3002`: en forside
som hermer stavanger.kommune.no og har én knapp på seg, og Min side bak innlogging med
profil, saksstatus, tjenester og kalender for den som logget inn.

Siden er en **demo av en flate**, ikke en tvungen klient. Skal du bygge din egen
frontend, hører den hjemme i ditt eget prosjekt mot de dokumenterte API-ene -
oppskriften står i [`docs/bygg-selv.md`](../../docs/bygg-selv.md).

## Hva den viser

| Kort | Hva som står der | Hvor tallene kommer fra |
| --- | --- | --- |
| Aktuelt for deg | Karusell med det innbyggeren bør gjøre noe med nå | `state/samtykker.json`, `state/oppgaver.json`, `state/forsendelser.json`, `data/satser.json`, `data/prosessdefinisjoner.json` |
| Min profil | Navn, adresse, kommune, maskert fødselsnummer, husstand og fast eiendom | `data/personer.json`, `data/husstander.json`, `data/matrikkel.json`, `data/eierforhold.json` |
| Pågående sak | Søknaden eller den påbegynte prosessen, med stegene fra prosessdefinisjonen | `state/soknader.json`, `state/oppgaver.json`, `state/prosessoekter.json`, `data/prosessdefinisjoner.json` |
| Tjenester | Fem snarveier som folder seg ut med det innbyggeren faktisk har | `state/forsendelser.json`, `data/eierforhold.json`, `data/barnehageplasser.json`, `data/sfoplasser.json`, `data/fritidsdeltakelse.json`, `data/tjenestetilbud.json` |
| Kalender | Frister og datoer som allerede står i dataene | `data/satser.json`, `state/samtykker.json`, `data/inntekter.json`, `data/legeerklaeringer.json`, `data/politiattester.json`, `data/krr.json` |

Hvert kort skriver kilden sin nederst, så et tall på skjermen kan følges tilbake til
raden det står i.

## Aktuelt for deg

Karusellen øverst er de fem påminnelsestypene under, i denne rekkefølgen. Er ingen av
dem utløst, vises ikke kortet i det hele tatt.

| Utløser | Blir til |
| --- | --- |
| En frist i kalenderen som ikke har gått ut, og som er gul eller rød | «Samtykket ditt utløper 1. oktober 2026» |
| En oppgave i `state/oppgaver.json` | «1 søknad ligger hos saksbehandler» |
| En forsendelse til innbyggerens fødselsnummer | «Du har 1 ulest melding» |
| En plass husstanden betaler for, uten søknad om ordningen som hører til | «Har dere søkt om redusert foreldrebetaling i barnehagen?» |

**Utløseren er et faktum, ikke en vurdering.** At husstanden har en barnehageplass og
ingen søknad om redusert foreldrebetaling sier at søknaden ikke er sendt. Det sier
ingenting om at den ville blitt innvilget - den vurderingen gjør backend i `SJEKK`-steget,
og teksten i påminnelsen sier det rett ut. Siden regner ikke på inntekt, alder eller
trinn, og skal ikke gjøre det.

Knappen gjør én av to ting. «Start søknaden» går til flyten i demo-GUI-et, og «Les mer»
lister ordningene for tjenesten rett fra `data/satser.json`, med hvilken testbruker og
prosess du skal velge. De andre påminnelsene peker innover i siden i stedet: de åpner
samtykkepanelet eller postkassen lenger nede, framfor å sende deg et sted som ikke
finnes.

`DEMO_GUI_BASE_URL` overstyrer adressen til demo-GUI-et hvis det ikke står på `:3001`.

## Kommunen sitter ett sted

`KOMMUNENUMMER` og `KOMMUNENAVN` øverst i `src/minside.ts` avgjør hele siden: hvem som
står i velgeren, hvilke tilbud som telles, hva toppfeltet sier og hvilket kommunevåpen
som hentes. Skal siden vise en annen kommune, er det de to linjene. Toppfeltet i
`minside.html` har Stavanger ferdig utfylt bare for at det ikke skal stå tomt før
scriptet har kjørt; klienten skriver det om fra `/api/minside/{personId}`.

Hvem som bor i Stavanger står i `data/personer.json`, og velgeren øverst på siden
lister de voksne av dem. Alle har adresse i matrikkelen og tinglyst eier i grunnboken,
og hver husstand har barn i barnehage eller SFO, så profilkortet og tjenestelisten har
noe å vise for hver av dem.

To ting er verdt å vite om Stavanger som demokommune:

- **Ingen av de pinnede demo-casene i `data/deltakercaser.json` ligger i Stavanger.**
  Sakskortet står derfor tomt til noen kjører en flyt for en Stavanger-bruker i
  demo-GUI-et på `:3001`. Da skrives `state/`, og saken dukker opp ved neste
  sidelasting. `person-008` er nevnt i `deltakercaser.json` som SFO-brukeren som gir
  *avslag* på 653 000 i grunnlag, hvis du vil se den veien gjennom flyten.
- **Satsene i `data/satser.json` er framstilt for Bergen.** Maksgrensen på 6 % og de
  elleve betalingsmånedene er nasjonale og gjelder uansett kommune, men
  SFO-inntektsgrensene ved siden av er kommunale og hentet fra Bergen sine vedtekter.
  Det er seeddata og ikke noe denne appen kan rette på.

**Ingenting er funnet på.** En kommunal Min side ville også vist tømmedager,
feiing og eiendomsskatt. Sandkassen har ingen datoer for noe av det, så de står ikke
her. Kalenderen er kortere enn en ekte, og det er hele poenget: den viser hva
datagrunnlaget rekker til.

## Innlogging

Forsiden har én knapp, og den går til ID-porten. Ikke den ekte: sandkassens mock i
[`apps/digdir-mock`](../digdir-mock/README.md) på `:8086`, som viser en liste over
testpersoner og signerer et token med sine egne nøkler.

```
/  ->  digdir-mock /idporten/authorize  ->  /callback  ->  /minside
       (velg testperson)                   (code -> token)
```

Flyten er ikke skrevet på nytt her. Den bor i `apps/shared/client/felles.ts`, deles med
demo-gui, og denne portalen er den andre kalleren: PKCE, `state` som bærer returstien,
og tokenet i `sessionStorage` framfor `localStorage`, fordi det ikke skal overleve fanen
på en delt maskin. Det eneste som skilte seg var navnet ID-porten viser innbyggeren, så
`requireLogin` fikk en valgfri `clientId`. Standarden er uendret for de to andre
frontendene.

**Min side har ingen personvelger.** Under ID-porten velger man ikke hvem man er inne i
applikasjonen, man beviser det hos utstederen. `pid`-kravet i tokenet er
fødselsnummeret, og siden slår det opp. Vil du se en annen innbygger, logger du inn på
nytt - velgeren står i ID-porten-mocken.

Logger du inn som noen som bor i en annen kommune, svarer API-et `403` og siden sier
hvilken kommune du hører til, framfor å vise en tom eller feil Min side. Hvem som kan
logge inn i det hele tatt avgjøres av `apps/shared/handleevne.ts`, som digdir-mock
leser: under 13 år, død, utflyttet eller D-nummer står ikke i listen.

## Ruter

| Rute | Hva den gjør |
| --- | --- |
| `GET /` | Forsiden, etter stavanger.kommune.no. Ingen andre lenker enn innloggingen |
| `GET /minside` | Min side. Krever token, ellers sendes du til ID-porten |
| `GET /callback` | Returadressen fra ID-porten. Bytter engangskoden i et token |
| `GET /api/testbrukere` | Testpersonene i kommunen som kan logge inn, hentet fra digdir-mock |
| `GET /api/minside/pid/{pid}` | Datagrunnlaget for den innloggede, slått opp på fødselsnummer |
| `GET /api/minside/{personId}` | Samme, slått opp på personId |
| `GET /api/innbyggere` | De voksne innbyggerne i kommunen |
| `GET /helse` | `{ "status": "ok", "tjeneste": "innbyggerportal" }` |

Bortsett fra innloggingen kaller portalen ingen andre tjenester. Den leser `data/` og
`state/` rett fra disken gjennom `readJson` i `apps/shared/jsonstore.ts`, som ser i
`state/` først. Kjører du en flyt i demo-GUI-et på `:3001`, dukker søknaden opp her ved
neste sidelasting.

`DIGDIR_BASE_URL` er adressen tjeneren ringer ID-porten-mocken på, standard
`http://localhost:8086`. Nettleseren bruker `localhost:8086` uansett, siden redirecten
skjer der.

## Kjøring

```bash
pnpm start:innbyggerportal      # eller: docker compose up -d innbyggerportal
pnpm start:digdir               # innloggingen trenger denne
```

Så <http://localhost:3002>.

## Teknisk

- Statisk HTML og ett sidescript per side, null avhengigheter og ingen byggesteg.
  Scriptene under `src/client/` serveres som `.ts` og type-strippes ved servering, slik
  demo-gui gjør det. Hver av dem starter med `export {}` og er dermed en modul, mens
  den delte `felles.ts` er et klassisk skript hvis funksjoner er globale.
- **Forsiden er det ene stedet som ikke bruker `--ds-*`-fargene.** Den skal se ut som
  Stavanger kommune sin egen side, og KS Digital sitt tema bærer KS Digital sine farger.
  Paletten og målene er lest av stavanger.kommune.no og står som `--sk-*` øverst i
  `forside.html`, med en kommentar som sier hvorfor: lilla `#452b75`, gul strek på 3 px,
  kontroller 50 px høye, innhold i en 1250 px kolonne, overskrifter 30 px i vekt 500 og
  brødtekst 18 px. Fonten deres, TT Norms Pro, er lisensiert og ligger ikke i
  sandkassen, så Inter står i stedet. Min side bruker designsystemet uendret.
- **Bølgen og klattene er en SVG, ikke et bilde.** Den ekte siden legger dem som én PNG
  med `background-size: 100% auto` forankret i toppen. SVG-en her har samme mål
  (1940x635) og samme oppførsel, så ingenting lastes fra kommunens servere og formene
  følger tekststørrelsen.
- **De to knappene til venstre for «Min side» virker.** Månen slår på mørk modus, `AA`
  gjør teksten større. Begge lagres i `sessionStorage` og leses av et kort skript i
  `<head>` på hver side, før første maling - ellers blinker siden lys før valget slår
  inn. Fargemodusen settes som `data-color-scheme`, designsystemets eget attributt, så
  Min side blir mørk av samme valg uten en linje ekstra der. Det er betalingen for at
  hver farge på Min side er et token og ingen hardkodet heksverdi.
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
