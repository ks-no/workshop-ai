# Sikkerhetskopier av kjøretilstanden

`./start.sh --reset` sletter `state/`. Før den gjør det, legger den en kopi her, i en
katalog per kjøring: `_backup/20260908-090435-utc/`.

Grunnen er `state/ai-trace.jsonl`, som er eneste sted inn- og utdata fra modellkallene
finnes. Til forskjell fra `state/` er denne katalogen derfor **ikke** gitignorert:
innholdet er syntetisk, og poenget er at det skal kunne følge med ut av maskinen.

Signeringsnøkkelen utelates, siden en privat RSA-nøkkel ikke hører i noe som kan bli
committet. Vil du bli kvitt kopiene, kan du slette katalogene her for hånd. Ingenting
leser dem.

Hva de enkelte filene inneholder, står i [`docs/hva-logges.md`](../docs/hva-logges.md).
