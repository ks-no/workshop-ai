# Innlevering

Det dere lager i forken skal inn i `ks-no/workshop-ai` når hackathonet er over, slik at
arbeidet overlever at forker slettes eller gjøres private. Dere trenger ikke lage en
pull request. **Vi henter det selv**, fra forken dere sier vi skal hente fra.

Dette tar fem minutter, og dere kan gjøre det når som helst før fristen.

## Innhold

- [Fristen](#fristen)
- [1. Alt skal ligge i forken](#1-alt-skal-ligge-i-forken)
- [2. Skriv INNLEVERING.md](#2-skriv-innleveringmd)
- [3. Registrer teamet](#3-registrer-teamet)
- [Tre ting dere ikke skal gjøre](#tre-ting-dere-ikke-skal-gjøre)
- [Hva som skjer etterpå](#hva-som-skjer-etterpå)
- [For arrangøren](#for-arrangøren)

## Fristen

**Fredag kl. 14:00 (norsk tid).** Alt som skal være med, skal være pushet til forken før det. Vi
henter én gang ved fristen, og én gang til etter demoene for team som pushet i siste
liten. Det som ikke er pushet, finnes ikke.

## 1. Alt skal ligge i forken

Koden dere leverer, skal være pushet til én branch i én fork på GitHub. `main` i forken
er det enkleste, men velg gjerne en annen branch så lenge dere sier hvilken i
registreringen.

Har dere en frontend eller noe annet i et **eget repo** utenfor forken, slik
[`docs/bygg-selv.md`](bygg-selv.md) anbefaler? Da må det repoet være offentlig, og stå
i registreringen. Vi henter det inn på samme måte.

## 2. Skriv INNLEVERING.md

Legg en fil som heter `INNLEVERING.md` i roten av forken. Den er det første en leser
ser, og den skal svare på det en kollega som ikke var i rommet, lurer på. Kopier malen
og fyll inn:

```markdown
# <Teamnavn>

**Medlemmer:** <GitHub-brukernavn, ett per person>

## Hva vi lagde

<Tre til fem linjer. Hvilket problem, for hvem, og hva som er nytt i forhold til
sandkassen slik den kom.>

## Slik kjører du det

<Kommandoene fra en fersk klon til noe som kjører. Hvilken testbruker, hvilken URL.>

## Andre repoer og lenker

<URL til frontend-repo, demo, skisser. Skriv «ingen» hvis alt er i forken.>

## Slik brukte vi KI

<Hvilke verktøy, til hva, og hva dere valgte å ikke la modellen gjøre. Se
CODE_OF_CONDUCT.md.>

## Det som ikke ble ferdig

<Det er lov. Skriv hva som mangler, så leseren ikke leter etter det.>
```

Den siste overskriften er ikke pynt. Et team som skriver «samtykkesteget er ikke koblet
på» har levert noe en leser kan bruke. Et team som lar leseren finne det selv, har ikke.

## 3. Registrer teamet

Én person i teamet åpner et issue i `ks-no/workshop-ai` med malen **«Innlevering»**:
<https://github.com/ks-no/workshop-ai/issues/new?template=innlevering.yml>

Malen spør om teamnavn, URL til forken, hvilken branch vi skal hente, og eventuelle andre
repoer. Ett issue per team. Bytter dere fork eller branch underveis, rediger issuet i
stedet for å lage et nytt.

Det er registreringen som avgjør hva vi henter. En fork uten issue blir ikke hentet.

## Tre ting dere ikke skal gjøre

- **Ikke åpne pull request mot `ks-no/workshop-ai`.** GitHub foreslår det når dere
  pusher til forken, og det er lett å trykke. Skjer det, gjør det ingen skade, men den
  blir lukket med en lenke hit. Finner dere en feil i sandkassen som andre team bør få
  rettet, meld fra i et issue.
- **Ikke commit tokens, nøkler eller `.env`-filer.** Det står i
  [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) alt, og gjelder like mye for det som
  hentes inn her. Alt vi henter, blir liggende i et offentlig repo.
- **Ikke commit store genererte datafiler.** Et datasett på flere megabyte blir en
  permanent del av historikken til et repo alle team kloner. Skriv heller i
  `INNLEVERING.md` hvordan filen lages, eller legg den et annet sted og lenk.

## Hva som skjer etterpå

Ved fristen kjører arrangøren et skript som henter branchen fra hver registrert fork og
pusher den inn i `ks-no/workshop-ai` som `team/<slug>`. Slug er teamnavnet med små
bokstaver, bindestrek i stedet for mellomrom og tegn, og æ/ø/å skrevet ae/oe/aa. Et
innledende «Team» faller bort: «Team Bergen» blir `team/bergen`, «Lag Ålesund» blir
`team/lag-aalesund`. Et ekstra repo blir `team/<slug>-<reponavn>`.

Diffen mot sandkassen slik den kom, ser dere så her, med sluggen deres på slutten:
`https://github.com/ks-no/workshop-ai/compare/main...team/<slug>`

Forken kan bli stående, og dere kan jobbe videre i den. Det vi hentet, ligger trygt
uansett.

## For arrangøren

Deltakerne trenger ikke lese videre.

Skriptet er `scripts/hent-innleveringer.ts`, og det krever `git` med push-tilgang til
`origin` og `gh` som er logget inn.

```bash
pnpm innlevering:hent --ikke-push     # dryrun: hent og rapporter, push ingenting
pnpm innlevering:hent                 # registreringene fra issues med label «innlevering»
pnpm innlevering:hent --alle-forker   # sikkerhetsnett: hver fork med commits foran main, som fork/<eier>
pnpm innlevering:hent --liste fil.json  # registreringene fra en fil i stedet for issues
```

Skriptet leser issue-skjemaet i `.github/ISSUE_TEMPLATE/innlevering.yml`, henter hver
kilde til en lokal ref under `refs/innleveringer/`, og pusher den med `+` til
`team/<slug>` i `origin`. Force er riktig: branchene er våre, og en ny kjøring skal
overskrive forrige. Rapporten på slutten sier per team hvor mange commits kilden ligger
foran `main`, om `INNLEVERING.md` finnes, og hvilke filer som er over 5 MB. Begge de
siste er advarsler og stopper ingenting: vi vil ha koden uansett. En registrering som
ikke lar seg hente, en feil URL, en branch som ikke finnes eller en fork som er gjort
privat, står under «Feilet» og stopper heller ikke de andre. Det eneste som stopper
kjøringen før første fetch, er to team hvis navn gir samme slug, fordi den siste pushen
ellers hadde skrevet over den første i stillhet.

Kjøreplan:

1. **Dag 1, når denne siden er merget:** si det fra scenen, og legg lenken til siden
   og til nytt issue i chatten. Opprett labelen først, ellers setter ikke skjemaet
   den: `gh label create innlevering --color 0E8A16 --description "Registrering av team-fork"`.
2. **Dag 1, kveld:** `pnpm innlevering:hent --alle-forker` som sikkerhetskopi, før
   registreringene er inne.
3. **Fredag ved fristen:** `pnpm innlevering:hent`. Les rapporten, og purr team som
   mangler `INNLEVERING.md` før demoene. Kjør én gang til etter demoene.
4. **PR-er som likevel kommer mot `main`:** lukk med en kommentar som peker hit. Vil
   teamet ha PR-en merget i sin branch, går det også:
   `gh pr edit <nr> --base team/<slug>` og merge. Men husk at neste kjøring pusher med
   `+` og erstatter `team/<slug>` med det som ligger i forken. Ligger ikke merge-commiten
   i forken, er den borte. Gjør derfor slike merger etter siste kjøring, eller be teamet
   pushe det samme til forken.
5. **Valgfritt etterpå:** tagg hver team-branch, eller flytt dem til et eget
   arkivrepo. Ingenting av det trengs nå.
