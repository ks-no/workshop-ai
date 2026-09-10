# Politiattest-flyt

Demo av digital lommebok-flyt for en skolejobbsøknad som krever politiattest. Bruker
den samme utstedelses- og verifiseringsmekanismen som [apps/lommebok](../lommebok),
men viser den fram som fire ulike systemer:

- **Drammen kommune** (saksbehandlingssystem) - utsteder formålsbevis, sender en
  etterspørsel etter politiattesten, og viser den ferdig kontrollerte metadataen.
- **Politiet** - kontrollerer formålsbeviset, utsteder politiattest.
- **Innboks** - en forenklet, Gmail-lignende visning av kommunens e-poster til
  søkeren, med QR-koder for å hente formålsbeviset og vise fram politiattesten.
- **Start** - velg en syntetisk testperson med en politiattest for formål «skole».

## Hvorfor en egen app, og ikke en del av lommebok

`apps/lommebok` er én app med to generelle verktøy (utsted et vilkårlig bevis,
verifiser et vilkårlig bevis). Denne appen er en konkret saksflyt med fire
saksbehandlingssteg og fire ulike visuelle identiteter - det er noe annet enn å velge
et bevis fra en nedtrekksliste. `apps/lommebok` er derfor uendret; denne appen kaller
den eneste over HTTP, gjennom `src/integrations/lommebokApi.ts`.

## Flyten (manuell navigering - se AdminNavigation øverst)

1. **Start**: velg en testperson med gyldig skole-politiattest i sandkassedataene
   (standard: `person-215`).
2. **Drammen kommune**: saksbehandler trykker «Utsted formålsbevis». Dette legger to
   nye meldinger fra kommunen i **Innboks**: én med formålsbeviset og én som ber
   søkeren vise fram politiattesten når den er klar.
3. **Innboks**: åpne meldingen med formålsbeviset og hent det med QR-koden (eller
   «Åpne i lommebok på denne enheten»). Naviger deretter manuelt til **Politiet**.
4. **Politiet**: trykk «Be om å få se formålsbekreftelsen», skann/simuler
   presentasjons-QR-koden med en fysisk lommebok. Går gjennom en eksplisitt akseptgate (riktig formål,
   riktig person) før den godkjennes. Deretter utsteder politiet politiattesten, som
   hentes med QR-koden på politiets side.
5. **Innboks**: åpne kommunens melding «Vi venter fortsatt på politiattesten din» og
   vis fram politiattesten med presentasjons-QR-koden.
6. **Drammen kommune**: naviger manuelt tilbake. Saksstatusen er oppdatert til
   «politiattest mottatt», og attesttype, formål, datoer og antall anmerkninger vises.

Utstedelse har alltid status «tilbud klart» i denne demoen - det finnes ingen måte å
bekrefte at lommeboken faktisk har hentet beviset før neste presentasjon lykkes.

## Testmiljø

Utstedelse og verifisering går mot to eksterne testtjenester
(`bevisgenerator.test.eidas2sandkasse.net` og
`verifier-service.test.eidas2sandkasse.net`) på samme måte som `apps/lommebok`.
Utstedelsesfeil vises som feil og lager aldri en QR-kode som ser ekte ut.
Presentasjon må fullføres manuelt med en fysisk lommebok.

## Kjøring

Del av `./start.sh` som `politiattest-flyt` på port 3003. Krever at `lommebok`
(port 3002) kjører - se `src/integrations/lommebokApi.ts` og `vite.config.ts` for
proxyen. Frittstående:

```bash
pnpm --filter @innbyggerdialog/politiattest-flyt dev
```

## Visuell stil

Ingen av sidene er pikselkopier. **Politiet**-siden låner fargespråk og struktur fra
politiet.no (mørkeblå header, myndighetsspråk). **Drammen kommune**-siden låner fra
drammen.kommune.no (saksbehandlerkort, journalkolonne). **Innboks** er en forenklet,
gjenkjennelig e-postkonto. Alt navn og innhold er syntetisk og markert som demo - se
`AGENTS.md` for hvorfor dette repoet ikke kopierer virkelige tjenester.
