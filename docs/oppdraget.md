# Oppdraget

Sandkassen er en kommune i miniatyr: innbyggere med familie og bosted, inntekter,
eiendom og helseopplysninger, satser og regelverk, samtykke, hjemmel og revisjonslogg -
alt syntetisk, alt åpent for deg gjennom dokumenterte API-er.

**Oppgaven er å lage noe som er nyttig for innbyggerne i den kommunen.**

Det er hele føringen. Resten er ditt.

> [!NOTE]
> **Denne siden er hva og hvorfor.** Skal du få sandkassen til å kjøre, er
> [`docs/deltakerstart.md`](deltakerstart.md) neste side, og
> [`docs/README.md`](README.md) er kartet over resten av dokumentasjonen.

## To spørsmål hackathonet stiller

Det er to spørsmål arrangøren er nysgjerrig på, og de forklarer hvorfor sandkassen ser
ut som den gjør.

**Må en kommunal tjeneste begynne med et skjema?** Skjemaet er kjent og ofte nødvendig,
men det legger arbeidet hos den som har minst oversikt. Her ligger data, samtykke og
regler åpent over API - så en tjeneste kan i prinsippet begynne et helt annet sted enn i
et tomt felt.

**Hvordan brukes KI på en måte offentlig sektor kan stå inne for?** Sporbart,
etterprøvbart, trygt nok. Sandkassen har et forsøk på svar: regelen utenfor modellen,
sperrer i kode, spor av hvert modellkall. Det er et forsøk, ikke en fasit. Bygg videre
på det, eller vis at det burde gjøres annerledes.

## Hva som er gitt

Under deg ligger et lag du ikke trenger å bygge:

- syntetiske data som henger sammen - en person har en husstand, husstanden har en
  inntekt, inntekten avgjør et vedtak
- samtykke som faktisk sperrer, og hjemmel som faktisk avviser
- deterministiske regler, atskilt fra språkmodellen med vilje
- revisjonslogg over all datatilgang
- et KI-lag med sperrer i kode, og et spor som viser deg hva modellen faktisk fikk
- seks caser, fra barnehageplass til TT-kort. Den siste henter en legeerklæring,
  og den ligger bak et uttrykkelig samtykke, fordi helseopplysninger er en særlig
  kategori etter personvernforordningen artikkel 9

Det er et gulv å stå på, ikke et tak. Alt sammen er kode og data i forken din, og du kan
endre hvert punkt over hvis det er feil for det du lager.

Alt dette svarer over HTTP, og [`docs/bygg-selv.md`](bygg-selv.md) viser hvordan du
kobler deg på.

## Hva som er ditt

Alt over det laget. Hvem du lager det for, hvilket problem du tar tak i, hva slags
grensesnitt det får, og hvilken teknologi du bruker.

Og sandkassen selv. Du jobber i din egen fork, så du trenger ikke vente på noen: finner
du en feil, fiks den, og meld gjerne fra om den, så får de andre teamene fiksen også.
Mangler det et felt du trenger, legg det til. Er en regel gal, rett den.
Prosessmotoren er lineær fordi det var det enkleste utgangspunktet, ikke fordi det er
riktig - er den feil for det du vil lage, bytt den ut.

Sjekkene sier fra hvis noe ryker, og de trenger verken språkmodell eller kjørende
stack - [`docs/bygg-selv.md`](bygg-selv.md) har listen. Det eneste som er verdt å la
stå, er navnene utad: feltnavn i JSON-svarene og stiene i URL-ene er kontrakten de andre
teamene leser deg gjennom. Samme fil forklarer hvorfor, under «Ting du ikke skal døpe
om».

## Bruk av KI utviklingsverktøy
Dette er en KI-workshop, vi oppfordrer til bruk av ki-verktøy. Mangler du tilgang på KI verktøy så send en forespørsel til [bard.saari@ksdigital.no](mailto:baard.saari@ksdigital.no)

## Én ting det er verdt å vite om demoene

Sandkassen kommer med en chat, en agent og en stegvis klient. De ser ut som et svar på
hva man skal bygge. **Det er de ikke.** De ble laget fordi en dialog var den raskeste
måten å ta i bruk alle API-ene på samtidig, og de står der som referanse for hvordan
kallene henger sammen.

En innbygger som skal søke om redusert foreldrebetaling, trenger ikke nødvendigvis å
skrive med noen for å få det til. Hva hun faktisk trenger, er et åpent spørsmål - og
det er det spørsmålet som er verdt to dager.

## Hva som premieres

Tre priser deles ut fredag:

- **Hackathonprisen 2026** - beste tekniske konsept. Vandrepokal.
- **Kunstigprisen** - mest innovative bruk av KI.
- **Innbyggerprisen** - mest innbyggervennlige løsning.

Hvert team har 15 minutter fredag formiddag. Målet er at alle demonstrerer noe som
kjører. Det er ikke det samme som at alt er ferdig.

## Utenfor sandkassen

Sandkassen etterligner ekte tjenester. Vil du vite hva originalene faktisk kan, eller
lete etter data vi ikke har tenkt på:

- <https://data.norge.no/> - Felles datakatalog: datasett, API-er, begreper og
  informasjonsmodeller fra hele offentlig sektor
- <https://docs.digdir.no/> - ID-porten og Maskinporten, som `digdir-mock` etterligner.
  Samme sted ligger dokumentasjonen for Digital lommebok
- <https://developers.fiks.ks.no/> - KS Fiks, som `fiks-simulator` etterligner:
  registeroppslag, kontaktregisteret og SvarUt
- <https://www.geonorge.no/> - Kartverkets katalog over kart- og eiendomsdata.
  Adressene i `matrikkel-mock` kommer herfra
- <https://utviklerportal.nhn.no/> - Norsk helsenett, der HelseID og de ekte
  helsetjenestene ligger. Les avsnittet under før du leter der

Én av mockene etterligner ingenting. **`pasientjournal-mock` finnes ikke i
virkeligheten.** Det er ingen nasjonal dør inn til en legeerklæring: journalen eies av
virksomheten som ga helsehjelpen, og det som finnes ligger bak Helsenettet og HelseID,
ikke Maskinporten. I dag bærer innbyggeren en stemplet PDF.
[`apps/pasientjournal-mock/README.md`](../apps/pasientjournal-mock/README.md) forklarer
hvorfor mocken likevel er der. Leter du etter det API-et: det er ikke der.

Vil du bytte ut prosessmotoren med en ekte en, har [`docs/bygg-selv.md`](bygg-selv.md)
et avsnitt om Altinn Studio.

Kildene bak selve dataene i sandkassen - Folkeregisterets informasjonsmodell,
Fiks-beregningen, Geonorge - står i [`docs/syntetiske-data.md`](syntetiske-data.md),
under «Spec-forankring».

## Praktisk

- [`docs/deltakerstart.md`](deltakerstart.md) - kjør sandkassen, første API-kall, feilsøking
- [`docs/bygg-selv.md`](bygg-selv.md) - egen frontend, egne tjenester, hva som er frosset
- <http://localhost:3001> - oversikt over hva som kjører
- <http://localhost:3001/utforsker> - alle endepunktene, med et `curl` som virker
