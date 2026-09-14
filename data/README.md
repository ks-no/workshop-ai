# Datasettene

Alle data her er syntetiske. Fødselsnumrene bærer Skatteetatens +80-markør på
månedssifrene, og `pnpm test` feiler hvis en elleve-sifret streng i noen av filene
ikke er et gyldig syntetisk nummer.

[`docs/syntetiske-data.md`](../docs/syntetiske-data.md) forklarer hva dataene
inneholder og hvordan de henger sammen. Denne filen sier hvor de kommer fra, og hva
som gjelder for å bruke dem videre.

## Det ene unntaket: adressene er ekte

Nesten hver person bor på en adresse som finnes i virkeligheten, hentet fra
Kartverkets adresse-API. Bare to bor på en oppdiktet adresse fra
`matrikkel.seed.json`, og resten som ikke har en Geonorge-adresse har ingen
bostedsadresse i det hele tatt - D-nummer, døde og utflyttede.

`eierforhold.json` gjør det samme for eiendom: hver matrikkelenhet der har gårds- og
bruksnummer og koordinater fra Kartverket, og en forfattet eier.

Kombinasjonen er altså **syntetisk person på ekte adresse**. Det er et bevisst valg -
en oppdiktet adresse gir en matrikkeloppslag som ikke virker - men det betyr at en
adresse herfra kan tilhøre noen. Skatteetatens egen bruksavtale for Tenor sier det
samme om sine data, i punkt 6: syntetiske, med unntak av visse adresser.

Praktisk: ikke vis en adresse herfra sammen med et navn i noe du publiserer.
[`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) sier det samme.

## Hvor filene kommer fra

### Generert av importen, ikke håndredigert

`personer.json`, `husstander.json`, `inntekter.json`, `krr.json`,
`folkeregister.seed.json` og `eierforhold.json` bygges av
`scripts/importer-tenor.ts` fra `kuratert.json` og `tenor/*.json`. Det samme gjør
`docs/testpersoner.md`. Redigerer du en kuratert rad direkte, blir den overskrevet
ved neste import, og `pnpm test` feiler i mellomtiden.

### Rå uttrekk

| Fil | Kilde | Hentet | Uttrekket |
|---|---|---|---|
| `tenor/*.json` | Skatteetatens Tenor testdatasøk | august 2026 | ett søk per aldersbånd, 20 hoveddokumenter hver. Filnavnet er søkekriteriet |
| `brreg.seed.json` | Tenor, foretaksdelen | august 2026 | 200 foretak. Ingen kobling til befolkningen |
| `matrikkel.json` | [Geonorges adresse-API](https://ws.geonorge.no/adresser/v1) | august 2026 | 388 gater i 97 kommuner, bygget av `scripts/hent-matrikkel.ts`. Filen har `kilde`-blokk med dato per kommune |

Resten er forfattet her: satser, prosessdefinisjoner, tjenestetilbud,
fritidsaktiviteter, legeerklæringer, politiattester, forventede utfall og
`matrikkel.seed.json`.

## Vilkår

Kildeangivelsen NLOD krever for Geonorge-dataene, Skatteetatens bruksavtale for Tenor
og det åpne spørsmålet om å videredistribuere et uttrekk står i
[`NOTICE.md`](../NOTICE.md), sammen med vilkårene til alt annet vi har hentet inn.

## Sandkassen slår også opp live

`matrikkel-mock` faller tilbake på et live oppslag mot Geonorge når en adresse ikke
finnes i `matrikkel.json`. Kjører mange maskiner sandkassen samtidig, går den
trafikken til Kartverkets produksjonstjeneste. Uten nett svarer mocken `404` etter
`MATRIKKEL_HTTP_TIMEOUT_MS`, den stopper ikke.

## Kjøringstilstand hører ikke hjemme her

Søknader, samtykker, oppgaver, meldinger, prosessøkter og revisjonslogg har ingen fil
her. De oppstår under kjøring og havner i `state/`, som er gitignorert.
