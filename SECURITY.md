# Sikkerhet

## Slik melder du fra

Bruk **Report a vulnerability** under fanen Security på
<https://github.com/ks-no/workshop-ai/security>. Da havner meldingen privat hos dem som
vedlikeholder repoet, og ikke i en åpen issue.

Har du ikke GitHub-konto, gå gjennom `fiks@ksdigital.no` og skriv i emnefeltet at det
gjelder en sårbarhet i `workshop-ai`.

Du får svar innen en uke. Finner vi noe som må rettes, sier vi fra når det er gjort.

**Ikke send ekte personopplysninger, tokens eller kundedata i meldingen.**
`docs/testpersoner.md` har personene du skal bruke for å vise hva som skjer.

## Hva som er verdt å melde

Sandkassen kjører lokalt på din egen maskin med syntetiske data, så det som betyr noe
er om en av sperrene ikke holder det den lover:

- inntektsdata eller andre beskyttede oppslag som slipper gjennom uten gyldig samtykke
- et token for én person som åpner en annen persons data
- skjermingen i `apps/shared/skjerming.ts` som slipper gjennom noe den skal maskere
- noe som forlater maskinen uten at det står i [`docs/hva-logges.md`](docs/hva-logges.md)
- en avhengighet eller et image med en kjent sårbarhet

## Hva som ikke er en sårbarhet her

Sandkassen er åpen med vilje, og disse er valgte egenskaper, ikke feil:

- alle tjenestene svarer `Access-Control-Allow-Origin: *`, så din egen frontend på din
  egen port når dem
- portene er publisert på maskinen som kjører den
- `state/` og `_backup/` ligger i klartekst på disk, KI-sporet med fulle prompter
  inkludert. Det er hele poenget: du skal kunne se hva modellen fikk
- alle syntetiske data er lesbare for den som har riktig token
- `digdir-mock` validerer klientassertionen på form og ikke på signatur

[`docs/sikkerhet-og-personvern.md`](docs/sikkerhet-og-personvern.md) forklarer hva som
faktisk håndheves, og [`docs/hva-logges.md`](docs/hva-logges.md) hva som lagres hvor.

## Bygger du videre på dette?

Sandkassen er ikke produksjonsklar, og den er ikke ment å være det. Tar du med deg noe
herfra inn i en løsning med ekte data, er det tre ting som må vurderes på nytt:

- **Rensingen foran modellen er et gulv, ikke et tak.** `utenIdentifikatorer` i
  `apps/ai-gateway/src/sporsmaalsperrer.ts` fjerner fem feltnavn. Navn, fødselsdato,
  adresse og beløp går gjennom, og fire av KI-rutene har ingen rensing i det hele tatt.
  Det er greit når alt er syntetisk. Det er det ikke ellers.
- **Tokenmocken er ikke ID-porten.** `digdir-mock` utsteder nøkler den lager selv.
- **Vilkårene er demodata.** Satsene i `data/satser.json` må sjekkes mot gjeldende
  forskrift før de brukes til noe annet enn demo.
