---
name: ksd-designsystem
description: Bruk KS Digital sitt designsystem når du skriver frontend, HTML, CSS eller GUI i dette repoet — enten du utvider demo-gui/process-builder eller lager en ny frontend. Dekker oppsett, kaskaderegler og hvor komponentene er dokumentert. Bruk også når noen spør om styling, komponenter, ds-klasser, tokens, temaer, lys/mørk-modus eller universell utforming.
---

# KS Digital designsystem

Komponenter, API og tilgjengelighet er dokumentert hos Digdir:
**<https://designsystemet.no/no>**. Slå opp der.

**Forventningen er at frontend bygges i et eget prosjekt utenfor dette repoet**, mot
sandkassens API-er (`docs/bygg-selv.md`). Der installeres designsystemet fra npm
(`@ks-digital/designsystem-themes`), og «Aldri»-punkt 1–3 under gjelder ikke — de er
regler for *dette* repoet. Bygger du likevel her inne, gjelder alt.

`docs/designsystem.md` dekker begge oppsettene, kaskadefella og fallgruvene. Les den før
du skriver mer enn noen få linjer frontend.
Kjørende markup for hver komponent: `apps/demo-gui/src/ds-eksempel.html`, servert på
<http://localhost:3001/ds-eksempel>, serialisert fra DOM-en og derfor aldri utdatert.

## Oppsett

Tre stilark og ett attributt på `<html>`:

```html
<html lang="nb" data-color-scheme="light">
  <head>
    <link rel="stylesheet" href="https://static.fiks.ks.no/googlefonts/googleapis/css2?family=Inter:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/assets/ds-base.css" />
    <link rel="stylesheet" href="/assets/ds-ksdigital.css" />
  </head>
```

API-et er klasser og attributter på vanlig HTML:
`<button class="ds-button" data-variant="secondary">`. `data-size` og `data-color` arves
nedover i treet; `data-variant` gjør ikke.

## Aldri

1. **Aldri last `/assets/felles.css` sammen med ds-CSS.** `felles.css` har ingen `@layer`,
   og ulagede regler slår alle lag. Verifisert effekt: Inter forsvinner og alle
   knappevarianter blir samme blå. Skal du overstyre designsystemet, deklarer
   `@layer side;` (det havner etter `ksd`) og skriv reglene der.
2. **Aldri legg designsystemet inn i `felles.css` eller i eksisterende sider.** Ny
   frontend = ny fil. De eksisterende sidene er referanse for andre team.
3. **Aldri npm-avhengigheter eller byggesteg i dette repoet.** Designsystemet passer
   nettopp fordi temapakken er ren CSS.
4. **Aldri finn opp klassenavn.** Sannheten er
   `grep -o '\.ds-[a-z-]*' apps/shared-ui/ds-base.css | sort -u`.
5. **Aldri egne hex-farger eller px-avstander.** Bruk `--ds-*`-tokens, ellers brekker
   mørk modus.
6. **Aldri rediger `apps/shared-ui/ds-base.css` eller `ds-ksdigital.css`.** De er hentet
   uendret fra pakken og overskrives av `pnpm ds:hent`.

## Husk

- Navnekonvensjonen i `AGENTS.md` gjelder fortsatt: engelsk for teknikk, norsk for
  fagspråk, og **wire-formatet er frosset** (`melding`, `steg`, `grunnlag`, `samtykke` …).
- Sperrer, samtykke og skjerming håndheves i backend. Frontenden viser tilstanden, den
  lager den ikke.
- Bygg DOM med `createElement` + `textContent`, aldri `innerHTML`.
- `<html lang="nb">`, `aria-live` på svar som strømmer inn, `aria-invalid` på felt med
  feil. Designsystemet gir tilgjengelige komponenter, ikke tilgjengelig struktur.
