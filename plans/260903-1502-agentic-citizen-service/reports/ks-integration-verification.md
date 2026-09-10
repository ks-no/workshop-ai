# KS integration verification

Verified against the official local KS workshop services at pinned upstream revision `656a5c69edbddad4b0e3f194c44289f12f09ef0d`.

- Health: sandbox-backend 8080, Fiks simulator 8081 and Digdir mock 8086 returned `ok`.
- Authentication remained enabled. Tokens came from the upstream ID-porten/Maskinporten test flows.
- Initial read produced `ks-household`, `ks-sfo` and `ks-rates`.
- Explicit Fiks consent returned status `SAMTYKKET` for the configured test person and bounded SFO purpose.
- Post-consent reads produced `ks-income` and `ks-assessment`.
- Stored evidence omits person, household and birth-number identifiers; token values were never printed or stored.
- Browser flow verified that consent is unchecked after reload, no model runs during register reads, no facts become auto-confirmed, provenance remains visible, and the source panel passes WCAG 2A/AA checks.
