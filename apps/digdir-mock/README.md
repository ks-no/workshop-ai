# digdir-mock

**For deltakere som får 401.** Mock av **Maskinporten** og **ID-porten** - to utstedere i
én prosess, med ulik `iss`, fordi de er to porter med ulikt formål.

| | Hvem | Beviser | Bærer |
|---|---|---|---|
| **Maskinporten** | en maskin | hvilken *organisasjon* som kaller, og hva den får gjøre | `scope`, `client_id` |
| **ID-porten** | en person | *hvem* innbyggeren er, og hvor sterkt hen ble autentisert | `pid`, `acr` |

Port `8086`. Spesifikasjon på `/openapi.yaml`, lesbar på `/docs`, helse på `/helse`.

## Derfor møter du den

`AUTH_ENFORCE` er **på** som standard, og alt som ikke er uttrykkelig åpent krever token.
Uten `Authorization` får du `401`. Med token, men uten hjemmel, får du `403`. Skillet er
poenget:

```
401  vi vet ikke hvem du er          (autentisering - her)
403  vi vet, og du får likevel ikke  (hjemmel - i sandbox-backend)
```

Håndhevingen ligger i `apps/sandbox-backend/src/autentisering.ts`, ikke her. Denne
tjenesten deler bare ut tokener.

## Få et token

```bash
# som innbygger
export TOKEN=$(node scripts/token.ts --innbygger person-001)

# som maskin, mot en bestemt tjeneste
export TOKEN=$(node scripts/token.ts --maskinporten ks:fiks:register --resource fiks-simulator)

curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/personer/person-001/husstand
```

Slipper du å huske hvilket token en rute vil ha: <http://localhost:3001/utforsker> velger
det ut fra hjemmelen ruten krever, og skriver ut en `curl` som virker når den limes inn.

`pnpm token` treffer pnpms egen innebygde kommando - kall skriptet direkte.

## Hvem kan logge inn

Ikke alle testpersoner, og det er med vilje. Aldersgrensene bor **ett sted**,
`apps/shared/handleevne.ts`, som både denne tjenesten og prosessmotoren
importerer - så de kan ikke bli uenige.

- **Under 13 år: ingen innlogging.** MinID kan bestilles fra året man fyller 13, så en
  elektronisk ID finnes ikke før det. De står ikke i velgeren.
- **13–17 år: kan logge inn, men er bare part i saken.** Å opptre selv overfor en kommune
  krever rettslig handleevne, altså 18 år.
- **Død, utflyttet eller D-nummer: ingen innlogging.**

`GET /idporten/testbrukere` lister dem som kan. `docs/testpersoner.md` har hele
befolkningen med en `Logg inn`-kolonne.

## Ruter

| Rute | Hva |
|---|---|
| `POST /token` | Maskinporten, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` |
| `GET /idporten/authorize` | starter innlogging, redirecter tilbake med `code` |
| `POST /idporten/token` | bytter `code` i `access_token` og `id_token` |
| `GET /idporten/testbrukere` | hvem som kan logge inn |
| `GET /jwks`, `/jwk` | de offentlige nøklene, for verifisering |

## Bevisste forenklinger

Begge står som kommentar i koden, på ett sted hver, slik at de er lette å finne:

- **Klientassertionen i `jwt-bearer` valideres på *form*, ikke på signatur.** Ekte
  Maskinporten har en registrert offentlig nøkkel per klient. Vi har ikke noe
  nøkkelregister, så enhver velformet assertion godtas og `iss` tas som `client_id`.
  Det er greit her fordi leksjonen ligger på ressursserveren - men ingen andre steder.
- **Nøklene genereres ved oppstart.** `docker compose up -d` gir tjenesten nye nøkler,
  og andre tjenester kan cache et token signert med den gamle. Symptomet er
  «Tokenet er signert med en nøkkel utstederen ikke kjenner». Fiks:
  `docker compose restart tools-api process-agent sandbox-backend fiks-simulator`.

Verifiseringen (`src/verify.ts`) deles med `sandbox-backend`, `fiks-simulator` og
`pasientjournal-mock`, så det finnes bare én implementasjon av «er dette tokenet
gyldig». `src/tokenport.ts` er neste lag: porten en ressursserver setter foran en
maskinflate, delt av de to som har en slik flate.
