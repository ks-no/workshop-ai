# KS Digital designsystem i denne sandboxen

> **For deg som bygger frontend.** Trenger du ikke det, kan du hoppe over hele fila.

Referansen når du bygger frontend — enten du utvider `demo-gui` eller lager din egen. Den
er komplett med vilje, så den også kan limes inn i en KI-agent som eneste kontekst.

Se det kjøre: **<http://localhost:3001/ds-eksempel>**. Den siden viser hver komponent med
markupen sin rett under, lest ut av DOM-en, så kodeeksemplene der kan ikke bli utdaterte.

---

## Kort fortalt

Tre stilark og ett attributt på `<html>`, og du er i gang. Ingen npm, ingen bundler,
ingen byggesteg:

```html
<html lang="nb" data-color-scheme="light">
  <head>
    <link rel="stylesheet" href="https://static.fiks.ks.no/googlefonts/googleapis/css2?family=Inter:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/assets/ds-base.css" />
    <link rel="stylesheet" href="/assets/ds-ksdigital.css" />
  </head>
```

Deretter er hele API-et klasser og attributter på vanlig HTML:

```html
<button class="ds-button" type="button" data-variant="secondary">Avbryt</button>
```

**Ikke last `/assets/felles.css` på samme side.** Den er sandboxens eget stilark og slår
designsystemet i kaskaden. Se seksjon 8, Fallgruver.

---

## 1. Hva dette er

KS Digital sitt designsystem bygger på [Designsystemet fra Digdir](https://designsystemet.no).
Komponentene brukes rett fra Digdir der de finnes, og KS Digital legger til egne der
produktteamene har behov. Prefikset forteller hvem som eier hva:

- `ds-` — komponenter fra Digdir. Nesten alt.
- `ksd-` — KS Digital sine egne. I dag er dette bare finpuss (Phosphor-ikoner i varsler,
  Inter som brødtekst), men det er der egne komponenter kommer.

| Hvor | Lenke |
| --- | --- |
| Storybook: komponentkatalog, temavelger, lys/mørk | <https://design.ksdigital.no> |
| — bare Web-komponentene | <https://design.ksdigital.no/web> |
| — bare React | <https://design.ksdigital.no/react> |
| — bare Angular | <https://design.ksdigital.no/angular> |
| Komponentdokumentasjon (Digdir) | <https://designsystemet.no/no/components> |
| Kildekode | <https://github.com/ks-no/designsystem> |
| Figma-bibliotek | [Designsystemet \| KS Digital Core UI Kit](https://www.figma.com/design/SjSyWDPc4uAHufxmzdH8Fz/Designsystemet-%7C-KS-Digital-Core-UI-Kit) |
| Spørsmål | `fiks@ksdigital.no`, eller Slack `#designsystem` |

Denne siden gjentar ikke Digdirs dokumentasjon. Den forklarer mekanikken, og hvordan
designsystemet henger sammen med *denne* sandboxen.

---

## 2. Oppsett

### 2.1 Repolokalt — virker uten nett

De to CSS-filene ligger i repoet, i `apps/shared-ui/`, og serveres av begge frontendene
på `/assets/`. Dette er den eneste veien som virker når sandboxen kjører uten internett.

```html
<link rel="stylesheet" href="/assets/ds-base.css" />
<link rel="stylesheet" href="/assets/ds-ksdigital.css" />
```

Uten nett laster ikke Inter, og nettleseren faller tilbake til `sans-serif`. Layout,
farger og komponenter er upåvirket — bare bokstavformene blir andre.

Oppdatere filene: `pnpm ds:hent`. Versjonen er pinnet i `scripts/hent-designsystem.js`.

### 2.2 CDN — når du har nett

Samme filer, hentet fra npm via jsDelivr. Bruk denne når du bygger utenfor dette repoet.

```html
<link rel="stylesheet" href="https://static.fiks.ks.no/googlefonts/googleapis/css2?family=Inter:wght@400;500;600;700&display=swap" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ks-digital/designsystem-themes@0.0.1-alpha.69/dist/base.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ks-digital/designsystem-themes@0.0.1-alpha.69/dist/themes/ksdigital.css" />
```

Pin versjonen. Pakken er `0.0.1-alpha.*`, altså før 1.0, og klassenavn kan fortsatt
flytte seg. En flytende versjon betyr at en oppdatering hos KS Digital kan brekke
frontenden din midt i hackathonet.

### 2.3 React

Har du et eget prosjekt med bundler, får du komponentene som React-komponenter:

```bash
pnpm add @ks-digital/designsystem-react @ks-digital/designsystem-themes
```

```js
import '@ks-digital/designsystem-themes/base.css'
import '@ks-digital/designsystem-themes/ksdigital.css'
```

```tsx
import { Button } from '@ks-digital/designsystem-react'

export function Send() {
  return <Button data-size="lg">Send søknad</Button>
}
```

Attributtene er de samme som i CSS-varianten — `data-size`, `data-color`, `data-variant`
sendes rett gjennom. Alt i denne referansen gjelder derfor også for React.

Dette krever et prosjekt utenfor `workshop-ai`. Repoet her har null runtime-avhengigheter
og ingen bundler, og skal beholde det.

### 2.4 Angular

`@ks-digital/designsystem-angular` finnes, men er uttalt WIP og kan innføre brytende
endringer. Oppsettet, inkludert `@layer`-rekkefølgen hvis du også bruker Tailwind:

```css
@layer theme, base, utilities, ds, ksd;

@import url('@ks-digital/designsystem-themes/base.css');
@import url('@ks-digital/designsystem-themes/ksdigital.css');

@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/preflight.css' layer(base);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@ks-digital/designsystem-themes/ksdigital.tailwind.css' layer(theme);
```

---

## 3. Tokens

Alt visuelt kommer fra CSS custom properties. Bruk dem i din egen CSS i stedet for å
skrive verdier.

### Farger

Navnemønsteret er `--ds-color-{familie}-{rolle}-{tilstand}`.

**Åtte familier.** `accent` `neutral` `support1` `support2` `success` `warning` `danger` `info`

`accent` er standarden. Måler du en `ds-tag` i `ksdigital`-temaet, gir «uten attributt» og
`data-color="accent"` samme `rgb(232, 232, 236)`, mens `support1` gir `rgb(235, 230, 252)`.
Det er derfor `data-color="accent"` ser ut som en bug — den er et nulloperasjon.

**Seks roller.** `background` (helsidebakgrunn) · `surface` (kort, flater) ·
`border` · `text` · `icon` · `base` (fyll for det mest markante elementet, som en
primærknapp)

**Tilstander.** `default` `hover` `active` `subtle` `strong` `tinted` `contrast-default`
— ikke alle kombinasjoner finnes; slå opp i `apps/shared-ui/ds-ksdigital.css` når du er
usikker.

```css
.min-boks {
  background: var(--ds-color-neutral-surface-default);
  border: 1px solid var(--ds-color-neutral-border-subtle);
  color: var(--ds-color-neutral-text-default);
}
```

Det finnes også korte aliaser som følger nærmeste `data-color` i treet:
`--ds-color-base-default`, `--ds-color-surface-default`, `--ds-color-text-default`,
`--ds-color-border-default`. Bruk disse når komponenten skal bytte farge med omgivelsene.

I `ksdigital`-temaet er `accent` mørk marineblå (`#00042e`) og `support1` lilla
(`#714eea`). Du skal ikke trenge å vite det — men det er nyttig for å kjenne igjen når
noe *ikke* bruker temaet.

### Størrelser, typografi, form

| Token | Verdier | Til hva |
| --- | --- | --- |
| `--ds-size-N` | `0`–`15`, så `18`, `22`, `26`, `30` | padding, gap, margin |
| `--ds-font-size-N` | `1`–`10`, der `1` er minst | fritekst utenfor komponenter |
| `--ds-font-weight-regular\|medium\|semibold` | | |
| `--ds-border-radius-sm\|md\|lg\|xl\|full` | | |
| `--ds-font-family` | `Inter` | |

Skalaen har hull over 15 — `--ds-size-16` finnes ikke og resolver til ingenting.
Skalaen er relativ, ikke absolutt: `--ds-size-4` regnes ut fra `--ds-size-base`, som
`data-size` justerer. Det er derfor et tokenbasert oppsett skalerer riktig og hardkodede
`px` ikke gjør det.

---

## 4. Mekanikken: fire attributter

Dette er den delen som er lett å misforstå, og som gjør designsystemet kort å skrive.

### `data-size` — arves

Sett den én gang på en beholder, og *alt* under skalerer: tekst, padding, ikoner,
kontrollhøyder.

```html
<section data-size="lg">
  <h2 class="ds-heading" data-size="md">Skalerer med seksjonen</h2>
  <button class="ds-button">Skalerer også</button>
</section>
```

Verdier: `2xs` `xs` `sm` `md` `lg` `xl` — `md` er standard, og ikke alle komponenter
støtter ytterpunktene. Fordi den arves, er `data-size="lg"` på en wrapper *ikke* en måte
å gjøre én knapp større; det gjør hele treet større.

### `data-color` — arves

Bytter fargefamilie for et helt undertre. Én av de åtte familiene over.

```html
<div data-color="support1">
  <button class="ds-button">Lilla</button>
  <span class="ds-tag">Lilla</span>
</div>
```

### `data-variant` — per komponent

Arves ikke. Verifiserte verdier, lest ut av `apps/shared-ui/ds-base.css`:

| Komponent | `data-variant` |
| --- | --- |
| `ds-button` | `secondary`, `tertiary` (utelatt = primær) |
| `ds-card`, `ds-details`, `ds-popover` | `default`, `tinted` |
| `ds-tag` | `outline` |
| `ds-badge` | `base`, `tinted` |
| `ds-paragraph` | `long`, `short` |
| `ds-avatar` | `square` |
| `ds-skeleton` | `text`, `circle` |
| `ds-toggle-group` | `secondary` |
| `ds-field` | `outline` |

### `data-color-scheme` — på `<html>`

`light` · `dark` · `auto` (følger operativsystemet). Temaet definerer hele fargeskalaen
for begge modi, så mørk modus koster deg ingenting — *hvis* du kun bruker tokens.
Hardkodede farger er det som brekker den.

Andre attributter du vil møte: `data-size` og `data-color` finnes også på `ds-heading`,
`ds-paragraph`, `ds-spinner`, `ds-table`; `data-placement` på `ds-badge` og `ds-dialog`;
`data-weight` på `ds-label`; `data-field="description"` på beskrivelsestekst i skjemafelt.

---

## 5. Markup-oppskrifter

Komponentene denne sandboxen faktisk trenger. Full katalog i
[Storybook](https://design.ksdigital.no).

### Tekst

```html
<h1 class="ds-heading" data-size="xl">Redusert foreldrebetaling</h1>
<p class="ds-paragraph" data-size="md" data-variant="long">Lengre brødtekst.</p>
<a class="ds-link" href="/utforsker">En lenke</a>
<ul class="ds-list"><li>Punkt</li></ul>
<hr class="ds-divider" />
```

`ds-heading` styrer *utseende*, `<h1>`–`<h6>` styrer *struktur*. De er uavhengige, og det
er meningen: velg overskriftsnivå etter dokumentets hierarki, `data-size` etter designet.

### Knapper

```html
<button class="ds-button" type="button">Send søknad</button>
<button class="ds-button" type="button" data-variant="secondary">Avbryt</button>
<button class="ds-button" type="button" data-variant="tertiary">Les mer</button>
<button class="ds-button" type="button" data-color="danger">Trekk samtykke</button>
<button class="ds-button" type="button" disabled>Låst</button>
```

### Skjemafelt

`ds-field` er beholderen. Den gir avstand mellom barna og kobler tilstander som
`readonly` visuelt. Rekkefølgen inni bestemmer plasseringen.

```html
<div class="ds-field">
  <label class="ds-label" for="inntekt">Samlet inntekt</label>
  <p class="ds-paragraph" data-size="sm" data-field="description">Kun syntetiske data.</p>
  <input class="ds-input" id="inntekt" type="text" />
  <p class="ds-validation-message">Inntekt må være et tall.</p>
</div>
```

Sett `aria-invalid="true"` på inputen når du viser en `ds-validation-message` — det er
det som gjør feltet rødt, og det er også det skjermlesere leser.

`ds-input` gjelder alle kontroller: `<input>`, `<select>`, `<textarea>`, avkryssing og
radioknapp. Grupper med `ds-fieldset` og `<legend class="ds-label">`.

### Varsler

```html
<div class="ds-alert">
  <p class="ds-paragraph">Alle data i sandboxen er syntetiske.</p>
</div>

<div class="ds-alert" data-color="danger">
  <h3 class="ds-heading" data-size="2xs">Spørsmålet ble stoppet</h3>
  <p class="ds-paragraph">Sperren ligger i koden.</p>
</div>
```

Ikonet kommer av seg selv, valgt ut fra `data-color`. Uten `data-color` blir varselet
`info`. Bruk `aria-live="polite"` hvis innholdet endres etter at siden er lastet.

### Kort

```html
<div class="ds-card">
  <div class="ds-card__block"><h3 class="ds-heading" data-size="xs">Steg 3 av 7</h3></div>
  <div class="ds-card__block"><p class="ds-paragraph">Samtykke til å hente inntekt.</p></div>
</div>
```

Bytt `<div class="ds-card">` til `<a class="ds-card" href="…">` og hele kortet blir
klikkbart, med riktig fokusmarkering. Ikke pakk et kort i en lenke — gjør kortet til
lenken.

### Tabell

```html
<table class="ds-table" data-size="sm">
  <caption>Vilkår som ble vurdert</caption>
  <thead>
    <tr><th scope="col">Vilkår</th><th scope="col">Utfall</th></tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Inntekt under terskel</th>
      <td><span class="ds-tag" data-color="success">Oppfylt</span></td>
    </tr>
  </tbody>
</table>
```

`thead`/`tbody` og `scope` er ikke pynt — stilene henger på dem, og skjermlesere trenger
dem.

### Merker

```html
<span class="ds-tag" data-color="success">Oppfylt</span>
<span class="ds-tag" data-color="warning" data-variant="outline">Mock-modell</span>
<span class="ds-chip">Barnehage</span>

<!-- Tallet kommer fra data-count, ikke fra tekstinnholdet -->
<span class="ds-badge" data-count="3" data-color="danger"></span>

<!-- Plassert på noe: telleren legger seg i hjørnet -->
<span class="ds-badge--position" data-placement="top-right">
  <span class="ds-badge" data-count="7" data-color="danger" aria-hidden="true"></span>
  <button class="ds-button" type="button" data-variant="secondary">Oppgaver</button>
</span>
```

### Feiloppsummering

```html
<div class="ds-error-summary">
  <h3 class="ds-heading" data-size="xs">Skjemaet mangler noe</h3>
  <ul class="ds-list">
    <li><a class="ds-link" href="#inntekt">Inntekt må være et tall</a></li>
  </ul>
</div>
```

### Sammentrekk

```html
<details class="ds-details">
  <summary>Hva regnes som husstand?</summary>
  <p class="ds-paragraph">Personer registrert på samme adresse.</p>
</details>
```

### Venting

Spinneren er en SVG med to sirkler, ikke et tomt element — et `<span class="ds-spinner">`
viser ingenting:

```html
<svg class="ds-spinner" data-size="md" viewBox="0 0 50 50" role="img" aria-label="Laster">
  <circle class="ds-spinner__background" cx="25" cy="25" r="20" fill="none" stroke-width="5" />
  <circle class="ds-spinner__circle" cx="25" cy="25" r="20" fill="none" stroke-width="5" />
</svg>

<!-- data-variant="text" er display:inline og må stå i en tekstflyt -->
<p class="ds-paragraph">
  Henter <span class="ds-skeleton" data-variant="text" data-text="inntekt for husstanden"></span>
  fra Skatteetaten.
</p>
```

Enten `aria-label` eller `aria-hidden="true"` — en spinner uten begge er en stille
tilstandsendring for en skjermleserbruker.

### Kommunevåpen

```html
<img src="https://static.fiks.ks.no/img/kommunevaapen/4601.png" alt="Bergen kommunes våpen" />
```

Filnavnet er kommunenummeret. Krever nett.

---

## 6. Hva som ikke virker uten JavaScript

CSS-en gir deg utseendet. Noen komponenter trenger også oppførsel, og den ligger i
`@digdir/designsystemet-web`.

**Virker uten JS**, fordi de bygger på nettleserens egne elementer:
`ds-details` (`<details>`), `ds-dialog` (`<dialog>`), `ds-popover` (Popover-API-et), og
alle skjemakomponentene, tabell, kort, varsler, merker, feiloppsummering, spinner.

**Trenger JS:** `ds-combobox`, `ds-suggestion`, `ds-tooltip`, `ds-dropdown`, `ds-tabs`,
`ds-pagination` (tastaturnavigasjon), og automatisk kobling av `label`/`description`-id-er
i `ds-field`.

Trenger du dem og har nett:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@digdir/designsystemet-web@1.20.0/+esm"></script>
```

Vær oppmerksom på versjonsspriket: CSS-en i temapakken er bygget fra `v1.15.0`. Sjekk at
komponenten du trenger faktisk oppfører seg før du bygger videre på den.

---

## 7. Temaer

Fire temaer er offisielt støttet. Bytt fil, ikke kode:

| Tema | Filnavn | Brukes til |
| --- | --- | --- |
| KS Digital | `ksdigital.css` (alias `forvaltning.css`) | forvaltningsløsninger — **standard her** |
| Min Kommune | `minkommune.css` | |
| Ledsagerbevis | `ledsagerbevis.css` | |
| Tilskudd | `tilskudd.css` | |

Repoet har bare `ksdigital` sjekket inn. Vil du prøve et annet, endre `TEMA` i
`scripts/hent-designsystem.js` og kjør `pnpm ds:hent`, eller pek på jsDelivr direkte.

Alle fire har full lys/mørk-støtte. Du kan forhåndsvise dem i
[Storybook](https://design.ksdigital.no) med verktøylinjen øverst.

---

## 8. Fallgruver

**`felles.css` og designsystemet kan ikke lastes på samme side.** Dette er den viktigste
linja på siden. `apps/shared-ui/felles.css` har ingen `@layer`, og ulagede CSS-regler slår
*alle* lag i kaskaden — også `@layer ds` og `@layer ksd`. Resultatet er verifisert og
udramatisk å se: Inter forsvinner, bakgrunnen blir sandboxens blågrå, og primær-,
sekundær-, tertiær- og danger-knapper blir alle den samme blå. Det ser ut som CSS-en ikke
lastet. Den lastet — den ble overstyrt.

Bygger du en ny side: velg én av dem. Vil du overstyre designsystemet i din egen CSS,
deklarer et lag etter `ksd`:

```css
@layer side;             /* ds og ksd er alt deklarert, side havner etter */
@layer side {
  .min-boks { padding: var(--ds-size-6); }
}
```

Da trenger du verken `!important` eller spesifisitetstriks.

**`data-size` arves.** Se seksjon 4. Skal én komponent være større, sett
attributtet på komponenten.

**Egne hex-farger brekker mørk modus.** Temaet bytter tokens når `data-color-scheme`
endres. En hardkodet `#1459c7` gjør det ikke.

**Alpha-versjon.** `0.0.1-alpha.69`. Pin, og forvent at ting kan flytte seg mellom
hackathonet og neste gang du ser på dette.

**Spinneren er en SVG.** Et tomt `<span class="ds-spinner">` er usynlig.

**Noen komponenter leser innholdet sitt fra et attributt, ikke fra tekstnoden.** CSS-en
setter `content: attr(...)` på et `::before`. Skriver du tallet som tekst, får du en tom
boble *og* tallet ved siden av:

| Komponent | Riktig | Feil |
| --- | --- | --- |
| `ds-badge` | `data-count="3"` | `>3<` som tekstinnhold |
| `ds-avatar` | `data-initials="ØS"` | `>ØS<` som tekstinnhold |
| `ds-skeleton` med `data-variant="text"` | `data-text="…"` | inline `style="width: …"` |

De to skeleton-variantene har ulik `display`: `text` er `inline` og skal stå i en
tekstflyt — inni avsnittet den erstatter tekst i. Legger du den rett i en flex- eller
grid-container, blir den blokk-gjort og strekker seg over hele raden. `circle` er
`block` og tar sin egen linje.

**`data-color="accent"` gjør ingenting.** `accent` er standardfargen i temaet, så
attributtet ser ødelagt ut. Bruk `support1`, `neutral` eller en av de semantiske hvis du
vil se en forskjell.

---

## 9. Regler når du skriver frontend her

Disse gjelder alle som skriver frontend i `workshop-ai` — deg og enhver KI-agent du
bruker. De er ikke stilpreferanser: hver av dem hindrer en konkret feil.

1. **Ikke bland designsystemet inn i `felles.css` eller i eksisterende sider.** Ny
   frontend = ny fil. `demo-gui` og `process-builder` er referanseimplementasjoner andre
   team leser for å forstå sandboxen; de skal fortsatt virke.
2. **Aldri `felles.css` og ds-CSS på samme side.** Se seksjon 8.
3. **Ingen npm-avhengigheter og ingen byggesteg i dette repoet.** Designsystemet passer
   nettopp fordi det er ren CSS. Vil du bruke React-pakken, gjør
   det i et eget prosjekt.
4. **Ikke finn opp klassenavn.** Står den ikke i
   `apps/shared-ui/ds-base.css` eller i [Storybook](https://design.ksdigital.no),
   finnes den ikke. `grep -o '\.ds-[a-z-]*' apps/shared-ui/ds-base.css | sort -u` er hele
   sannheten.
5. **Ingen egne farge-, avstands- eller radiusverdier.** Bruk tokens.
6. **Navnekonvensjonen fra AGENTS.md gjelder fortsatt.** Engelsk for teknikk, norsk for
   fagspråk. Klassenavnene dine er teknikk og skal være engelske. Og **wire-formatet er
   frosset**: `melding`, `steg`, `stegId`, `grunnlag`, `samtykke`, `svar`, `sporingsId`
   beholder navnene sine i JSON, uansett hvor pen frontenden blir.
7. **Sperrer, samtykke og skjerming er backend-krav.** Et pent skjema er ikke en sperre,
   og en avkryssingsboks er ikke et samtykke. Frontenden viser tilstanden; backend
   håndhever den. Ikke omgå samtykkeporten i UI-et.
8. **Universell utforming er ikke gratis.** Designsystemet gir deg tilgjengelige
   *komponenter*. Strukturen du setter dem i er ditt ansvar: `<html lang="nb">`, riktig
   overskriftsnivå, `aria-live` på svar som strømmer inn, `aria-invalid` på felt med feil,
   `alt` på bilder, og aldri farge som eneste bærer av mening.
9. **Bygg DOM med `createElement` og `textContent`, ikke `innerHTML`.** Dette er
   konvensjonen i `utforsker.html` og resten av sandboxen, og innholdet her kommer fra
   API-svar.

---

## 10. Versjoner

| Hva | Versjon | Kilde |
| --- | --- | --- |
| `@ks-digital/designsystem-themes` | `0.0.1-alpha.69` | npm / jsDelivr |
| Designsystemet (CSS-bygg) | `v1.15.0` | headeren i `ds-ksdigital.css` |
| `@digdir/designsystemet-web` (valgfri JS) | `1.20.0` | npm / jsDelivr |

`apps/shared-ui/ds-base.css` og `apps/shared-ui/ds-ksdigital.css` er hentet uendret fra
temapakken og sjekket inn, slik at sandboxen virker uten nett. Endre dem aldri for hånd —
endringen forsvinner neste gang noen kjører `pnpm ds:hent`. Trenger du å overstyre noe,
gjør det i et lag etter `ksd`.
