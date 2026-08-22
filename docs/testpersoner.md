<!-- GENERERT AV scripts/importer-tenor.js. Ikke rediger for hånd. -->
# Testpersoner

Hele befolkningen i sandkassen, generert fra `data/personer.json`. `pnpm test` feiler hvis denne fila er ute av takt med dataene, så tallene her er alltid de som faktisk gjelder.

## Hvor mange, og hvem kan hva

| | Antall |
|---|---:|
| Personer i registeret | 394 |
| Bosatte — kan være part i en sak | 369 |
| Kan ha elektronisk ID (13 år eller mer, bosatt) | 304 |
| Kan opptre på egen hånd (18 år eller mer, bosatt) | 282 |
| Mindreårige — part i saken, men foresatt må være avsender | 87 |
| Under 13 — kan aldri logge inn, ingen eID finnes | 65 |
| 67 år eller mer | 60 |
| Ikke bosatt (død, utflyttet, inaktiv, midlertidig) | 25 |
| Med adressebeskyttelse | 6 |
| Med inntektsopplysninger | 280 |
| Med registrert eiendom | 219 |

Aldrene er regnet ved `satser.gjelderFra`, ikke ved dagens dato — samme referansedato som reglene bruker, så en testperson gir samme utfall uansett når demoen kjøres.

### Personstatus

| Status | Antall | Hva det betyr her |
|---|---:|---|
| BOSATT | 369 | Bor i en norsk kommune. Har husstand, adresse og kan være part i en sak. |
| INAKTIV | 16 | Nesten alle disse har D-nummer, ikke fødselsnummer, og ingen norsk bostedsadresse. |
| DOED | 6 | Registrert død. Kan ikke logge inn eller være avsender, men relasjonene står — et barn har fortsatt en mor. |
| UTFLYTTET | 2 | Flyttet ut av Norge. Ingen husstand, ingen kommune å ha dialog med. |
| MIDLERTIDIG | 1 | Midlertidig identifikator. Samme som over. |

## Alle personene

`Logg inn`: **ja** betyr at en elektronisk ID kan finnes. **part** betyr 13–17 år — kan logge inn, men en foresatt med foreldreansvar må være avsender. **nei** betyr at ingen eID kan finnes.

| personId | Navn | Alder | Status | Husstand | Rolle | Kommune | Logg inn | Eier | Inntekt | Plass | Kilde |
|---|---|---:|---|---|---|---|---|---|---|---|---|
| `person-001` | Maja Solberg | 38 | BOSATT | household-001 (ENSLIG_FORSORGER) | foresatt | Bergen | ja | ja | ja | — | kuratert |
| `person-002` | Ella Solberg | 4 | BOSATT | household-001 (ENSLIG_FORSORGER) | barn | Bergen | nei | — | — | barnehage | kuratert |
| `person-003` | Jonas Nilsen | 41 | BOSATT | household-002 (EKTEPAR) | foresatt | Trondheim | ja | ja | ja | — | kuratert |
| `person-004` | Petter Nilsen | 41 | BOSATT | household-002 (EKTEPAR) | foresatt | Trondheim | ja | ja | ja | — | kuratert |
| `person-005` | Leah Nilsen | 3 | BOSATT | household-002 (EKTEPAR) | barn | Trondheim | nei | — | — | barnehage | kuratert |
| `person-006` | Amir Hassan | 33 | BOSATT | household-003 (ENSLIG_FORSORGER) | foresatt | Oslo | ja | ja | ja | — | kuratert |
| `person-007` | Sara Hassan | 1 | BOSATT | household-003 (ENSLIG_FORSORGER) | barn | Oslo | nei | — | — | barnehage | kuratert |
| `person-008` | Ingrid Dahl | 39 | BOSATT | household-004 (SAMBOERE) | foresatt | Stavanger | ja | ja | ja | — | kuratert |
| `person-009` | Marius Dahl | 39 | BOSATT | household-004 (SAMBOERE) | foresatt | Stavanger | ja | ja | ja | — | kuratert |
| `person-010` | Noah Dahl | 4 | BOSATT | household-004 (SAMBOERE) | barn | Stavanger | nei | — | — | barnehage | kuratert |
| `person-011` | Iben Dahl | 7 | BOSATT | household-004 (SAMBOERE) | barn | Stavanger | nei | — | — | sfo, fritid | kuratert |
| `person-012` | Kari Johansen | 35 | BOSATT | household-005 (ENSLIG_FORSORGER) | foresatt | Drammen | ja | ja | ja | — | kuratert |
| `person-013` | Mikkel Johansen | 3 | BOSATT | household-005 (ENSLIG_FORSORGER) | barn | Drammen | nei | — | — | barnehage | kuratert |
| `person-014` | Lina Berg | 35 | BOSATT | household-006 (ENSLIG_FORSORGER) | foresatt | Tromsø | ja | ja | ja | — | kuratert |
| `person-015` | Oskar Berg | 3 | BOSATT | household-006 (ENSLIG_FORSORGER) | barn | Tromsø | nei | — | — | barnehage | kuratert |
| `person-016` | Henrik Lie | 43 | BOSATT | household-007 (EKTEPAR) | foresatt | Kristiansand | ja | ja | ja | — | kuratert |
| `person-017` | Tone Lie | 41 | BOSATT | household-007 (EKTEPAR) | foresatt | Kristiansand | ja | ja | ja | — | kuratert |
| `person-018` | Selma Lie | 4 | BOSATT | household-007 (EKTEPAR) | barn | Kristiansand | nei | — | — | barnehage | kuratert |
| `person-019` | Thomas Nguyen | 37 | BOSATT | household-008 (SAMBOERE) | foresatt | Bodø | ja | ja | ja | — | kuratert |
| `person-020` | Ida Nguyen | 36 | BOSATT | household-008 (SAMBOERE) | foresatt | Bodø | ja | ja | ja | — | kuratert |
| `person-021` | Mina Nguyen | 2 | BOSATT | household-008 (SAMBOERE) | barn | Bodø | nei | — | — | barnehage | kuratert |
| `person-022` | Fatima Ali | 32 | BOSATT | household-009 (ENSLIG_FORSORGER) | foresatt | Ålesund | ja | ja | ja | — | kuratert |
| `person-023` | Yusuf Ali | 4 | BOSATT | household-009 (ENSLIG_FORSORGER) | barn | Ålesund | nei | — | — | barnehage | kuratert |
| `person-024` | Sofie Eide | 40 | BOSATT | household-010 (ENSLIG_FORSORGER) | foresatt | Sandnes | ja | ja | ja | — | kuratert |
| `person-025` | Emil Eide | 2 | BOSATT | household-010 (ENSLIG_FORSORGER) | barn | Sandnes | nei | — | — | barnehage | kuratert |
| `person-026` | Randi Ås | 31 | BOSATT | household-011 (ENSLIG_FORSORGER) | foresatt | Bergen | ja | ja | ja | — | kuratert |
| `person-027` | Theo Ås | 6 | BOSATT | household-011 (ENSLIG_FORSORGER) | barn | Bergen | nei | — | — | sfo, fritid | kuratert |
| `person-028` | Nora Fjeld | 36 | BOSATT | household-012 (ENSLIG_FORSORGER) | foresatt | Trondheim | ja | ja | ja | — | kuratert |
| `person-029` | Jakob Fjeld | 6 | BOSATT | household-012 (ENSLIG_FORSORGER) | barn | Trondheim | nei | — | — | sfo, fritid | kuratert |
| `person-030` | Olav Rustad | 44 | BOSATT | household-013 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | kuratert |
| `person-031` | Skjermet person | 43 | BOSATT | household-013 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | kuratert |
| `person-032` | Live Rustad | 8 | BOSATT | household-013 (EKTEPAR) | barn | Oslo | nei | — | — | sfo, fritid | kuratert |
| `person-033` | Bjørn Haugen | 46 | BOSATT | household-014 (ENSLIG_FORSORGER) | foresatt | Stavanger | ja | ja | ja | — | kuratert |
| `person-034` | Aksel Haugen | 8 | BOSATT | household-014 (ENSLIG_FORSORGER) | barn | Stavanger | nei | — | — | sfo, fritid | kuratert |
| `person-035` | Even Moen | 42 | BOSATT | household-015 (SAMBOERE) | foresatt | Stavanger | ja | ja | ja | — | kuratert |
| `person-036` | Hilde Moen | 40 | BOSATT | household-015 (SAMBOERE) | foresatt | Stavanger | ja | ja | ja | — | kuratert |
| `person-037` | Vilde Moen | 3 | BOSATT | household-015 (SAMBOERE) | barn | Stavanger | nei | — | — | barnehage | kuratert |
| `person-038` | Mona Strand | 35 | BOSATT | household-016 (ENSLIG_FORSORGER) | foresatt | Nordre Follo | ja | ja | — | — | kuratert |
| `person-039` | Filip Strand | 3 | BOSATT | household-016 (ENSLIG_FORSORGER) | barn | Nordre Follo | nei | — | — | barnehage | kuratert |
| `person-040` | Yara Osman | 36 | BOSATT | household-017 (ENSLIG_FORSORGER) | foresatt | Bergen | ja | ja | ja | — | kuratert |
| `person-041` | Adam Osman | 5 | BOSATT | household-017 (ENSLIG_FORSORGER) | barn | Bergen | nei | — | — | barnehage | kuratert |
| `person-042` | Erik Sandvik | 51 | BOSATT | household-018 (PAR_UTEN_BARN) | foresatt | Oslo | ja | ja | ja | — | kuratert |
| `person-043` | Anne Sandvik | 48 | BOSATT | household-018 (PAR_UTEN_BARN) | foresatt | Oslo | ja | ja | ja | — | kuratert |
| `person-044` | Sverre Dahl | 9 | BOSATT | household-004 (SAMBOERE) | barn | Stavanger | nei | — | — | sfo, fritid | kuratert |
| `person-045` | Vilja Berg | 1 | BOSATT | household-006 (ENSLIG_FORSORGER) | barn | Tromsø | nei | — | — | barnehage | kuratert |
| `person-046` | Omar Ali | 7 | BOSATT | household-009 (ENSLIG_FORSORGER) | barn | Ålesund | nei | — | — | sfo, fritid | kuratert |
| `person-047` | Amalie Eide | 6 | BOSATT | household-010 (ENSLIG_FORSORGER) | barn | Sandnes | nei | — | — | sfo, fritid | kuratert |
| `person-048` | Håkon Fjeld | 7 | BOSATT | household-012 (ENSLIG_FORSORGER) | barn | Trondheim | nei | — | — | sfo, fritid | kuratert |
| `person-049` | Frida Rustad | 6 | BOSATT | household-013 (EKTEPAR) | barn | Oslo | nei | — | — | sfo, fritid | kuratert |
| `person-050` | Iver Haugen | 1 | BOSATT | household-014 (ENSLIG_FORSORGER) | barn | Stavanger | nei | — | — | barnehage | kuratert |
| `person-051` | Solveig Moen | 9 | BOSATT | household-015 (SAMBOERE) | barn | Stavanger | nei | — | — | sfo, fritid | kuratert |
| `person-052` | Oppklarende Larve | 112 | BOSATT | household-019 (ENSLIG) | foresatt | Tjøtta | ja | ja | ja | — | tenor |
| `person-053` | Horisontal Glede | 61 | BOSATT | household-020 (ENSLIG) | foresatt | Moss | ja | ja | ja | — | tenor |
| `person-054` | Effektiv Bagatell | 53 | BOSATT | household-021 (EKTEPAR) | foresatt | Jaren | ja | ja | ja | — | tenor |
| `person-055` | Viljesterk Klovn | 4 | BOSATT | household-021 (EKTEPAR) | barn | Jaren | nei | — | — | — | tenor |
| `person-056` | Sitrongul Kaiman | 51 | BOSATT | household-021 (EKTEPAR) | foresatt | Jaren | ja | ja | ja | — | tenor |
| `person-057` | Vissen Gladiator | 9 | BOSATT | household-022 (EKTEPAR) | barn | Tverrelvdalen | nei | — | — | fritid | tenor |
| `person-058` | Justerbar Spasertur | 34 | BOSATT | household-022 (EKTEPAR) | foresatt | Tverrelvdalen | ja | ja | ja | — | tenor |
| `person-059` | Talefør Kvinne | 33 | BOSATT | household-022 (EKTEPAR) | foresatt | Tverrelvdalen | ja | ja | ja | — | tenor |
| `person-060` | Nonfigurativ Dagbok | 85 | BOSATT | household-023 (PAR_UTEN_BARN) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-061` | Rolig Historie | 81 | BOSATT | household-023 (PAR_UTEN_BARN) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-062` | Ufølsom Kunngjøring | 49 | BOSATT | household-024 (ENSLIG) | foresatt | Kongsberg | ja | ja | ja | — | tenor |
| `person-063` | Ubestikkelig Struktur | 42 | BOSATT | household-025 (EKTEPAR) | foresatt | Hustadvika | ja | ja | ja | — | tenor |
| `person-064` | Motløs Frase | 17 | BOSATT | household-025 (EKTEPAR) | barn | Hustadvika | part | — | — | fritid | tenor |
| `person-065` | Skamfull Munn | 44 | BOSATT | household-025 (EKTEPAR) | foresatt | Hustadvika | ja | ja | ja | — | tenor |
| `person-066` | Uttrykksfull Pizza | 39 | BOSATT | household-026 (EKTEPAR) | foresatt | Storslett | ja | ja | ja | — | tenor |
| `person-067` | Historisk Enkemann | 37 | BOSATT | household-026 (EKTEPAR) | foresatt | Storslett | ja | ja | ja | — | tenor |
| `person-068` | Beskjeden Grav | 11 | BOSATT | household-026 (EKTEPAR) | barn | Storslett | nei | — | — | fritid | tenor |
| `person-069` | Samlet Grønnfink | 32 | BOSATT | household-027 (EKTEPAR) | foresatt | Sortland | ja | ja | ja | — | tenor |
| `person-070` | Morsk Storskjerm | 34 | BOSATT | household-027 (EKTEPAR) | foresatt | Sortland | ja | ja | ja | — | tenor |
| `person-071` | Tørr Vulkan | 6 | BOSATT | household-027 (EKTEPAR) | barn | Sortland | nei | — | — | — | tenor |
| `person-072` | Positiv Kentaur | 17 | BOSATT | household-028 (EKTEPAR) | barn | Oslo | part | — | — | fritid | tenor |
| `person-073` | Hevngjerrig Dessert | 50 | BOSATT | household-028 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-074` | Stolt Kos | 52 | BOSATT | household-028 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-075` | Gjensidig Bukse | 55 | BOSATT | household-029 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-076` | Fysisk Igle | 41 | BOSATT | household-030 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-077` | Hyggelig Avstand | 8 | BOSATT | household-030 (EKTEPAR) | barn | Oslo | nei | — | — | fritid | tenor |
| `person-078` | Utholden Katapult | 43 | BOSATT | household-030 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-079` | Direkte Kamel | 10 | BOSATT | household-031 (EKTEPAR) | barn | Tromsø | nei | — | — | fritid | tenor |
| `person-080` | Ivrig Budeie | 34 | BOSATT | household-031 (EKTEPAR) | foresatt | Tromsø | ja | ja | ja | — | tenor |
| `person-081` | Taus Galakse | 32 | BOSATT | household-031 (EKTEPAR) | foresatt | Tromsø | ja | ja | ja | — | tenor |
| `person-082` | Usjenert Forklaring | 80 | BOSATT | household-032 (ENSLIG) | foresatt | Drammen | ja | ja | ja | — | tenor |
| `person-083` | Talefør Universitet | 1 | BOSATT | household-033 (ENSLIG_FORSORGER) | barn | Vågan | nei | — | — | — | tenor |
| `person-084` | Forskjellig Bøtte | 20 | BOSATT | household-033 (ENSLIG_FORSORGER) | foresatt | Vågan | ja | — | ja | — | tenor |
| `person-085` | Underfundig Plate | 57 | BOSATT | household-034 (ENSLIG) | foresatt | Tårstad | ja | ja | ja | — | tenor |
| `person-086` | Refleksiv Jobb | 50 | BOSATT | household-035 (VOKSNE_SAMMEN) | foresatt | Stjørdal | ja | — | ja | — | tenor |
| `person-087` | Søt Sans | 47 | BOSATT | household-035 (VOKSNE_SAMMEN) | foresatt | Stjørdal | ja | — | ja | — | tenor |
| `person-088` | Gretten Kål | 21 | BOSATT | household-035 (VOKSNE_SAMMEN) | foresatt | Stjørdal | ja | — | ja | — | tenor |
| `person-089` | Nervøs Suppe | 102 | BOSATT | household-036 (ENSLIG) | foresatt | Porsgrunn | ja | ja | ja | — | tenor |
| `person-090` | Positiv Produksjon | 67 | BOSATT | household-037 (ENSLIG) | foresatt | Lundegrend | ja | ja | ja | — | tenor |
| `person-091` | Possessiv Gardin | 38 | BOSATT | household-038 (EKTEPAR) | foresatt | Bærum | ja | — | ja | — | tenor |
| `person-092` | Kvart Måke | 38 | BOSATT | household-038 (EKTEPAR) | foresatt | Bærum | ja | — | ja | — | tenor |
| `person-093` | Grunn Karaffel | 11 | BOSATT | household-038 (EKTEPAR) | barn | Bærum | nei | — | — | fritid | tenor |
| `person-094` | Grei Ordbok | 23 | BOSATT | household-039 (ENSLIG) | foresatt | Øverbygd | ja | ja | ja | — | tenor |
| `person-095` | Påpasselig Klaustrofobi | 75 | BOSATT | household-040 (ENSLIG) | foresatt | Tønsberg | ja | ja | ja | — | tenor |
| `person-096` | Redd Greve | 41 | BOSATT | household-041 (EKTEPAR) | foresatt | Sandnes | ja | ja | ja | — | tenor |
| `person-097` | Algerisk Platina | 42 | BOSATT | household-041 (EKTEPAR) | foresatt | Sandnes | ja | ja | ja | — | tenor |
| `person-098` | Gjestfri Katapult | 14 | BOSATT | household-041 (EKTEPAR) | barn | Sandnes | part | — | — | fritid | tenor |
| `person-099` | Klassisk Boom | 37 | BOSATT | household-042 (EKTEPAR) | foresatt | Lier | ja | ja | ja | — | tenor |
| `person-100` | Løsningsorientert Daddel | 37 | BOSATT | household-042 (EKTEPAR) | foresatt | Lier | ja | ja | ja | — | tenor |
| `person-101` | Interessert Kollisjon | 11 | BOSATT | household-042 (EKTEPAR) | barn | Lier | nei | — | — | — | tenor |
| `person-102` | Pratsom Forkledning | 93 | BOSATT | household-043 (ENSLIG) | foresatt | Tau | ja | ja | ja | — | tenor |
| `person-103` | Hårsår Teleskopord | 42 | BOSATT | household-044 (EKTEPAR) | foresatt | Rennebu | ja | ja | ja | — | tenor |
| `person-104` | Demokratisk Rose | 45 | BOSATT | household-044 (EKTEPAR) | foresatt | Rennebu | ja | ja | ja | — | tenor |
| `person-105` | Urettferdig Frende | 17 | BOSATT | household-044 (EKTEPAR) | barn | Rennebu | part | — | — | — | tenor |
| `person-106` | Smidig Dessert | 50 | BOSATT | household-045 (VOKSNE_SAMMEN) | foresatt | Ådalsbruk | ja | ja | ja | — | tenor |
| `person-107` | Fysisk April | 55 | BOSATT | household-045 (VOKSNE_SAMMEN) | foresatt | Ådalsbruk | ja | ja | ja | — | tenor |
| `person-108` | Legitim Mobiltelefon | 22 | BOSATT | household-045 (VOKSNE_SAMMEN) | foresatt | Ådalsbruk | ja | ja | ja | — | tenor |
| `person-109` | Munter Boksamling | 46 | BOSATT | household-046 (EKTEPAR) | foresatt | Nevervika | ja | ja | ja | — | tenor |
| `person-110` | Snål Varetekt | 12 | BOSATT | household-046 (EKTEPAR) | barn | Nevervika | nei | — | — | fritid | tenor |
| `person-111` | Utydelig Nakke | 49 | BOSATT | household-046 (EKTEPAR) | foresatt | Nevervika | ja | ja | ja | — | tenor |
| `person-112` | Stille Konsekvens | 108 | BOSATT | household-047 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-113` | Skapende Desimeter | 49 | BOSATT | household-048 (EKTEPAR) | foresatt | Hansnes | ja | — | ja | — | tenor |
| `person-114` | Varm Sovepose | 17 | BOSATT | household-048 (EKTEPAR) | barn | Hansnes | part | — | — | — | tenor |
| `person-115` | Slakk Andakt | 48 | BOSATT | household-048 (EKTEPAR) | foresatt | Hansnes | ja | — | ja | — | tenor |
| `person-116` | Svimmel Fisk | 57 | BOSATT | household-049 (VOKSNE_SAMMEN) | foresatt | Nissedal | ja | ja | ja | — | tenor |
| `person-117` | Festlig Fjord | 21 | BOSATT | household-049 (VOKSNE_SAMMEN) | foresatt | Nissedal | ja | ja | ja | — | tenor |
| `person-118` | Real Oridé | 58 | BOSATT | household-049 (VOKSNE_SAMMEN) | foresatt | Nissedal | ja | ja | ja | — | tenor |
| `person-119` | Halv Pakke | 3 | BOSATT | household-050 (ENSLIG_FORSORGER) | barn | Gjøvik | nei | — | — | — | tenor |
| `person-120` | Rørete Pakke | 39 | BOSATT | household-050 (ENSLIG_FORSORGER) | foresatt | Gjøvik | ja | — | ja | — | tenor |
| `person-121` | Opprettholdende Helt | 76 | BOSATT | household-051 (ENSLIG) | foresatt | Lindesnes | ja | ja | ja | — | tenor |
| `person-122` | Opplyst Pris | 68 | BOSATT | household-052 (PAR_UTEN_BARN) | foresatt | Gimse | ja | ja | ja | — | tenor |
| `person-123` | Estetisk Lama | 66 | BOSATT | household-052 (PAR_UTEN_BARN) | foresatt | Gimse | ja | ja | ja | — | tenor |
| `person-124` | Storartet Netthinne | 68 | BOSATT | household-053 (PAR_UTEN_BARN) | foresatt | Austevoll | ja | ja | ja | — | tenor |
| `person-125` | Autorisert Analyse | 65 | BOSATT | household-053 (PAR_UTEN_BARN) | foresatt | Austevoll | ja | ja | ja | — | tenor |
| `person-126` | Sensitiv Pukkel | 46 | BOSATT | household-054 (EKTEPAR) | foresatt | Drammen | ja | ja | ja | — | tenor |
| `person-127` | Algerisk Ankel | 49 | BOSATT | household-054 (EKTEPAR) | foresatt | Drammen | ja | ja | ja | — | tenor |
| `person-128` | Hardhudet Gebursdag | 16 | BOSATT | household-054 (EKTEPAR) | barn | Drammen | part | — | — | — | tenor |
| `person-129` | Idiotsikker Alarm | 39 | BOSATT | household-055 (EKTEPAR) | foresatt | Sandnes | ja | ja | ja | — | tenor |
| `person-130` | Tilfredsstillende Bjørnunge | 8 | BOSATT | household-055 (EKTEPAR) | barn | Sandnes | nei | — | — | — | tenor |
| `person-131` | Lidenskapelig Blad | 38 | BOSATT | household-055 (EKTEPAR) | foresatt | Sandnes | ja | ja | ja | — | tenor |
| `person-132` | Gratis Elv | 5 | BOSATT | household-056 (EKTEPAR) | barn | Enebakk | nei | — | — | — | tenor |
| `person-133` | Original Hage | 32 | BOSATT | household-056 (EKTEPAR) | foresatt | Enebakk | ja | — | ja | — | tenor |
| `person-134` | Innbringende Nakke | 34 | BOSATT | household-056 (EKTEPAR) | foresatt | Enebakk | ja | — | ja | — | tenor |
| `person-135` | Unøyaktig Stasjonsvogn | 40 | BOSATT | household-057 (ENSLIG) | foresatt | Vikersund | ja | ja | ja | — | tenor |
| `person-136` | Offisiell Brøkstrek | 12 | BOSATT | household-058 (EKTEPAR) | barn | Bergen | nei | — | — | — | tenor |
| `person-137` | Utnyttende Sokk | 36 | BOSATT | household-058 (EKTEPAR) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-138` | Uttrykksfull Fot | 40 | BOSATT | household-058 (EKTEPAR) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-139` | Sikker Onkel | 7 | BOSATT | household-059 (EKTEPAR) | barn | Senja | nei | — | — | fritid | tenor |
| `person-140` | Smul Fuktighetskrem | 39 | BOSATT | household-059 (EKTEPAR) | foresatt | Senja | ja | ja | ja | — | tenor |
| `person-141` | Autonom Skatoll | 35 | BOSATT | household-059 (EKTEPAR) | foresatt | Senja | ja | ja | ja | — | tenor |
| `person-142` | Akustisk Dromedar | 62 | BOSATT | household-060 (ENSLIG) | foresatt | Sveio | ja | ja | ja | — | tenor |
| `person-143` | Stabil Jubel | 56 | BOSATT | household-061 (ENSLIG) | foresatt | Tårstad | ja | — | ja | — | tenor |
| `person-144` | Lysegul Løvinne | 13 | BOSATT | household-062 (EKTEPAR) | barn | Glomfjord | part | — | — | fritid | tenor |
| `person-145` | Virkelig Kontrast | 47 | BOSATT | household-062 (EKTEPAR) | foresatt | Glomfjord | ja | ja | ja | — | tenor |
| `person-146` | Gøyal Tunge | 46 | BOSATT | household-062 (EKTEPAR) | foresatt | Glomfjord | ja | ja | ja | — | tenor |
| `person-147` | Rakrygget Nitrogen | 10 | BOSATT | household-063 (EKTEPAR) | barn | Oslo | nei | — | — | — | tenor |
| `person-148` | Komfortabel Geografi | 44 | BOSATT | household-063 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-149` | Lidenskapelig Heis | 42 | BOSATT | household-063 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-150` | Betydelig Basilikum | 49 | BOSATT | household-064 (EKTEPAR) | foresatt | Kvammen | ja | ja | ja | — | tenor |
| `person-151` | Slapp Filosof | 49 | BOSATT | household-064 (EKTEPAR) | foresatt | Kvammen | ja | ja | ja | — | tenor |
| `person-152` | Fornem Basilikum | 0 | BOSATT | household-064 (EKTEPAR) | barn | Kvammen | nei | — | — | — | tenor |
| `person-153` | Redd Frostnatt | 0 | BOSATT | household-065 (ENSLIG_FORSORGER) | barn | Råde | nei | — | — | — | tenor |
| `person-154` | Berømt Frostnatt | 24 | BOSATT | household-065 (ENSLIG_FORSORGER) | foresatt | Råde | ja | ja | ja | — | tenor |
| `person-155` | Berikende Toppskarv | 70 | BOSATT | household-066 (PAR_UTEN_BARN) | foresatt | Mosjøen | ja | ja | ja | — | tenor |
| `person-156` | Akseptabel Filet | 70 | BOSATT | household-066 (PAR_UTEN_BARN) | foresatt | Mosjøen | ja | ja | ja | — | tenor |
| `person-157` | Ny Pizza | 40 | BOSATT | household-067 (EKTEPAR) | foresatt | Lørenskog | ja | ja | ja | — | tenor |
| `person-158` | Funksjonell Ovn | 14 | BOSATT | household-067 (EKTEPAR) | barn | Lørenskog | part | — | — | fritid | tenor |
| `person-159` | Håndfast Pose | 44 | BOSATT | household-067 (EKTEPAR) | foresatt | Lørenskog | ja | ja | ja | — | tenor |
| `person-160` | Trofast Supporter | 4 | BOSATT | household-068 (EKTEPAR) | barn | Porsgrunn | nei | — | — | — | tenor |
| `person-161` | Fantastisk Kar | 43 | BOSATT | household-068 (EKTEPAR) | foresatt | Porsgrunn | ja | ja | ja | — | tenor |
| `person-162` | Vokal Komfyr | 44 | BOSATT | household-068 (EKTEPAR) | foresatt | Porsgrunn | ja | ja | ja | — | tenor |
| `person-163` | Usymmetrisk Lunsj | 32 | BOSATT | household-069 (EKTEPAR) | foresatt | Tromsø | ja | ja | ja | — | tenor |
| `person-164` | Redelig Bakterie | 5 | BOSATT | household-069 (EKTEPAR) | barn | Tromsø | nei | — | — | — | tenor |
| `person-165` | Riktig Kokeplate | 33 | BOSATT | household-069 (EKTEPAR) | foresatt | Tromsø | ja | ja | ja | — | tenor |
| `person-166` | Utydelig Brev | 38 | BOSATT | household-070 (EKTEPAR) | foresatt | Engan | ja | ja | ja | — | tenor |
| `person-167` | Lyseblå Kvern | 13 | BOSATT | household-070 (EKTEPAR) | barn | Engan | part | — | — | — | tenor |
| `person-168` | Sky Sjø | 36 | BOSATT | household-070 (EKTEPAR) | foresatt | Engan | ja | ja | ja | — | tenor |
| `person-169` | Snar Strømpebukse | 9 | BOSATT | household-070 (EKTEPAR) | barn | Engan | nei | — | — | fritid | tenor |
| `person-170` | Analyserende Ostehøvel | 3 | BOSATT | household-071 (EKTEPAR) | barn | Porsgrunn | nei | — | — | — | tenor |
| `person-171` | Utnyttende Analyse | 45 | BOSATT | household-071 (EKTEPAR) | foresatt | Porsgrunn | ja | ja | ja | — | tenor |
| `person-172` | God Hamster | 42 | BOSATT | household-071 (EKTEPAR) | foresatt | Porsgrunn | ja | ja | ja | — | tenor |
| `person-173` | Plutselig Ekornhale | 34 | BOSATT | household-072 (EKTEPAR) | foresatt | Karasjok | ja | ja | ja | — | tenor |
| `person-174` | Kjær Støvel | 35 | BOSATT | household-072 (EKTEPAR) | foresatt | Karasjok | ja | ja | ja | — | tenor |
| `person-175` | Slapp Grøt | 4 | BOSATT | household-072 (EKTEPAR) | barn | Karasjok | nei | — | — | — | tenor |
| `person-176` | Overfølsom Kråke | 64 | BOSATT | household-073 (ENSLIG) | foresatt | Bølandet | ja | ja | ja | — | tenor |
| `person-177` | Underlig Akkord | 33 | BOSATT | household-074 (EKTEPAR) | foresatt | Orkland | ja | ja | ja | — | tenor |
| `person-178` | Anstendig Tordivel | 7 | BOSATT | household-074 (EKTEPAR) | barn | Orkland | nei | — | — | fritid | tenor |
| `person-179` | Ufølsom Vaskemaskin | 30 | BOSATT | household-074 (EKTEPAR) | foresatt | Orkland | ja | ja | ja | — | tenor |
| `person-180` | Flink Buss | 78 | BOSATT | household-075 (ENSLIG) | foresatt | Indre Østfold | ja | ja | ja | — | tenor |
| `person-181` | Sped Frisyre | 47 | BOSATT | household-076 (EKTEPAR) | foresatt | Vega | ja | ja | ja | — | tenor |
| `person-182` | Oriental Treff | 12 | BOSATT | household-076 (EKTEPAR) | barn | Vega | nei | — | — | — | tenor |
| `person-183` | Unyttig Konduktør | 50 | BOSATT | household-076 (EKTEPAR) | foresatt | Vega | ja | ja | ja | — | tenor |
| `person-184` | Avansert Omsetning | 64 | BOSATT | household-077 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-185` | Ivrig Naturressurs | 59 | BOSATT | household-078 (PAR_UTEN_BARN) | foresatt | Lier | ja | ja | ja | — | tenor |
| `person-186` | Klartenkt Mage | 57 | BOSATT | household-078 (PAR_UTEN_BARN) | foresatt | Lier | ja | ja | ja | — | tenor |
| `person-187` | Gylden Orm | 36 | BOSATT | household-079 (ENSLIG) | foresatt | Treungen | ja | — | ja | — | tenor |
| `person-188` | Rimelig Dagsmarsj | 32 | BOSATT | household-080 (EKTEPAR) | foresatt | Halden | ja | ja | ja | — | tenor |
| `person-189` | Kjempende Fugleskremsel | 2 | BOSATT | household-080 (EKTEPAR) | barn | Halden | nei | — | — | — | tenor |
| `person-190` | Aktverdig Fugleskremsel | 35 | BOSATT | household-080 (EKTEPAR) | foresatt | Halden | ja | ja | ja | — | tenor |
| `person-191` | Effektiv Hai | 65 | BOSATT | household-081 (PAR_UTEN_BARN) | foresatt | Tunhovd | ja | — | ja | — | tenor |
| `person-192` | Ungt Ekornhale | 61 | BOSATT | household-081 (PAR_UTEN_BARN) | foresatt | Tunhovd | ja | — | ja | — | tenor |
| `person-193` | Ulastelig Handlingsevne | 72 | BOSATT | household-082 (ENSLIG) | foresatt | Senja | ja | — | ja | — | tenor |
| `person-194` | Skjermet person | 28 | BOSATT | household-083 (ENSLIG) | foresatt | Inderøy | ja | ja | ja | — | tenor |
| `person-195` | Stabil Fluktstol | 59 | BOSATT | household-084 (ENSLIG) | foresatt | Mosjøen | ja | ja | ja | — | tenor |
| `person-196` | Erfaren Blund | 56 | BOSATT | household-085 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-197` | Legitim Klippe | 31 | BOSATT | household-086 (EKTEPAR) | foresatt | Tretten | ja | ja | ja | — | tenor |
| `person-198` | Uforgjengelig Klippe | 1 | BOSATT | household-086 (EKTEPAR) | barn | Tretten | nei | — | — | — | tenor |
| `person-199` | Trådløs Toppskarv | 35 | BOSATT | household-086 (EKTEPAR) | foresatt | Tretten | ja | ja | ja | — | tenor |
| `person-200` | Presis Deklarasjon | 17 | BOSATT | household-087 (EKTEPAR) | barn | Stryn | part | — | — | — | tenor |
| `person-201` | Rimelig Fakir | 41 | BOSATT | household-087 (EKTEPAR) | foresatt | Stryn | ja | ja | ja | — | tenor |
| `person-202` | Kunst Mormor | 42 | BOSATT | household-087 (EKTEPAR) | foresatt | Stryn | ja | ja | ja | — | tenor |
| `person-203` | Demokratisk Hestedrosje | 48 | BOSATT | household-088 (FLERGENERASJON) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-204` | Ryddig Vogge | 16 | BOSATT | household-088 (FLERGENERASJON) | barn | Bergen | part | — | — | — | tenor |
| `person-205` | Skapende Ekornhale | 13 | BOSATT | household-088 (FLERGENERASJON) | barn | Bergen | part | — | — | — | tenor |
| `person-206` | Motstandsdyktig Harpun | 46 | BOSATT | household-088 (FLERGENERASJON) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-207` | Analyserende Flagg | 21 | BOSATT | household-088 (FLERGENERASJON) | voksen | Bergen | ja | ja | — | — | tenor |
| `person-208` | Empirisk Pytt | 17 | BOSATT | household-089 (EKTEPAR) | barn | Kristiansand | part | — | — | fritid | tenor |
| `person-209` | Urokkelig Busskur | 42 | BOSATT | household-089 (EKTEPAR) | foresatt | Kristiansand | ja | ja | ja | — | tenor |
| `person-210` | Åpen Konvolutt | 44 | BOSATT | household-089 (EKTEPAR) | foresatt | Kristiansand | ja | ja | ja | — | tenor |
| `person-211` | Kjær Graf | 38 | BOSATT | household-090 (EKTEPAR) | foresatt | Stad | ja | ja | ja | — | tenor |
| `person-212` | Tilfeldig Malstrøm | 15 | BOSATT | household-090 (EKTEPAR) | barn | Stad | part | — | — | — | tenor |
| `person-213` | Musikalsk Kaie | 36 | BOSATT | household-090 (EKTEPAR) | foresatt | Stad | ja | ja | ja | — | tenor |
| `person-214` | Aldrende Hare | 44 | BOSATT | household-091 (EKTEPAR) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-215` | Barmhjertig Doktorgrad | 44 | BOSATT | household-091 (EKTEPAR) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-216` | Presentabel Mandolin | 17 | BOSATT | household-091 (EKTEPAR) | barn | Bergen | part | — | — | — | tenor |
| `person-217` | Observant Betydning | 47 | BOSATT | household-092 (ENSLIG) | foresatt | Kristiansand | ja | ja | ja | — | tenor |
| `person-218` | Skjermet person | 41 | BOSATT | household-093 (ENSLIG_FORSORGER) | foresatt | Hattfjelldal | ja | — | ja | — | tenor |
| `person-219` | Skjermet person | 4 | BOSATT | household-093 (ENSLIG_FORSORGER) | barn | Hattfjelldal | nei | — | — | — | tenor |
| `person-220` | Nær Beskjed | 51 | BOSATT | household-094 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-221` | Deilig Sjø | 58 | BOSATT | household-095 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-222` | Oversiktlig Sofa | 57 | BOSATT | household-096 (ENSLIG) | foresatt | Fauske | ja | ja | ja | — | tenor |
| `person-223` | Klok Hai | 53 | BOSATT | household-097 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-224` | Ærlig Falk | 47 | BOSATT | household-098 (VOKSNE_SAMMEN) | foresatt | Kvinnherad | ja | — | ja | — | tenor |
| `person-225` | Halv Logg | 48 | BOSATT | household-098 (VOKSNE_SAMMEN) | foresatt | Kvinnherad | ja | — | ja | — | tenor |
| `person-226` | Teoretisk Skive | 21 | BOSATT | household-098 (VOKSNE_SAMMEN) | foresatt | Kvinnherad | ja | — | ja | — | tenor |
| `person-227` | Rosa Pinnestol | 45 | BOSATT | household-099 (EKTEPAR) | foresatt | Halden | ja | ja | ja | — | tenor |
| `person-228` | Smart Blankett | 42 | BOSATT | household-099 (EKTEPAR) | foresatt | Halden | ja | ja | ja | — | tenor |
| `person-229` | Egoistisk Teleskopord | 7 | BOSATT | household-099 (EKTEPAR) | barn | Halden | nei | — | — | fritid | tenor |
| `person-230` | Vennlig Fiken | 83 | BOSATT | household-100 (ENSLIG) | foresatt | Senja | ja | ja | ja | — | tenor |
| `person-231` | Ubestikkelig Sko | 36 | BOSATT | household-101 (ENSLIG_FORSORGER) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-232` | Eventyrlig Sko | 3 | BOSATT | household-101 (ENSLIG_FORSORGER) | barn | Oslo | nei | — | — | — | tenor |
| `person-233` | Empirisk Analyse | 46 | BOSATT | household-102 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-234` | Ulydig Ballong | 47 | BOSATT | household-102 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-235` | Inkluderende Sjø | 17 | BOSATT | household-102 (EKTEPAR) | barn | Oslo | part | — | — | fritid | tenor |
| `person-236` | Farlig Konvolutt | 43 | BOSATT | household-103 (EKTEPAR) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-237` | Berømt Trompet | 44 | BOSATT | household-103 (EKTEPAR) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-238` | Jovial Jordskorpe | 17 | BOSATT | household-103 (EKTEPAR) | barn | Bergen | part | — | — | fritid | tenor |
| `person-239` | Streng Dråpe | 107 | BOSATT | household-104 (ENSLIG) | foresatt | Rennebu | ja | ja | ja | — | tenor |
| `person-240` | Inkonsekvent Kork | 98 | BOSATT | household-105 (PAR_UTEN_BARN) | foresatt | Sandefjord | ja | ja | ja | — | tenor |
| `person-241` | Erfaren Kveldsmat | 96 | BOSATT | household-105 (PAR_UTEN_BARN) | foresatt | Sandefjord | ja | ja | ja | — | tenor |
| `person-242` | Ærlig Regel | 62 | BOSATT | household-106 (ENSLIG) | foresatt | Sveio | ja | — | ja | — | tenor |
| `person-243` | Utstrakt Ferskvann | 49 | BOSATT | household-107 (EKTEPAR) | foresatt | Stjørdal | ja | ja | ja | — | tenor |
| `person-244` | Perfekt Kjedekollisjon | 46 | BOSATT | household-107 (EKTEPAR) | foresatt | Stjørdal | ja | ja | ja | — | tenor |
| `person-245` | Akseptabel Fjes | 12 | BOSATT | household-107 (EKTEPAR) | barn | Stjørdal | nei | — | — | — | tenor |
| `person-246` | Lidenskapelig Oter | 83 | BOSATT | household-108 (ENSLIG) | foresatt | Arendal | ja | ja | ja | — | tenor |
| `person-247` | Opprett Bøylehest | 35 | BOSATT | household-109 (ENSLIG) | foresatt | Hakadal | ja | ja | ja | — | tenor |
| `person-248` | Standhaftig Lugar | 72 | BOSATT | household-110 (ENSLIG) | foresatt | Øygarden | ja | — | ja | — | tenor |
| `person-249` | Historisk Elefant | 106 | BOSATT | household-111 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-250` | Eksemplarisk Tre | 49 | BOSATT | household-112 (ENSLIG) | foresatt | Sør-Varanger | ja | ja | ja | — | tenor |
| `person-251` | Komplett Kiwi | 103 | BOSATT | household-113 (PAR_UTEN_BARN) | foresatt | Karmøy | ja | ja | ja | — | tenor |
| `person-252` | Fin Hullemaskin | 102 | BOSATT | household-113 (PAR_UTEN_BARN) | foresatt | Karmøy | ja | ja | ja | — | tenor |
| `person-253` | Real Moskus | 13 | BOSATT | household-114 (EKTEPAR) | barn | Froland | part | — | — | — | tenor |
| `person-254` | Tykkhudet Ramme | 36 | BOSATT | household-114 (EKTEPAR) | foresatt | Froland | ja | ja | ja | — | tenor |
| `person-255` | Tru Grapefrukt | 37 | BOSATT | household-114 (EKTEPAR) | foresatt | Froland | ja | ja | ja | — | tenor |
| `person-256` | Fiolett Dagbok | 61 | BOSATT | household-115 (ENSLIG) | foresatt | Tromsø | ja | ja | ja | — | tenor |
| `person-257` | Lyseblå System | 45 | BOSATT | household-116 (ENSLIG) | foresatt | Drøbak | ja | ja | ja | — | tenor |
| `person-258` | Tom Bukse | 42 | BOSATT | household-117 (EKTEPAR) | foresatt | Hamar | ja | ja | ja | — | tenor |
| `person-259` | Klam Ekspedisjon | 4 | BOSATT | household-117 (EKTEPAR) | barn | Hamar | nei | — | — | — | tenor |
| `person-260` | Fantasiløs Årsak | 41 | BOSATT | household-117 (EKTEPAR) | foresatt | Hamar | ja | ja | ja | — | tenor |
| `person-261` | Distingvert Opplag | 62 | BOSATT | household-118 (ENSLIG) | foresatt | Tjørhom | ja | ja | ja | — | tenor |
| `person-262` | Innsiktsfull Betaling | 49 | BOSATT | household-119 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-263` | Alfabetisk Leveregel | 15 | BOSATT | household-119 (EKTEPAR) | barn | Oslo | part | — | — | fritid | tenor |
| `person-264` | Turkis Sekretær | 46 | BOSATT | household-119 (EKTEPAR) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-265` | Alminnelig Kreps | 76 | BOSATT | household-120 (PAR_UTEN_BARN) | foresatt | Helle | ja | — | ja | — | tenor |
| `person-266` | Subjektiv Bjørkefink | 79 | BOSATT | household-120 (PAR_UTEN_BARN) | foresatt | Helle | ja | — | ja | — | tenor |
| `person-267` | Intuitiv Øvelse | 67 | BOSATT | household-121 (ENSLIG) | foresatt | Mosvik | ja | ja | ja | — | tenor |
| `person-268` | Aktverdig Alkove | 23 | BOSATT | household-122 (ENSLIG) | foresatt | Fenstad | ja | ja | ja | — | tenor |
| `person-269` | Grønn Pike | 50 | BOSATT | household-123 (EKTEPAR) | foresatt | Gursken | ja | ja | ja | — | tenor |
| `person-270` | Rosa Ekspedisjon | 54 | BOSATT | household-123 (EKTEPAR) | foresatt | Gursken | ja | ja | ja | — | tenor |
| `person-271` | Jordnær Hatt | 17 | BOSATT | household-123 (EKTEPAR) | barn | Gursken | part | — | — | fritid | tenor |
| `person-272` | Moderat Omstilling | 5 | BOSATT | household-124 (EKTEPAR) | barn | Kvinnherad | nei | — | — | — | tenor |
| `person-273` | Kompetent Kommune | 35 | BOSATT | household-124 (EKTEPAR) | foresatt | Kvinnherad | ja | — | ja | — | tenor |
| `person-274` | Tykkhudet Mormor | 31 | BOSATT | household-124 (EKTEPAR) | foresatt | Kvinnherad | ja | — | ja | — | tenor |
| `person-275` | Øde Ambulanse | 43 | BOSATT | household-125 (EKTEPAR) | foresatt | Ullensvang | ja | — | ja | — | tenor |
| `person-276` | Jordnær Joker | 16 | BOSATT | household-125 (EKTEPAR) | barn | Ullensvang | part | — | — | fritid | tenor |
| `person-277` | Punktlig Månefase | 41 | BOSATT | household-125 (EKTEPAR) | foresatt | Ullensvang | ja | — | ja | — | tenor |
| `person-278` | Sannferdig Malerbukse | 68 | BOSATT | household-126 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-279` | Kvart Assistent | 3 | BOSATT | household-127 (ENSLIG_FORSORGER) | barn | Steinkjer | nei | — | — | — | tenor |
| `person-280` | Ivrig Assistent | 35 | BOSATT | household-127 (ENSLIG_FORSORGER) | foresatt | Steinkjer | ja | ja | ja | — | tenor |
| `person-281` | Hes Aprikos | 49 | BOSATT | household-128 (ENSLIG) | foresatt | Orkland | ja | ja | ja | — | tenor |
| `person-282` | Pratsom Gulnebblom Strømpebukse | 83 | BOSATT | household-129 (PAR_UTEN_BARN) | foresatt | Steinkjer | ja | ja | ja | — | tenor |
| `person-283` | Konfus Kompetent Tyr Strømpebukse | 82 | BOSATT | household-129 (PAR_UTEN_BARN) | foresatt | Steinkjer | ja | ja | ja | — | tenor |
| `person-284` | Levende Revebjelle | 57 | BOSATT | household-130 (ENSLIG) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-285` | Urimelig Snøball | 35 | BOSATT | household-131 (ENSLIG_FORSORGER) | foresatt | Hovdebygda | ja | ja | ja | — | tenor |
| `person-286` | Eksemplarisk Snøball | 2 | BOSATT | household-131 (ENSLIG_FORSORGER) | barn | Hovdebygda | nei | — | — | — | tenor |
| `person-287` | Opplagt Stasjon | 39 | BOSATT | household-132 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-288` | Dyktig Fjellkjede | 52 | BOSATT | household-133 (ENSLIG) | foresatt | Øygarden | ja | ja | ja | — | tenor |
| `person-289` | Viktig Foxtrot | 69 | BOSATT | household-134 (ENSLIG) | foresatt | Stjørdal | ja | ja | ja | — | tenor |
| `person-290` | Varm Skrivemaskin | 54 | BOSATT | household-135 (ENSLIG) | foresatt | Øygarden | ja | — | ja | — | tenor |
| `person-291` | Typisk Graf | 41 | BOSATT | household-136 (ENSLIG) | foresatt | Sandnes | ja | — | ja | — | tenor |
| `person-292` | Fornem Kjeltring | 23 | BOSATT | household-137 (ENSLIG) | foresatt | Stryn | ja | ja | ja | — | tenor |
| `person-293` | Stolt Bad | 80 | BOSATT | household-138 (ENSLIG) | foresatt | Skotterud | ja | ja | ja | — | tenor |
| `person-294` | Morsom Gullstol | 47 | BOSATT | household-139 (ENSLIG) | foresatt | Bærum | ja | — | ja | — | tenor |
| `person-295` | Minst Busse | 62 | BOSATT | household-140 (ENSLIG) | foresatt | Magnor | ja | ja | ja | — | tenor |
| `person-296` | Taktfull Sekretær | 28 | BOSATT | household-141 (ENSLIG_FORSORGER) | foresatt | Hustadvika | ja | ja | ja | — | tenor |
| `person-297` | Hårsår Stafett | 4 | BOSATT | household-141 (ENSLIG_FORSORGER) | barn | Hustadvika | nei | — | — | — | tenor |
| `person-298` | Rik Panter | 49 | BOSATT | household-142 (EKTEPAR) | foresatt | Larvik | ja | ja | ja | — | tenor |
| `person-299` | Kry Høyttaler | 50 | BOSATT | household-142 (EKTEPAR) | foresatt | Larvik | ja | ja | ja | — | tenor |
| `person-300` | Husløs Avstand | 17 | BOSATT | household-142 (EKTEPAR) | barn | Larvik | part | — | — | fritid | tenor |
| `person-301` | Akselererende Kollega | 78 | BOSATT | household-143 (ENSLIG) | foresatt | Sandnes | ja | ja | ja | — | tenor |
| `person-302` | Sein Granskning | 74 | BOSATT | household-144 (PAR_UTEN_BARN) | foresatt | Korsvegen | ja | ja | ja | — | tenor |
| `person-303` | Tankefull Lue | 70 | BOSATT | household-144 (PAR_UTEN_BARN) | foresatt | Korsvegen | ja | ja | ja | — | tenor |
| `person-304` | Iherdig Pakt | 105 | BOSATT | household-145 (ENSLIG) | foresatt | Rennebu | ja | — | ja | — | tenor |
| `person-305` | Lekker Klasse | 96 | BOSATT | household-146 (PAR_UTEN_BARN) | foresatt | Fredrikstad | ja | ja | ja | — | tenor |
| `person-306` | Rimelig Fjellkjede | 98 | BOSATT | household-146 (PAR_UTEN_BARN) | foresatt | Fredrikstad | ja | ja | ja | — | tenor |
| `person-307` | Avansert Histolog | 48 | BOSATT | household-147 (ENSLIG) | foresatt | Drøbak | ja | — | ja | — | tenor |
| `person-308` | Mett Ekspedisjon | 24 | BOSATT | household-148 (ENSLIG) | foresatt | Grue Finnskog | ja | ja | ja | — | tenor |
| `person-309` | Omsorgsfull Blogg | 77 | BOSATT | household-149 (ENSLIG) | foresatt | Drammen | ja | — | ja | — | tenor |
| `person-310` | Fruktbar Puddel | 74 | BOSATT | household-150 (ENSLIG) | foresatt | Horten | ja | ja | ja | — | tenor |
| `person-311` | Deilig Modell | 23 | BOSATT | household-151 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-312` | Grunn Natt | 26 | BOSATT | household-152 (ENSLIG) | foresatt | Fredrikstad | ja | ja | ja | — | tenor |
| `person-313` | Gul Malerbukse | 42 | BOSATT | household-153 (ENSLIG_FORSORGER) | foresatt | Fosnavåg | ja | ja | ja | — | tenor |
| `person-314` | Emosjonell Malerbukse | 4 | BOSATT | household-153 (ENSLIG_FORSORGER) | barn | Fosnavåg | nei | — | — | — | tenor |
| `person-315` | Lojal Omstilling | 33 | BOSATT | household-154 (PAR_UTEN_BARN) | foresatt | Molde | ja | ja | ja | — | tenor |
| `person-316` | Kompetent Korg | 32 | BOSATT | household-154 (PAR_UTEN_BARN) | foresatt | Molde | ja | ja | ja | — | tenor |
| `person-317` | Aktiv Ask | 26 | BOSATT | household-155 (ENSLIG) | foresatt | Ålesund | ja | ja | ja | — | tenor |
| `person-318` | Optimistisk Dør | 64 | BOSATT | household-156 (ENSLIG) | foresatt | Moss | ja | — | ja | — | tenor |
| `person-319` | Skjermet person | 83 | BOSATT | household-157 (PAR_UTEN_BARN) | foresatt | Vingelen | ja | ja | ja | — | tenor |
| `person-320` | Skjermet person | 81 | BOSATT | household-157 (PAR_UTEN_BARN) | foresatt | Vingelen | ja | ja | ja | — | tenor |
| `person-321` | Ufruktbar Badestrand | 70 | BOSATT | household-158 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-322` | Øde Malerbukse | 78 | BOSATT | household-159 (ENSLIG) | foresatt | Bessaker | ja | ja | ja | — | tenor |
| `person-323` | Konvensjonell Reise | 33 | BOSATT | household-160 (PAR_UTEN_BARN) | foresatt | Austevoll | ja | ja | ja | — | tenor |
| `person-324` | Lyselilla Komfyr | 30 | BOSATT | household-160 (PAR_UTEN_BARN) | foresatt | Austevoll | ja | ja | ja | — | tenor |
| `person-325` | Autentisk Nepe | 85 | BOSATT | household-161 (ENSLIG) | foresatt | Senja | ja | — | ja | — | tenor |
| `person-326` | Festlig Radiostasjon | 53 | BOSATT | household-162 (ENSLIG) | foresatt | Høydalsmo | ja | ja | ja | — | tenor |
| `person-327` | Underfundig Budeie | 113 | BOSATT | household-163 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-328` | Foretaksom Metode | 65 | BOSATT | household-164 (ENSLIG) | foresatt | Tromsø | ja | — | ja | — | tenor |
| `person-329` | Fysisk Fane | 56 | BOSATT | household-165 (ENSLIG) | foresatt | Bergen | ja | ja | ja | — | tenor |
| `person-330` | Storartet Jak | 112 | BOSATT | household-166 (ENSLIG) | foresatt | Tjøtta | ja | — | ja | — | tenor |
| `person-331` | Sunn Fyrste | 66 | BOSATT | household-167 (ENSLIG) | foresatt | Sandnes | ja | ja | ja | — | tenor |
| `person-332` | Kvadratisk Magesekk | 63 | BOSATT | household-168 (ENSLIG) | foresatt | Skogn | ja | — | ja | — | tenor |
| `person-333` | Utrolig Jubel | 67 | BOSATT | household-169 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-334` | Empirisk Reke | 42 | BOSATT | household-170 (VOKSNE_SAMMEN) | foresatt | Homborsund | ja | — | ja | — | tenor |
| `person-335` | Skravlete Miljøgift | 20 | BOSATT | household-170 (VOKSNE_SAMMEN) | foresatt | Homborsund | ja | — | ja | — | tenor |
| `person-336` | Etterpåklok Konduktør | 40 | BOSATT | household-170 (VOKSNE_SAMMEN) | foresatt | Homborsund | ja | — | ja | — | tenor |
| `person-337` | Elegant Baug | 36 | BOSATT | household-171 (ENSLIG) | foresatt | Vestmarka | ja | ja | ja | — | tenor |
| `person-338` | Bevisst Jakke | 56 | BOSATT | household-172 (ENSLIG) | foresatt | Fauske | ja | — | ja | — | tenor |
| `person-339` | Lys Fallskjermhopper | 77 | BOSATT | household-173 (ENSLIG) | foresatt | Ålesund | ja | ja | ja | — | tenor |
| `person-340` | Unøyaktig Mynt | 99 | BOSATT | household-174 (ENSLIG) | foresatt | Kristiansand | ja | ja | ja | — | tenor |
| `person-341` | Komplisert Kveldsmat | 60 | BOSATT | household-175 (ENSLIG) | foresatt | Øye | ja | ja | ja | — | tenor |
| `person-342` | Handlende Overskrift | 99 | BOSATT | household-176 (ENSLIG) | foresatt | Kristiansand | ja | — | ja | — | tenor |
| `person-343` | Fruktbar Fil | 93 | BOSATT | household-177 (ENSLIG) | foresatt | Tau | ja | ja | ja | — | tenor |
| `person-344` | Iherdig Kjæreste | 3 | BOSATT | household-178 (ENSLIG_FORSORGER) | barn | Bærum | nei | — | — | — | tenor |
| `person-345` | Slakk Kjæreste | 33 | BOSATT | household-178 (ENSLIG_FORSORGER) | foresatt | Bærum | ja | — | ja | — | tenor |
| `person-346` | Utydelig Mandarin | 78 | BOSATT | household-179 (ENSLIG) | foresatt | Skotterud | ja | — | ja | — | tenor |
| `person-347` | Skeptisk Hare | 57 | BOSATT | household-180 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-348` | Kjær Oppdatering | 49 | BOSATT | household-181 (EKTEPAR) | foresatt | Kvinnherad | ja | ja | ja | — | tenor |
| `person-349` | Rakrygget Rekkefølge | 47 | BOSATT | household-181 (EKTEPAR) | foresatt | Kvinnherad | ja | ja | ja | — | tenor |
| `person-350` | Dypsindig Jul | 12 | BOSATT | household-181 (EKTEPAR) | barn | Kvinnherad | nei | — | — | fritid | tenor |
| `person-351` | Dobbel Plomme | 27 | BOSATT | household-182 (ENSLIG) | foresatt | Geilo | ja | — | ja | — | tenor |
| `person-352` | Autonom Handelsreisende | 77 | BOSATT | household-183 (ENSLIG) | foresatt | Feiring | ja | ja | ja | — | tenor |
| `person-353` | Subtil Hengekøye | 73 | BOSATT | household-184 (ENSLIG) | foresatt | Øygarden | ja | ja | ja | — | tenor |
| `person-354` | Trekantet Innhegning | 103 | BOSATT | household-185 (ENSLIG) | foresatt | Porsgrunn | ja | — | ja | — | tenor |
| `person-355` | Oppjaget Gullmynt | 52 | BOSATT | household-186 (ENSLIG) | foresatt | Ibestad | ja | ja | ja | — | tenor |
| `person-356` | Korrekt Assistent | 26 | BOSATT | household-187 (ENSLIG) | foresatt | Ringsaker | ja | ja | ja | — | tenor |
| `person-357` | Autonom Hingst | 82 | BOSATT | household-188 (ENSLIG) | foresatt | Arendal | ja | — | ja | — | tenor |
| `person-358` | Overflødig Frukthage | 59 | BOSATT | household-189 (ENSLIG) | foresatt | Øye | ja | — | ja | — | tenor |
| `person-359` | Parodisk Svigersønn | 60 | BOSATT | household-190 (ENSLIG) | foresatt | Magnor | ja | ja | ja | — | tenor |
| `person-360` | Ren Kime | 65 | BOSATT | household-191 (ENSLIG) | foresatt | Tjørhom | ja | — | ja | — | tenor |
| `person-361` | Hes Lyd | 70 | BOSATT | household-192 (ENSLIG) | foresatt | Fjellhamar | ja | ja | ja | — | tenor |
| `person-362` | Kald Glovarm Universitet | 22 | BOSATT | household-193 (ENSLIG) | foresatt | Braskereidfoss | ja | ja | ja | — | tenor |
| `person-363` | Humoristisk Granitt | 46 | BOSATT | household-194 (ENSLIG) | foresatt | Orkland | ja | — | ja | — | tenor |
| `person-364` | Rakrygget Komposisjon | 60 | BOSATT | household-195 (ENSLIG) | foresatt | Nordli | ja | ja | ja | — | tenor |
| `person-365` | Sympatisk Føll | 41 | BOSATT | household-196 (ENSLIG) | foresatt | Oslo | ja | ja | ja | — | tenor |
| `person-366` | Oransje Antikvitet | 113 | BOSATT | household-197 (ENSLIG) | foresatt | Oslo | ja | — | ja | — | tenor |
| `person-367` | Uttrykksfull Seilbåt | 50 | BOSATT | household-198 (ENSLIG) | foresatt | Nordmela | ja | — | ja | — | tenor |
| `person-368` | Veldig Natthegre | 24 | BOSATT | household-199 (ENSLIG) | foresatt | Sandnes | ja | — | ja | — | tenor |
| `person-369` | Ravgul Flyplass | 36 | BOSATT | household-200 (ENSLIG) | foresatt | Sortland | ja | ja | ja | — | tenor |
| `person-370` | Svimmel Kam | 5 | DOED | — | — | Harstad | nei | — | — | — | tenor |
| `person-371` | Oppklarende Nyre Ostehøvel | 25 | UTFLYTTET | — | — | Bergen | nei | — | — | — | tenor |
| `person-372` | Uglesett Badebukse | 51 | DOED | — | — | Oslo | nei | — | — | — | tenor |
| `person-373` | Hurtig Veske | 76 | DOED | — | — | Trondheim | nei | — | — | — | tenor |
| `person-374` | Kursiv Forskjell | 57 | DOED | — | — | Stad | nei | — | — | — | tenor |
| `person-375` | Sunn Legg | 49 | DOED | — | — | — | nei | — | — | — | tenor |
| `person-376` | Intuitiv Alge | 10 | DOED | — | — | Oslo | nei | — | — | — | tenor |
| `person-377` | Sannsynlig Jurist Ostehøvel | 23 | UTFLYTTET | — | — | Bergen | nei | — | — | — | tenor |
| `person-378` | Dyp Nisse | 6 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-379` | Minkende Ert | 22 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-380` | Autorisert Kulepenn | 55 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-381` | Utakknemlig Desimeter | 8 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-382` | Lysegrønn Gelatin | 52 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-383` | Kreativ Jobb | 42 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-384` | Gul Bolle | 11 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-385` | Opprømt Tannbørste | 78 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-386` | Kreativ Presentasjon | 97 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-387` | Upersonlig Middag | 7 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-388` | Dyp Porsjon | 24 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-389` | Gild Salt | 26 | MIDLERTIDIG | — | — | — | nei | — | — | — | tenor |
| `person-390` | Hes Alpakka | 11 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-391` | Trekantet Linje | 14 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-392` | Påpasselig Lagidrett | 36 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-393` | Komplett Varedeklarasjon | 26 | INAKTIV | — | — | — | nei | — | — | — | tenor |
| `person-394` | Underlig Nisse | 50 | INAKTIV | — | — | — | nei | — | — | — | tenor |

## Grenser du bør kjenne

- **Fødselsnumrene er syntetiske og merket som det.** Måneden har 80 lagt til, så januar er 81 og desember er 92, og kontrollsifrene er regnet ut etter påslaget. Det er Skatteetatens konvensjon for Tenor-data. Skal du lese en dato ut av et nummer, må du trekke fra 80 først — men `foedselsdato` er eget felt, så du trenger det sjelden.
- **Tre personer har et fødselsnummer som beskriver en annen dato enn `foedselsdato`.** Det er lovlig i Folkeregisteret — en rettet fødselsdato beholder det opprinnelige nummeret — og det kommer fra Tenor.
- **Inntekten er forfattet, ikke hentet.** Tenor hadde inntektsdata for 6 av 120 hoveddokumenter og ingen av foreldrene. Beløpene for de importerte utledes deterministisk fra fødselsnummeret; terskelscenarioene ligger hos de kuraterte husstandene, der de er forfattet og kontrollert.
- **`kommune` er et visningsnavn, `kommunenummer` er nøkkelen.** Tenor oppgir bare nummeret; der `data/brreg.seed.json` kjenner navnet brukes det, ellers står poststedet.
- **Matrikkelen dekker de gatene befolkningen faktisk bor i**, hentet fra Geonorge per kommune, pluss alle Bergens gater. Alle bosatte er bundet til en matrikkelenhet gjennom `bostedsadresse.adresseIdentifikatorFraMatrikkelen`. De som ikke er bosatt har ingen binding, og de som har D-nummer har ingen adresse i det hele tatt.
- **Adressebeskyttede personer står med fullt navn og adresse i `data/personer.json`.** Det er med vilje: maskeringen skjer ved innlasting, i `apps/sandbox-backend/src/skjerming.ts`, og hadde seeden vært maskert ville det ikke vært noe å beskytte. Leser du fila direkte ser du klartekst; går du gjennom API-et ser du maskeringen. `pnpm test:skjerming` holder den på plass.
- **Tolv personer er over 100 år**, den eldste 113. Det er Tenor slik det leveres.

