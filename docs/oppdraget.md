# Oppdraget

Sandkassen er en kommune i miniatyr: innbyggere med familie og bosted, inntekter og
eiendom, satser og regelverk, samtykke, hjemmel og revisjonslogg — alt syntetisk, alt
åpent for deg gjennom dokumenterte API-er.

**Oppgaven er å lage noe som er nyttig for innbyggerne i den kommunen.**

Det er hele føringen. Resten er ditt.

## Hva som er gitt

Under deg ligger et lag du ikke trenger å bygge:

- syntetiske data som henger sammen — en person har en husstand, husstanden har en
  inntekt, inntekten avgjør et vedtak
- samtykke som faktisk sperrer, og hjemmel som faktisk avviser
- deterministiske regler, atskilt fra språkmodellen med vilje
- revisjonslogg over all datatilgang
- et KI-lag med sperrer i kode, og et spor som viser deg hva modellen faktisk fikk

Alt dette svarer over HTTP, og `docs/bygg-selv.md` viser hvordan du kobler deg på.

## Hva som er ditt

Alt over det laget. Hvem du lager det for, hvilket problem du tar tak i, hva slags
grensesnitt det får, hvilken teknologi du bruker, og om du i det hele tatt bruker
KI-laget.

Du står også fritt til å endre sandkassen der den er i veien. Prosessmotoren er lineær
fordi det var det enkleste utgangspunktet, ikke fordi det er riktig. Er den feil for
det du vil lage, la den være — eller bytt den ut.

## Én ting det er verdt å vite om demoene

Sandkassen kommer med en chat, en agent og en stegvis klient. De ser ut som et svar på
hva man skal bygge. **Det er de ikke.** De ble laget fordi en dialog var den raskeste
måten å ta i bruk alle API-ene på samtidig, og de står der som referanse for hvordan
kallene henger sammen.

En innbygger som skal søke om redusert foreldrebetaling, trenger ikke nødvendigvis å
skrive med noen for å få det til. Hva hun faktisk trenger, er et åpent spørsmål — og
det er det spørsmålet som er verdt to dager.

## Praktisk

- `docs/deltakerstart.md` — kjør sandkassen, første API-kall, feilsøking
- `docs/bygg-selv.md` — egen frontend, egne tjenester, hva som er frosset
- <http://localhost:3001> — oversikt over hva som kjører
- <http://localhost:3001/utforsker> — alle endepunktene, med et `curl` som virker
