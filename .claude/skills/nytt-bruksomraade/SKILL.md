---
name: nytt-bruksomraade
description: Bruk denne når noe nytt skal lages i eller ved siden av sandkassen, enten en ny case, en ny tjeneste eller en ny frontend, og det ikke er avgjort hva det skal være. Sørger for at ideen blir undersøkt før den blir kode, i stedet for at en eksisterende case blir kopiert med nye navn. Bruk også når noen spør «hva kan vi bygge», «hvor begynner vi», eller ber om forslag til hackathonoppgave.
---

# Nytt bruksområde

**Ikke skriv kode i denne runden.** Er det ikke avgjort hva som skal bygges, er jobben
å undersøke det sammen med deltakeren først.

Grunnen er at det finnes et sug i dette repoet. `docs/prosessmodell.md` sier «kopier
`mal-enkel-soknad`», `docs/bygg-selv.md` sier «kopier en eksisterende» tjeneste, og
hver demo-case går samme vei: `INFO` → `DATA_FETCH` → `CONSENT_REQUEST` →
`DATA_FETCH` → `SJEKK` → `SUMMARY` → `SUBMIT`. Det er oppskrifter for rørleggingen,
ikke en mal for ideen. `docs/oppdraget.md` sier det samme til deltakeren: demoklientene
ser ut som et svar på hva man skal bygge, og det er de ikke.

Har deltakeren alt bestemt seg, si at du hopper over dette, og bygg. Regelen er mot å
bygge standardvalget uten å ha sett på det, ikke mot å bygge.

## Fremgangsmåten

1. **Se på hva sandkassen faktisk har.** `docs/oppdraget.md` for oppgaven,
   `docs/prosessmodell.md` for demo-casene, `docs/api-oversikt.md` og
   `openapi/*.yaml` for hva som svarer over HTTP, `docs/testpersoner.md` for hvem
   som finnes. Let etter det som ikke er brukt ennå, ikke bare etter det nærmeste
   eksempelet.
2. **Still ett spørsmål om gangen.** Ikke en liste. Spør om hvem det er for og hva
   som er vondt i dag, ikke om stegtyper og endepunkter. Fortsett til du kan si hva
   ideen er i én setning som nevner en person og et problem.
3. **Legg fram tre retninger som er ekte forskjellige.** Bruk aksene under. Si hva
   hver av dem gjør bra og hva den koster.
4. **La deltakeren velge.** Skriv det valgte ned kort: hvem, hva, hvilke API-er,
   og hva som er ute av scope. Få det bekreftet.
5. **Så bygger du.** Da gjelder resten av repoets regler, inkludert `AGENTS.md`.

## Aksene retningene må skille seg på

Tre alternativer som gir samme prosessdefinisjon med ulike ledetekster, er ett
alternativ. Minst én av disse må være ulik:

- **Hvem tar initiativet.** Alt her venter på at innbyggeren spør.
  `politiattest-oppdrag` snur det: innbyggeren gir kommunen noe. En tredje mulighet
  er at kommunen sier fra først: dataene holder til å se hvem som har rett på noe
  uten at de har søkt.
- **Om det er et skjema i det hele tatt.** Spørsmålet `docs/oppdraget.md` stiller.
  Et skjema legger arbeidet hos den som har minst oversikt.
- **Hvor opplysningen kommer fra.** Oppslag bak samtykke er det eneste som finnes i
  dag. Alternativet er et bevis innbyggeren viser fram fra den digitale lommeboken -
  attesten fra `politiattest-mock` bærer alt en `bevis`-blokk for nettopp det.
- **Hva utfallet er.** Ja eller nei er standard. `politiattest-oppdrag` har en tredje:
  et menneske vurderer. Og et utfall trenger ikke være et vedtak. Det kan være en
  oversikt, en påminnelse eller et svar på et spørsmål.
- **Hvem det er for.** Alt i dag er for søkeren selv, men `handleevne.ts` finnes
  fordi noen handler på andres vegne.
- **Hva grensesnittet er.** Chat, agent og stegvis er tre måter å gjøre det samme på.
  Kart, kalender, varsel, brev og telefon er ikke prøvd, og «ingenting å fylle ut»
  er også et grensesnitt.

## Aldri

1. **Aldri start med å åpne `data/prosessdefinisjoner.json`.** Da er formen valgt før
   problemet er det, og resten blir utfylling.
2. **Aldri gjør «lik en eksisterende case» til et argument for noe.** At noe likner
   `redusert-foreldrebetaling-barnehage` sier ingenting om at det er riktig.
3. **Aldri lever tre alternativer der to er pynt.** Da er det ett alternativ og en
   ferdig konklusjon.
4. **Aldri anta at motoren er grensen.** Den er lineær fordi det var det enkleste
   utgangspunktet. `docs/oppdraget.md` sier rett ut at den kan byttes ut.

## Husk

Noe skal gjenbrukes, og det er ikke formen. Feltnavn i JSON og stier i URL-ene er
kontrakten de andre teamene leser løsningen gjennom. Samtykkeporten
skal fortsatt sperre, regelen skal fortsatt ligge utenfor modellen, og datatilgang
skal fortsatt havne i revisjonsloggen. Det er gulvet. Stegrekkefølgen, antall steg,
chattevinduet og «alt er en søknad» er ikke.
