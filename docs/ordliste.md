# Ordliste

Forvaltningstermene i dokumentasjonen, forklart slik de brukes i sandkassen — kortversjonen,
ikke jussen. Alfabetisk.

**Fiks** — KS' plattform for felleskomponentene kommunene deler: registeroppslag, samtykke,
oppgaver og utsending. I sandkassen etterlignes hele plattformen av `fiks-simulator` (`:8081`).

**gnr/bnr** — gårds- og bruksnummer: nummeret som identifiserer en matrikkelenhet (en eiendom)
innenfor en kommune. Verktøyet `matrikkel_hent_eiendom` i `tools-api` slår opp på det.

**grunnbok** — det tinglyste eierregisteret. Matrikkelen sier hva en eiendom er, grunnboken
hvem som eier den — derfor ligger eierskapet i egen fil, `data/eierforhold.json`, som
`matrikkel-mock` slår sammen med matrikkeldataene ved innlasting.

**hjemmel** — rettslig grunnlag for å gjøre noe, for eksempel lese en dataressurs. En `403`
fra backend er hjemmelslaget som virker — feil hjemmel eller manglende samtykke — ikke en
feil i sandkassen. `401` betyr bare at tokenet mangler eller er utløpt.

**kode 6** — strengt fortrolig adresse i Folkeregisteret. Slike personer maskeres ved
innlasting (`apps/shared/skjerming.ts`): API-et viser «Skjermet person», mens seedfila med
vilje står i klartekst. Kode 7 (fortrolig adresse) gir nullet adresse.

**KRR** — Kontakt- og reservasjonsregisteret: innbyggerens e-post, telefon og eventuelle
reservasjon mot digital post. Ligger i `data/krr.json`, serveres av `fiks-simulator`, og
avgjør kanalen i SvarUt — reservert betyr print.

**Maskinporten-scope** — Maskinporten utsteder token til maskiner, og scopet i tokenet er
selve hjemmelen: ett scope per Fiks-flate (`ks:fiks:samtykke`, `ks:fiks:svarut`, …). Et
innbyggertoken fra ID-porten avvises der med `403 KREVER_MASKINPORTEN`. Begge utstederne
etterlignes av `digdir-mock` (`:8086`).

**matrikkel** — Norges offisielle register over eiendommer, adresser og bygninger
(Kartverket). I sandkassen er det `matrikkel-mock` (`:8085`), som svarer på både SOAP og
REST. Eierskap står ikke der — se grunnbok.

**MinID** — den enkleste elektroniske ID-en, og den første man kan få: den kan bestilles fra
det året man fyller 13. Derfor kan ingen testperson under 13 logge inn i sandkassen.

**rettslig handleevne** — å kunne opptre på egen hånd overfor forvaltningen, fra fylte 18.
En 15-åring kan logge inn, men er bare part i saken: å starte en prosess gir `403` som
navngir de foresatte som kan være avsender. Regelen ligger i `apps/shared/handleevne.ts`.

**rolleId** — leddet i Fiks-stiene (`/register/api/v1/ks/{rolleId}/…`) som sier hvilken
rolle kommunen spør i. Den snevrer inn innenfor scopet: Folkeregisterflaten gir bare
informasjonsdelene rollen har hjemmel til, og ukjent rolleId er `403 UKJENT_ROLLE`.

**SvarUt** — Fiks-tjenesten for utsending av post fra det offentlige, digitalt eller på
papir. Innsending oppretter en forsendelse hos `fiks-simulator`; KRR avgjør kanalen ved
opprettelse, og statusen (MOTTATT → SENDT_DIGITALT/SENDT_PRINT → LEST/PRINTET) utledes av
tiden siden.
Kvitteringen vises i `/chat`.

**Tenor** — Skatteetatens testdatasøk, kilden til den syntetiske befolkningen. Et syntetisk
fødselsnummer kjennes igjen på at 80 er lagt til måneden. Råuttrekkene ligger i `data/tenor/`.
