# Ordliste

Forvaltningstermene i dokumentasjonen, forklart slik de brukes i sandkassen - kortversjonen,
ikke jussen. Alfabetisk.

**brukersted** - tjenesten som mottar et digitalt bevis fra en digital lommebok og
verifiserer det. Digdirs dokumentasjon er på nynorsk og skriver «brukarstad»;
«verifikator» brukes om det samme. Ikke i sandkassen - se
[`docs/bygg-selv.md`](bygg-selv.md).

**digital lommebok** - appen der innbyggeren lagrer digitale bevis om seg selv og selv
velger hva som deles, og med hvem. Følger av eIDAS 2.0. Ingenting i sandkassen
etterligner den; Digdir driver sin egen sandkasse for lommeboken, og
[`docs/bygg-selv.md`](bygg-selv.md) forklarer hvordan du kobler deg på.

**digitalt bevis** - en opplysning om innbyggeren, utstedt og signert av noen som har
hjemmel til å si den, og som innbyggeren kan vise fram selv fra en digital lommebok.
Ikke i sandkassen - se [`docs/bygg-selv.md`](bygg-selv.md).

**eIDAS 2.0** - EU-forordningen som pålegger medlemslandene å tilby digital lommebok, og
som avgjør hva bevisene i den skal se ut som.

**barneomsorgsattest** - politiattesten som kreves av den som skal ha omsorg for eller
oppgaver overfor mindreårige, hjemlet i politiregisterloven § 39 første ledd. Den viser
et snevrere utvalg lovbrudd enn en uttømmende attest - de som er relevante for å beskytte
barn. Brukes i barnehage, skole og SFO.

**bekreftelse på formål** - dokumentet kommunen gir den som skal søke om politiattest, og
som sier hvilket formål og hvilken hjemmel kontrollen bygger på. Innbyggeren legger det
ved søknaden til politiet. I sandkassen: `GET /api/vandel/formaal`.

**Fiks** - KS' plattform for felleskomponentene kommunene deler: registeroppslag, samtykke,
oppgaver og utsending. I sandkassen etterlignes hele plattformen av `fiks-simulator` (`:8081`).

**gnr/bnr** - gårds- og bruksnummer: nummeret som identifiserer en matrikkelenhet (en eiendom)
innenfor en kommune. Verktøyet `matrikkel_hent_eiendom` i `tools-api` slår opp på det.

**grunnbok** - det tinglyste eierregisteret. Matrikkelen sier hva en eiendom er, grunnboken
hvem som eier den - derfor ligger eierskapet i egen fil, `data/eierforhold.json`, som
`matrikkel-mock` slår sammen med matrikkeldataene ved innlasting.

**hjemmel** - rettslig grunnlag for å gjøre noe, for eksempel lese en dataressurs. En `403`
fra backend er hjemmelslaget som virker - feil hjemmel eller manglende samtykke - ikke en
feil i sandkassen. `401` betyr bare at tokenet mangler eller er utløpt.

**kode 6** - strengt fortrolig adresse i Folkeregisteret. Slike personer maskeres ved
innlasting (`apps/shared/skjerming.ts`): API-et viser «Skjermet person», mens seedfila med
vilje står i klartekst. Kode 7 (fortrolig adresse) gir nullet adresse.

**KRR** - Kontakt- og reservasjonsregisteret: innbyggerens e-post, telefon og eventuelle
reservasjon mot digital post. Ligger i `data/krr.json`, serveres av `fiks-simulator`, og
avgjør kanalen i SvarUt - reservert betyr print.

**Maskinporten-scope** - Maskinporten utsteder token til maskiner, og scopet i tokenet er
selve hjemmelen: ett scope per Fiks-flate (`ks:fiks:samtykke`, `ks:fiks:svarut`, …). Et
innbyggertoken fra ID-porten avvises der med `403 KREVER_MASKINPORTEN`. Begge utstederne
etterlignes av `digdir-mock` (`:8086`).

**matrikkel** - Norges offisielle register over eiendommer, adresser og bygninger
(Kartverket). I sandkassen er det `matrikkel-mock` (`:8085`), som svarer på både SOAP og
REST. Eierskap står ikke der - se grunnbok.

**MinID** - den enkleste elektroniske ID-en, og den første man kan få: den kan bestilles fra
det året man fyller 13. Derfor kan ingen testperson under 13 logge inn i sandkassen.

**PID** - identitetsbeviset i en digital lommebok: det som sier hvem innbyggeren er, og
det de andre bevisene henger på. Ikke i sandkassen - der er det ID-porten som svarer på
det spørsmålet.

**politiattest** - utskrift som viser om en person er siktet, tiltalt, har vedtatt
forelegg eller er dømt for bestemte lovbrudd. Utstedes av politiet til innbyggeren, som
framviser den selv - det finnes ingen API, og kommunen kan ikke slå den opp. Hvilke
lovbrudd som står der, følger av formålet. Se
[`apps/politiattest-mock/README.md`](../apps/politiattest-mock/README.md).

**rettslig handleevne** - å kunne opptre på egen hånd overfor forvaltningen, fra fylte 18.
En 15-åring kan logge inn, men er bare part i saken: å starte en prosess gir `403` som
navngir de foresatte som kan være avsender. Regelen ligger i `apps/shared/handleevne.ts`.

**rolleId** - leddet i Fiks-stiene (`/register/api/v1/ks/{rolleId}/…`) som sier hvilken
rolle kommunen spør i. Den snevrer inn innenfor scopet: Folkeregisterflaten gir bare
informasjonsdelene rollen har hjemmel til, og ukjent rolleId er `403 UKJENT_ROLLE`.

**SvarUt** - Fiks-tjenesten for utsending av post fra det offentlige, digitalt eller på
papir. Innsending oppretter en forsendelse hos `fiks-simulator`; KRR avgjør kanalen ved
opprettelse, og statusen (MOTTATT → SENDT_DIGITALT/SENDT_PRINT → LEST/PRINTET) utledes av
tiden siden.
Kvitteringen vises i `/chat`.

**Tenor** - Skatteetatens testdatasøk, kilden til den syntetiske befolkningen. Et syntetisk
fødselsnummer kjennes igjen på at 80 er lagt til måneden. Råuttrekkene ligger i `data/tenor/`.

**vandelskontroll** - å kontrollere en persons vandel ved å kreve politiattest. Krever
hjemmel i lov eller forskrift, jf. politiregisterloven § 36, og formålet avgjør hvilken
attesttype som utstedes. Kommunen ser attesten, registrerer at kontrollen er gjort, og
skal ikke beholde dokumentet lenger enn formålet krever.

**utsteder** - den som lager et digitalt bevis og signerer det, slik at et brukersted kan
stole på det uten å spørre utstederen. Digdir skriver «utstedar». Ikke i sandkassen - se
[`docs/bygg-selv.md`](bygg-selv.md).

---

## Neste steg

**Vil du se ordene i bruk?** [`docs/deltakerstart.md`](deltakerstart.md) er der du møter
de fleste av dem første gang, og [`docs/oppdraget.md`](oppdraget.md) forklarer hvorfor
sandkassen er bygget rundt dem.

**Tilbake til kartet:** [`docs/README.md`](README.md).
