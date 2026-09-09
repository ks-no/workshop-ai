# Digital Lommebok (EUDI Wallet Sandkasse)

En minimal React-applikasjon i KS-sandkassen som lar deltakere på hackathonet utstede og verifisere bevis ved hjelp av syntetiske data fra `workshop-ai`, integrert mot `eudiw-verifier-service`.

## Funksjonalitet

### 1. Utsted bevis (Issuer)
- **Velg bevis**: Støtter seks bevis som utstedes av bevisgeneratoren i testmiljøet:
  - **Politiattest (barneomsorgsattest)** (`net.eidas2sandkasse:ks_hackathon_politiattest_sd_jwt_vc`)
  - Norsk ID-bevis (PID)
  - Digital kontaktinformasjon (KRR)
  - Barnehageplass
  - Kommunalt ledsagerbevis
  - Inntektsbevis
- **Tast inn / velg fødselsnummer**: Slår opp direkte mot de 394 syntetiske testpersonene i KS-sandkassen og validerer fødselsnummeret.
- **Forhåndsvisning**: Genererer bevisdata ferdig utfylt med personens navn, fødselsdato, kommune og registeropplysninger.
- **QR-kode fra utsteder**: Genererer standard OpenID4VCI Credential Offer URI (`openid-credential-offer://`) og QR-kode som kan skannes direkte inn i en digital lommebok (EUDI Wallet).

### 2. Verifiser bevis (Verifier)
- **DCQL-spørring**: Genererer automatisk Digital Credentials Query Language (DCQL) for valgt bevis.
- **Integrasjon mot Verifier Service**:
  - `POST /api/v1/bevisgenerator-login/verify/start/`: Initierer verifisering og mottar presentasjons-QR-kode.
  - `GET /api/v1/bevisgenerator-login/verify/status/{id}`: Poller status (`WAIT`, `AVAILABLE`).
  - `GET /api/v1/bevisgenerator-login/verify/result/{id}`: Henter kryptografisk verifiserte claims.
- **Simulering**: Mulighet for å simulere fullført skanning i testmiljø uten fysisk lommebok til stede.

### 3. Åpent API for hackathon-deltakere
Når et bevis verifiseres, kan deltakernes egne applikasjoner hente ut resultatet i sanntid via vårt åpne REST-endepunkt:

```bash
curl -X GET "http://localhost:3002/api/verifikasjon/<transaction_id>" \
  -H "X-API-KEY: KS-HACKATHON"
```

### 4. Utviklerpanel (Developer Experience)
Under fanene vises alle utgående og inngående API-kall i sanntid, inkludert headers med `X-API-KEY: KS-HACKATHON`, payload, og ferdige `curl`-kommandoer som kan kopieres med ett klikk.

## Miljøer

Applikasjonen er konfigurert til å gå mot det offisielle **testmiljøet**:
- **Issuer Server (Bevisgenerator)**: `https://utsteder.test.eidas2sandkasse.net/bevisgenerator`
- **Verifier Service**: `https://verifier-service.test.eidas2sandkasse.net`

Utviklerserveren på port 3002 proxier verifier-kallene gjennom `/api/v1` for å unngå CORS-utfordringer i nettleseren.

## Kjøre applikasjonen

Fra rotmappen til `workshop-ai`:
```bash
# Start sammen med resten av sandkassen
./start.sh --mock

# Eller start bare tjenesten med Compose
docker compose up lommebok
```

For lokal utvikling uten Compose:
```bash
cd apps/lommebok
pnpm dev
```

Applikasjonen kjører på `http://localhost:3002`.
