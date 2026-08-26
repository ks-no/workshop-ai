# Demo-prosesser

Fem publiserte prosesser og én mal ligger i `data/prosessdefinisjoner.json`. Malen
ligger under `maler`, ikke `prosesser`, og vises bare i API-et når du ber om den:

```bash
curl -s "http://localhost:8080/api/prosesser"                    # 5 publiserte
curl -s "http://localhost:8080/api/prosesser?inkluderMaler=true" # + mal-enkel-soknad
```

Alt om casene bor i `docs/prosessmodell.md`: tabellen over hva hver prosess dekker og
hvilken testbruker som passer, stegtypene, kravet om at `api.url` må finnes i
ressurskatalogen, `{svar.<stegId>}`-substitusjonen og oppskriften for å lage en ny case.

Kjøre en flyt ende-til-ende med curl: `examples/curl/README.md`.
Verifisere en ny case: `pnpm test` (referanseintegritet) og `pnpm test:kontrakt`.
