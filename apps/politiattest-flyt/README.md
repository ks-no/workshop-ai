# Politiattest-flyt

Demo av digital lommebok-flyt for en skolejobbsøknad som krever politiattest. Bruker
den samme utstedelses- og verifiseringsmekanismen som [apps/lommebok](../lommebok),
men viser den fram som fire ulike systemer:

- **Drammen kommune** (saksbehandlingssystem) - slår opp hjemmelen formålet krever,
  utsteder formålsbekreftelse, sender en etterspørsel etter politiattesten, og viser
  den ferdig kontrollerte metadataen.
- **Politiet** - kontrollerer formålsbekreftelsen, utsteder politiattest.
- **Innboks** - en Digipost-inspirert visning av kommunens digitale post til
  søkeren, med QR-koder for å hente formålsbekreftelsen og vise fram politiattesten.
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
2. **Drammen kommune, steg 0**: saksbehandler skriver noen få ord om hva attesten skal
   brukes til («vikar i barnehage»), og velger hjemmelen i nedtrekket. Se
   [Steg 0: hjemmelen slås opp, den skrives ikke](#steg-0-hjemmelen-slås-opp-den-skrives-ikke).
3. **Drammen kommune, steg 1**: saksbehandler trykker «Utsted formålsbekreftelse». Dette legger to
   nye meldinger fra kommunen i **Innboks**: én med formålsbekreftelsen og én som ber
   søkeren vise fram politiattesten når den er klar.
4. **Innboks**: åpne meldingen med formålsbekreftelsen og hent den med QR-koden (eller
   «Åpne i lommebok på denne enheten»). Naviger deretter manuelt til **Politiet**.
5. **Politiet**: presentasjonsforespørselen opprettes automatisk. Skann QR-koden med
   en fysisk lommebok, eller åpne samme forespørsel i lommeboken på enheten. Den går
   gjennom en eksplisitt akseptgate (riktig formål, riktig person) før den godkjennes.
   Deretter utsteder politiet politiattesten, som hentes med QR-koden eller
   same-device-lenken på politiets side.
6. **Innboks**: åpne kommunens melding «Vi venter fortsatt på politiattesten din» og
   vis fram politiattesten med presentasjons-QR-koden.
7. **Drammen kommune**: naviger manuelt tilbake. Saksstatusen er oppdatert til
   «politiattest mottatt», og attesttype, formål, datoer og antall anmerkninger vises.

Utstedelse har alltid status «tilbud klart» i denne demoen - det finnes ingen måte å
bekrefte at lommeboken faktisk har hentet beviset før neste presentasjon lykkes.

## Steg 0: hjemmelen slås opp, den skrives ikke

Hjemmelen ender som en claim i formålsbeviset, og en lovhenvisning skrevet for hånd i
et tekstfelt er en lovhenvisning ingen har kontrollert. Derfor er steg 0 et oppslag mot
[apps/hjemmelsok](../hjemmelsok) (port 8089): saksbehandleren skriver noen få ord om
hva attesten skal brukes til, og velger en av radene i nedtrekket. Radene er politiets
egen formålsoversikt, ordrett - modellen der rangerer dem, den formulerer ingen
hjemmel.

Utstedelsesknappen i steg 1 er sperret til en hjemmel er valgt, og det valgte
grunnlaget står i tabellen over hva kommunen legger i beviset. Kortet låses når beviset
er utstedt: grunnlaget er da en del av et signert bevis og kan ikke byttes i etterkant.

Det er `rettslig_grunnlag` i beviset som følger valget - `formaal`, `attesttype` og
`hjemmel`. `rolle` og `ordning` følger fortsatt saken selv, fordi det er dem
akseptgaten på politiets side sammenligner mot personen, og et oppslag skal ikke kunne
flytte den kontrollen.

Svarer ikke hjemmelsok, sier kortet fra og tilbyr «Fortsett med hjemmelen fra
attesten». Da bærer valget `kilde: "attest"`, slik at det synes at ingen slo hjemmelen
opp. Tjenesten selv degraderer på egen hånd før det: uten `TELENOR_AI_FACTORY_API_KEY`
svarer den på ordsøket alene, og kortet viser merknaden som sier hvorfor.

## Testmiljø

Utstedelse og verifisering går mot to eksterne testtjenester
(`bevisgenerator.test.eidas2sandkasse.net` og
`verifier-service.test.eidas2sandkasse.net`) på samme måte som `apps/lommebok`.
Utstedelsesfeil vises som feil og lager aldri en QR-kode som ser ekte ut.
Presentasjon fullføres manuelt i lommeboken, enten ved å skanne QR-koden eller ved å
åpne deeplinken på samme enhet. Appen følger den ventende transaksjonen i originalfanen,
uten å be lommeboken åpne en returadresse i en ny nettleserfane.

## Kjøring

Del av `./start.sh` som `politiattest-flyt` på port 3003. Krever at `lommebok`
(port 3002) kjører - se `src/integrations/lommebokApi.ts` og `vite.config.ts` for
proxyen. `hjemmelsok` (port 8089) trengs for steg 0, men appen starter uten den og sier
fra i kortet i stedet. Frittstående:

```bash
pnpm --filter @innbyggerdialog/politiattest-flyt dev
```

## Visuell stil

Ingen av sidene er pikselkopier. **Politiet**-siden låner fargespråk og struktur fra
politiet.no (mørkeblå header, myndighetsspråk). **Drammen kommune**-siden låner fra
drammen.kommune.no (saksbehandlerkort, journalkolonne). **Innboks** er en forenklet,
Digipost-inspirert digital postkasse. Alt navn og innhold er syntetisk og markert som demo - se
`AGENTS.md` for hvorfor dette repoet ikke kopierer virkelige tjenester.
