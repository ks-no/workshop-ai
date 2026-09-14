# Attribusjon og tredjepartsvilkår

Sandkassen er lisensiert under MIT. Se [`LICENSE`](LICENSE).

Denne filen dekker det repoet videredistribuerer eller laster ned fra andre, og som
har egne vilkår. Den er ikke uttømmende juridisk rådgivning: skal du bruke noe av
dette til annet enn demo, les kilden selv.

## Designsystemet

`apps/shared/ds-base.css` og `apps/shared/ds-ksdigital.css` er hentet inn som ren CSS
fra `@ks-digital/designsystem-themes`, som igjen bygger på `@digdir/designsystemet-css`.
Versjonen er pinnet i `scripts/hent-designsystem.ts`, og `pnpm ds:hent` skriver
opphavsnotisen inn i filene på nytt hver gang de hentes. `pnpm test:docs` feiler hvis
notisen mangler, eller hvis versjonen i den har kommet ut av takt med den pinnede.

Begge pakkene er MIT. Tillatelsesnotisene MIT krever at følger med:

```
Copyright (c) 2025 KS Digital

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```
Copyright 2024 Digitaliseringsdirektoratet (Digdir)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Kommunevåpen

`apps/demo-gui/src/ds-eksempel.html` viser våpnene til Bergen, Oslo og Trondheim ved
å hente dem fra `static.fiks.ks.no`. Bildene er ikke en del av dette repoet og er
ikke dekket av MIT-lisensen over. Kommunevåpen er dessuten vernet etter straffeloven
§§ 165 og 166, og en kommune eier sitt eget våpen. Eksempelsiden viser dem som
illustrasjon av designsystemet. Skal du bruke et kommunevåpen til noe annet, spør
kommunen det tilhører.

## Adressedata fra Geonorge

`data/matrikkel.json` er bygget av `scripts/hent-matrikkel.ts` fra Kartverkets
adresse-API på Geonorge (<https://ws.geonorge.no/adresser/v1>). Filen har en
`kilde`-blokk med uttrekksdato per kommune.

Adressedataene er åpne data under Norsk lisens for offentlige data (NLOD), som krever
kildeangivelse: **«Inneholder data under norsk lisens for offentlige data (NLOD)
tilgjengeliggjort av Kartverket.»**

Gate, nummer, postnummer, koordinat, gårds- og bruksnummer er altså ekte.
Eierforholdene i `data/eierforhold.json` er ikke: de er forfattet, og de kobler
syntetiske personer til reelle matrikkelenheter. [`data/README.md`](data/README.md)
sier hva det betyr for det du deler.

`apps/matrikkel-mock` slår også opp mot det samme API-et i kjøretid når en adresse
mangler i seeden. Kjører mange maskiner sandkassen samtidig, går den trafikken til
Kartverkets produksjonstjeneste.

## Testdata fra Tenor

`data/tenor/*.json` og `data/brreg.seed.json` er uttrekk fra Skatteetatens Tenor
testdatasøk, og seks filer under `data/` er avledet av dem. Dataene er syntetiske, og
fødselsnumrene bærer Skatteetatens +80-markør på månedssifrene.

Bruken er regulert av Skatteetatens bruksavtale for Tenor
(<https://skatteetaten.github.io/testnorge-tenor-dokumentasjon/bruksavtale/>).
Avtalen regulerer bruk av tjenesten og sier ikke uttrykkelig noe om å videredistribuere
uttrekk i et offentlig repo. Punkt 6 i avtalen sier dessuten at dataene er syntetiske
med unntak av visse adresser, noe som stemmer med at personene her bor på ekte
adresser. Spørsmålet er stilt til Skatteetaten; til det er besvart, er
videredistribusjonen vår egen vurdering og ikke noe avtalen bekrefter.

## Språkmodeller

`./start.sh` laster ned en modell til Ollama. Modellene har sine egne lisenser og er
ikke en del av dette repoet:

| Modell | Lisens |
|---|---|
| `qwen2.5:0.5b`, `qwen2.5:7b`, `qwen2.5:14b` | Apache-2.0 |
| `llama3.1:8b` | Llama 3.1 Community License |
| `mistral-nemo` | Apache-2.0 |

## Navn på virksomheter og tjenester

Sandkassen navngir KS, Kartverket, Skatteetaten, Digitaliseringsdirektoratet,
Brønnøysundregistrene, politiet, Vestland fylkeskommune, Bergen kommune og Telenor,
og etterligner flater som ID-porten, Maskinporten, KS Fiks, Matrikkelen og Tenor.

Navnene brukes for å si hva mocken etterligner. Ingen av virksomhetene har godkjent,
kvalitetssikret eller er tilknyttet dette prosjektet, og ingen av tjenestene her er
den ekte tjenesten. Navnene og varemerkene tilhører sine respektive eiere.
