# Sjekkliste: 10.–11. september 2026

Tid og sted er hentet fra arrangørens e-post: VilVite i Bergen, torsdag og fredag.
Detaljert program og lagorganisering må sjekkes mot siste beskjed fra arrangøren.

## Før reisen

- [ ] Kjør `npm ci`, alle tester og `npm run build` på maskinen som skal presentere.
- [ ] Start med `npm start`, prøv hele hovedflyten og avviket med 320 000 kr.
- [ ] Kontroller at demoen virker med internett frakoblet.
- [ ] Ha prosjektmappe, pitch, demoskript og SVG-diagram tilgjengelig lokalt.
- [ ] Ha skjermbilder som reserve, ladere og riktig skjermadapter.
- [ ] Hvis dere vil integrere: last ned arrangørens repo og start Docker på forhånd.
- [ ] Kjør arrangørens `./start.sh --mock`; åpne `http://localhost:3001`.
- [ ] Revider dagens kilder og eventuelle endringer i hackathon-repoet.

## Torsdag 10. september

- [ ] Avtal hvem som eier demo, datakilder/regler og pitch.
- [ ] La en fagperson kontrollere SFO-pris, gratisandel, husholdning og varig inntektsfall.
- [ ] Avklar hvilke testtilganger arrangøren faktisk tilbyr. Ingen produksjonsdata.
- [ ] Vurder én konkret sandbox-kobling hvis kontrakt og prisgrunnlag er avklart.
- [ ] Vis demoen til minst én person som ikke kjenner løsningen. Observer hvor de stopper.
- [ ] Avklar eventuell lommebokidé med Digdir; ikke legg den til bare for å vise flere teknologier.
- [ ] Ta en sikker kopi før større endringer. Kjør hovedflyten etter hver endring.

## Fredag 11. september

- [ ] Bekreft presentasjonstid og vurderingskriterier i siste program.
- [ ] Frys funksjonaliteten i god tid før presentasjonen.
- [ ] Kjør `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` og `npm run test:e2e`.
- [ ] Stopp utviklingsserveren og start produksjonsutgaven med `npm start`.
- [ ] Bruk «Vanlig sjekk», standardforklaringer og en ny, tom økt.
- [ ] Øv treminuttersversjonen én gang med faktiske klikk.
- [ ] Ha avvikseksempel og juryspørsmål klare for oppfølgingsdelen.
- [ ] Vis skillet mellom syntetiske data, kildeforankrede prinsipper og demoforutsetninger.

## Rett før dere går på

- [ ] Nettleseren viser forsiden på port 3210, riktig zoom og ingen åpne utviklerpaneler.
- [ ] Maskinen er koblet til strøm, varsler er dempet, skjermdeling er riktig.
- [ ] Første og siste setning sitter. Avtal hvem som klikker.
- [ ] Si tydelig: «Regler vurderer. KI forklarer. Innbyggeren har kontroll.»

## Etterpå

- [ ] Ta vare på spørsmål og observasjoner, ikke ekte personopplysninger.
- [ ] Avslutt og slett demoøkten. Slett nedlastede testkvitteringer ved behov.
- [ ] Stopp appen med Ctrl+C. Stopp arrangørens stack med `./start.sh -d` hvis dere startet den.
- [ ] Avtal pilotspørsmål og neste kontaktpunkt før eventuell videre utvikling.
