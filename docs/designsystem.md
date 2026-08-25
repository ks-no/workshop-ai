# KS Digital designsystem i denne sandboxen

> **For deg som bygger frontend.** Trenger du ikke det, kan du hoppe over hele fila.

**Vi forventer at du bygger frontenden din i ditt eget prosjekt, utenfor dette repoet.**
Sandkassen er API-ene du kaller — den er ikke ment som app-rammeverket ditt. Alle
tjenestene svarer med `Access-Control-Allow-Origin: *`, så en app på din egen port snakker
rett med dem. Oppskriften står i `docs/bygg-selv.md`.

Ingen hindrer deg i å utvide `demo-gui` i stedet, og noen ganger er det raskeste vei til en
demo. Da gjelder ekstra regler — de står under.

Komponentene, API-et deres og tilgjengelighetskravene er dokumentert hos Digdir. Denne
fila dekker bare oppsettet og det som er særegent her.

KS Digital sitt designsystem bygger på [Designsystemet fra Digdir](https://designsystemet.no/no).
Prefikset forteller hvem som eier hva: `ds-` er Digdir sine komponenter (nesten alt), `ksd-`
er KS Digital sine egne tillegg.

---

## Oppsett i ditt eget prosjekt

Dette er den forventede veien. Pakkene ligger på npm:

```bash
pnpm add @ks-digital/designsystem-themes
```

```js
import '@ks-digital/designsystem-themes/base.css'
import '@ks-digital/designsystem-themes/ksdigital.css'
```

Har du React, finnes komponentene også ferdig innpakket
(`@ks-digital/designsystem-react`). Angular-pakken finnes, men er uttalt WIP.

Pin versjonen. Pakkene er `0.0.1-alpha.*`, altså før 1.0, og klassenavn kan fortsatt flytte
seg — en flytende versjon betyr at en oppdatering hos KS Digital kan brekke frontenden din
midt i hackathonet.

Attributt-API-et er det samme uansett variant: `data-size`, `data-color` og `data-variant`
sendes rett gjennom i React også. Alt på <https://designsystemet.no/no> gjelder derfor for
deg.

Setter du opp Tailwind ved siden av, må lagrekkefølgen deklareres først:

```css
@layer theme, base, utilities, ds, ksd;
```

---

## Oppsett inne i sandkassen

Utvider du `demo-gui` eller prosessbyggeren, er CSS-en allerede vendoret i
`apps/shared-ui/` og servert på `/assets/`. Tre stilark og ett attributt på `<html>` —
ingen npm, ingen bundler, ingen byggesteg:

```html
<html lang="nb" data-color-scheme="light">
  <head>
    <link rel="stylesheet" href="https://static.fiks.ks.no/googlefonts/googleapis/css2?family=Inter:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/assets/ds-base.css" />
    <link rel="stylesheet" href="/assets/ds-ksdigital.css" />
  </head>
```

Oppdatere filene: `pnpm ds:hent`. Versjon og tema er pinnet i `scripts/hent-designsystem.ts`.

### Én hard regel her inne

**Last aldri `/assets/felles.css` og designsystemets CSS på samme side.**

`felles.css` er sandkassens eget stilark og har ingen `@layer`. Ulagede CSS-regler slår
*alle* lag i kaskaden — også `@layer ds` og `@layer ksd`. Effekten er verifisert: Inter
forsvinner, bakgrunnen blir sandkassens blågrå, og primær-, sekundær-, tertiær- og
danger-knapper blir alle den samme blå. Det ser ut som CSS-en ikke lastet. Den lastet — den
ble overstyrt.

Bygger du en ny side her inne: velg én av dem. Vil du overstyre designsystemet med vilje,
deklarer et lag etter `ksd`:

```css
@layer side;             /* ds og ksd er alt deklarert, side havner etter */
@layer side {
  .min-boks { padding: var(--ds-size-6); }
}
```

Da trenger du verken `!important` eller spesifisitetstriks.

---

## Hvor du slår opp

| Hva | Hvor |
| --- | --- |
| Komponenter, API og tilgjengelighet — **primærkilden** | <https://designsystemet.no/no> |
| Kjørende markup for hver komponent, lest ut av DOM-en | <http://localhost:3001/ds-eksempel> |
| Storybook med KS Digital-temaet, lys/mørk og temavelger | <https://design.ksdigital.no> |
| Figma-bibliotek | [Designsystemet \| KS Digital Core UI Kit](https://www.figma.com/design/SjSyWDPc4uAHufxmzdH8Fz/Designsystemet-%7C-KS-Digital-Core-UI-Kit) |
| Kildekode | <https://github.com/ks-no/designsystem> |
| Spørsmål | `fiks@ksdigital.no`, eller Slack `#designsystem` |

Kodeeksemplene på `/ds-eksempel` serialiseres fra den levende DOM-en, så de kan ikke bli
utdaterte. Kopier derfra — markupen er den samme i ditt eget prosjekt.

---

## Fallgruver

Disse gjelder uansett hvor du bygger.

- **`data-size` arves.** `data-size="lg"` på en wrapper gjør *hele undertreet* større, ikke
  én knapp. Skal én komponent skille seg ut, sett attributtet på komponenten.
- **Egne hex-farger brekker mørk modus.** Temaet bytter tokens når `data-color-scheme`
  endres; en hardkodet `#1459c7` gjør det ikke. Bruk `--ds-*`-tokens.
- **`ds-spinner` er en SVG med to sirkler**, ikke et tomt element. Et
  `<span class="ds-spinner">` viser ingenting.
- **Noen komponenter leser innholdet sitt fra et attributt, ikke fra tekstnoden.** CSS-en
  setter `content: attr(...)` på et `::before`. Skriver du verdien som tekst, får du en tom
  boble *og* teksten ved siden av: `ds-badge` vil ha `data-count`, `ds-avatar`
  `data-initials`, og `ds-skeleton` med `data-variant="text"` vil ha `data-text`.
- **`data-color="accent"` gjør ingenting.** `accent` er standardfargen i temaet, så
  attributtet ser ødelagt ut. Bruk `support1`, `neutral` eller en av de semantiske hvis du
  vil se en forskjell.

---

## Regler

Gjelder uansett hvor frontenden din bor:

- **Ikke finn opp klassenavn.** Sannheten er
  `grep -o '\.ds-[a-z-]*' apps/shared-ui/ds-base.css | sort -u`.
- **Ingen egne farge-, avstands- eller radiusverdier.** Bruk `--ds-*`-tokens.
- **Wire-formatet er frosset** — `melding`, `steg`, `stegId`, `grunnlag`, `samtykke`,
  `svar`, `sporingsId` beholder navnene sine i JSON, uansett hvor pen frontenden blir.
- **Sperrer, samtykke og skjerming håndheves i backend.** Frontenden viser tilstanden, den
  lager den ikke. Ikke omgå samtykkeporten i UI-et.
- **Universell utforming er ikke gratis.** Designsystemet gir tilgjengelige *komponenter*;
  strukturen er ditt ansvar: `<html lang="nb">`, riktig overskriftsnivå, `aria-live` på svar
  som strømmer inn, `aria-invalid` på felt med feil, `alt` på bilder, og aldri farge som
  eneste bærer av mening.

Gjelder bare hvis du likevel bygger inne i dette repoet:

- **Ingen npm-avhengigheter og ingen byggesteg.** Repoet har null runtime-avhengigheter og
  skal beholde det — derfor er den vendorede CSS-en eneste vei her inne.
- **Ny frontend = ny fil.** `demo-gui` og `process-builder` er referanseimplementasjoner
  andre team leser; de skal fortsatt virke.
- **Aldri rediger `apps/shared-ui/ds-base.css` eller `ds-ksdigital.css`.** De er hentet
  uendret fra temapakken, og `pnpm ds:hent` overskriver endringene dine.
- **Navnekonvensjonen fra `AGENTS.md` gjelder:** engelsk for teknikk, norsk for fagspråk.
- **Bygg DOM med `createElement` og `textContent`, ikke `innerHTML`.** Det er konvensjonen
  i resten av sandkassen, og innholdet kommer fra API-svar.

---

## Kommunevåpen

```html
<img src="https://static.fiks.ks.no/img/kommunevaapen/4601.png" alt="Bergen kommunes våpen" />
```

Filnavnet er kommunenummeret.
