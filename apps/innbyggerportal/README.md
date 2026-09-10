# Innbyggerportal

**For deg som vil se hvordan en «Min side» for Stavanger kommune kan se ut når den
bare får lov til å vise det sandkassen faktisk har.** Én side på `:3002`, bygget på KS
Digital sitt designsystem, med profil, saksstatus, tjenester og kalender for én
innbygger om gangen.

Siden er en **demo av en flate**, ikke en tvungen klient. Skal du bygge din egen
frontend, hører den hjemme i ditt eget prosjekt mot de dokumenterte API-ene -
oppskriften står i [`docs/bygg-selv.md`](../../docs/bygg-selv.md).

## Hva den viser

| Kort | Hva som står der | Hvor tallene kommer fra |
| --- | --- | --- |
| Min profil | Navn, adresse, kommune, maskert fødselsnummer, husstand og fast eiendom | `data/personer.json`, `data/husstander.json`, `data/matrikkel.json`, `data/eierforhold.json` |
| Pågående sak | Søknaden eller den påbegynte prosessen, med stegene fra prosessdefinisjonen | `state/soknader.json`, `state/oppgaver.json`, `state/prosessoekter.json`, `data/prosessdefinisjoner.json` |
| Tjenester | Fem snarveier som folder seg ut med det innbyggeren faktisk har | `state/forsendelser.json`, `data/eierforhold.json`, `data/barnehageplasser.json`, `data/sfoplasser.json`, `data/fritidsdeltakelse.json`, `data/tjenestetilbud.json` |
| Kalender | Frister og datoer som allerede står i dataene | `data/satser.json`, `state/samtykker.json`, `data/inntekter.json`, `data/legeerklaeringer.json`, `data/politiattester.json`, `data/krr.json` |

Hvert kort skriver kilden sin nederst, så et tall på skjermen kan følges tilbake til
raden det står i.

## Kommunen sitter ett sted

`KOMMUNENUMMER` og `KOMMUNENAVN` øverst i `src/minside.ts` avgjør hele siden: hvem som
står i velgeren, hvilke tilbud som telles, hva toppfeltet sier og hvilket kommunevåpen
som hentes. Skal siden vise en annen kommune, er det de to linjene. Toppfeltet i
`minside.html` har Stavanger ferdig utfylt bare for at det ikke skal stå tomt før
scriptet har kjørt; klienten skriver det om fra `/api/minside/{personId}`.

Seeden har 12 personer i Stavanger, hvorav fem voksne. Alle fem har adresse i
matrikkelen og tinglyst eier, og alle tre husstandene har barn i barnehage eller SFO.

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

## Ruter

| Rute | Hva den gjør |
| --- | --- |
| `GET /` | Siden. Tar `?person=<personId>` |
| `GET /api/innbyggere` | De voksne innbyggerne i kommunen, til velgeren øverst |
| `GET /api/minside/{personId}` | Datagrunnlaget siden tegnes fra |
| `GET /helse` | `{ "status": "ok", "tjeneste": "innbyggerportal" }` |

Portalen kaller ingen av de andre tjenestene. Den leser `data/` og `state/` rett fra
disken gjennom `readJson` i `apps/shared/jsonstore.ts`, som ser i `state/` først. Kjører
du en flyt i demo-GUI-et på `:3001`, dukker søknaden opp her ved neste sidelasting.

## Kjøring

```bash
pnpm start:innbyggerportal      # eller: docker compose up -d innbyggerportal
```

Så <http://localhost:3002>.

## Teknisk

- Statisk HTML og ett sidescript, null avhengigheter og ingen byggesteg.
  `apps/innbyggerportal/src/client/minside.ts` serveres som `.ts` og type-strippes
  ved servering, slik demo-gui gjør det.
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
