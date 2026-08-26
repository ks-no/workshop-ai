# Prosessbygger

**For deg som vil se eller endre en prosessdefinisjon uten å redigere JSON i repoet.**
Lister prosessene fra backend, viser stegene i hver flyt, og lar deg opprette og lagre
nye. Bygger du en egen frontend i stedet, trenger du ikke lese videre.

Stack: statisk HTML og JavaScript, servert av en innebygd Node HTTP-server på `3000`.
Null avhengigheter.

Prosessene hentes fra `sandbox-backend` (`GET /api/prosesser`). Vil du se malen også:
`GET /api/prosesser?inkluderMaler=true`.

Dette er et **referanseverktøy, ikke en strategisk binding.** Prosessformatet kan
erstattes eller adapteres til Altinn Studio senere, og teamene står fritt til å bygge
egne redigeringsverktøy. Se `docs/architecture.md`.
