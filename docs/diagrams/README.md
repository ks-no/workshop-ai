# Diagrammer / Diagrams

[Norsk README](../../README.md) · [English README](../../README.en.md) · [Arkitektur / Architecture (NO)](../agentic-architecture.md)

Diagrammene bruker norske etiketter. Overskrifter og sammendrag finnes også på engelsk.
GitHub viser Mermaid-blokkene direkte i forhåndsvisningen av denne Markdown-filen.

The diagrams use Norwegian labels, with bilingual headings and summaries.
GitHub renders the Mermaid blocks in this Markdown file’s preview; see
[GitHub’s diagram documentation](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams).

Mermaid-kildefilene i denne mappen er redigeringsgrunnlaget. Ved endringer må den
tilsvarende blokken nedenfor oppdateres. PNG/SVG-versjoner for appen lages med
[`npm run diagrams:render`](../../scripts/render-diagrams.mjs).

The Mermaid source files in this directory are the editable originals. When changing
one, update its matching block below. Use [`npm run diagrams:render`](../../scripts/render-diagrams.mjs)
to refresh the app’s PNG/SVG versions.

## Arkitektur / Architecture

Ansvar og systemgrenser. / Responsibilities and system boundaries.

[Kilde / Source](agentic-architecture.mmd) · [SVG](../../public/diagrams/agentic-architecture.svg)

```mermaid
flowchart TB
  accTitle: Søk én gang – Node, Python og modellansvar
  accDescr: Next.js eier sak og menneskelige porter. En eid Python-prosess bruker Microsoft Agent Framework til planlegging, parallell fordeling og samling. Private JSONL-meldinger kobler til Node-verktøy.
  U["Innbygger<br/>fritt spørsmål · dokument · samtykke"]
  subgraph LOCAL["På appens maskin"]
    UI["Punkt-grensesnitt · NO / EN<br/>samtale · kontekstuell handling · plan"]
    subgraph NODE["Next.js / Node"]
      HOST["Assistant-API og sakstjeneste<br/>hensikt · saks-ID · revisjon · porter"]
      DOMAIN["Kildekontroll og domeneverktøy<br/>KS-vurdering · bolig · flytting"]
      DB[("SQLite<br/>kilder · fakta · samtale · spor")]
    end
    PY["Én eid Python-prosess per analyse<br/>Microsoft Agent Framework<br/>Agent · WorkflowBuilder"]
  end
  subgraph KS["Offisiell KS workshop · lokale syntetiske API-er"]
    KSB["sandbox-backend · 8080<br/>husstand · SFO · satser<br/>inntekt og SFO-regelvurdering"]
    KSF["Fiks-simulator · 8081<br/>uttrykkelig inntektssamtykke"]
    KSD["Digdir-simulator · 8086<br/>signerte testtoken"]
  end
  MODEL["AI model<br/>koordinerer behov og tjenester<br/>spesialistagenter analyserer"]
  U --> UI --> HOST
  HOST -->|Bare etter kontekstuelt ja| KSB
  HOST -->|Registrer og kontroller samtykke| KSF
  HOST -->|Testautentisering| KSD
  HOST <--> DOMAIN
  HOST <--> DB
  HOST <-->|Privat JSONL via standard inn og ut| PY
  PY <-->|Avgrenset kontekst og JSON-svar| MODEL
  classDef human fill:#fff1d6,stroke:#946000,color:#362a0e
  classDef model fill:#ece9ff,stroke:#6654b4,color:#252040
  classDef storage fill:#e2f2ec,stroke:#287460,color:#163b31
  class U human
  class PY,MODEL model
  class DB storage
```

## Arbeidsflyt / Workflow

Fra spørsmål til gjennomgått plan. / From a question to a reviewed plan.

[Kilde / Source](agentic-workflow.mmd) · [SVG](../../public/diagrams/agentic-workflow.svg)

```mermaid
flowchart TB
  accTitle: Søk én gang – agenten finner behovet og ber om data ved behov
  accDescr: Innbyggeren skriver fritt. Koordinatoren skiller informasjon fra personlig forberedelse, velger tjenester og viser en menneskelig port bare når KS-data er nødvendig.
  A["Innbygger beskriver behovet<br/>ingen kategori velges"]
  N["Node: lagre kilde, ny revisjon<br/>og start Python-prosess"]
  P["AI model · koordinator<br/>språk · hensikt · tjenester"]
  VALID{"Gyldig og kildebundet plan?"}
  ERROR["Bevar saken og vis nytt forsøk"]
  INTENT{"Hensikt"}
  INFO["Offentlig informasjon<br/>ingen personoppslag"]
  PERSONAL["Personlig forberedelse"]
  FAMILY{"Familie / SFO valgt<br/>og KS-grunnlag mangler?"}
  ACTION["Handling kreves i samtalen<br/>forklar data, kilde og formål"]
  CHOICE{"Innbyggerens valg"}
  KS["Samtykk: hent husstand, SFO,<br/>inntekt og KS-resultat"]
  MANUAL["Avslå: ingen KS-kall<br/>vis manuelle spørsmål"]
  REANALYZE["Ny analyse starter automatisk"]
  FAN["Framework fordeler valgte tjenester<br/>spesialistagenter kjører parallelt"]
  SAVE["Node kontrollerer og lagrer<br/>fakta · kilder · sjekklister"]
  REVIEW["Innbygger retter og avklarer<br/>KI-forslag og konflikter"]
  READY["Lokal pakke etter siste<br/>menneskelige gjennomgang"]
  A --> N --> P --> VALID
  VALID -->|Nei| ERROR --> N
  VALID -->|Ja| INTENT
  INTENT -->|Informasjon| INFO --> FAN
  INTENT -->|Personlig| PERSONAL --> FAMILY
  FAMILY -->|Ja| ACTION --> CHOICE
  CHOICE -->|Ja| KS --> REANALYZE --> N
  CHOICE -->|Nei| MANUAL --> A
  FAMILY -->|Nei| FAN
  FAN --> SAVE --> REVIEW --> READY
  classDef human fill:#fff1d6,stroke:#946000,color:#362a0e
  classDef model fill:#ece9ff,stroke:#6654b4,color:#252040
  classDef error fill:#fff0ed,stroke:#ac4934,color:#54271d
  class ACTION,CHOICE,REVIEW human
  class P,INTENT,FAN model
  class ERROR error
```

## Sekvens / Sequence

Samspill mellom innbygger, app og tjenester. / Interaction between the citizen, app and services.

[Kilde / Source](agentic-sequence.mmd) · [SVG](../../public/diagrams/agentic-sequence.svg)

```mermaid
sequenceDiagram
  accTitle: Søk én gang – naturlig samtale med kontekstuelt samtykke
  accDescr: Agenten velger tjeneste og hensikt fra fritekst. Generelle spørsmål besvares uten personoppslag. En personlig SFO-vurdering stopper ved en menneskelig port før KS-data hentes.
  actor U as Innbygger
  participant W as Punkt-grensesnitt
  participant N as Node / sakstjeneste
  participant D as SQLite
  participant P as Python / Agent Framework
  participant M as AI model
  participant K as Offisiell KS workshop
  U->>W: Beskriv behov med egne ord
  W->>N: Melding, saks-ID og revisjon
  N->>D: Lagre melding og kilde
  N->>P: Start eid prosess
  P->>M: Koordiner språk, hensikt og tjenester
  M-->>P: Informasjon eller personlig plan
  P-->>N: Kildebundet plan via JSONL
  alt Generelt informasjonsspørsmål
    N-->>P: Valgte veiledningskilder, ingen persondata
    P->>M: Spesialistagent analyserer
    M-->>P: Forklaring med kilder
    P-->>N: Kontrollert svar
    N-->>W: Svar og kilder
  else Personlig SFO-vurdering uten KS-grunnlag
    N-->>W: Handling kreves i samtalen
    alt Innbygger samtykker
      U->>W: Samtykk, hent og fortsett
      W->>N: Ett valg med saks-ID og revisjon
      N->>K: Testtoken, husstand, SFO og satser
      N->>K: Registrer og kontroller inntektssamtykke
      N->>K: Les inntekt og SFO-regelvurdering
      K-->>N: Syntetiske svar og deterministisk resultat
      N->>D: Minimerte kilder og samtykkekvittering
      N->>P: Start ny analyse automatisk
      P->>M: Koordinator og valgte spesialistagenter
      M-->>P: Oppdatert analyse
      P-->>N: Kontrollerte funn og spørsmål
      N-->>W: Oppdatert samtale og plan
    else Innbygger avslår
      U->>W: Fortsett uten KS
      W->>N: Avslag med saks-ID og revisjon
      N->>D: Lagre menneskelig valg
      N-->>W: Vis manuelle spørsmål
    end
  end
  Note over W,N: KI velger neste relevante steg.<br/>Node håndhever samtykke, revisjon og fakta.
```

## Dataflyt / Data flow

Kilder, modellkontekst og bekreftelse av fakta. / Sources, model context and fact confirmation.

[Kilde / Source](agentic-data-flow.mmd) · [SVG](../../public/diagrams/agentic-data-flow.svg)

```mermaid
flowchart TB
  accTitle: Søk én gang – minst mulig data gjennom hvert steg
  accDescr: Offentlig veiledning kan brukes uten persondata. Personlige KS-data passerer bare etter et uttrykkelig, kontekstuelt valg og lagres med kilde og formål.
  INPUT["Fritekst · skjemasvar<br/>TXT / tekst-PDF"]
  SRC[("SQLite-kilder<br/>originaltekst · side · formål · tid")]
  PREP["Node avgrenser kontekst<br/>språk · hensikt · faktaminne"]
  PY["Python / Agent Framework<br/>planlegger · spesialister · join"]
  MODEL["AI model<br/>koordinator · spesialistagenter"]
  PUBLIC["Offentlig veiledning<br/>ingen personoppslag"]
  ACTION["Handling kreves<br/>forklar data, kilde og formål"]
  CONSENT["Innbygger samtykker<br/>saks-ID og revisjon kontrolleres"]
  DECLINE["Innbygger avslår<br/>ingen KS-forespørsel"]
  KS["KS workshop<br/>husstand · SFO · satser"]
  INCOME["Fiks-samtykke<br/>inntekt · SFO-resultat"]
  VERIFY["Node: Zod og kildekontroll<br/>sitat · linjer · verdi"]
  FACT[("Faktaminne<br/>foreslått · konflikt · bekreftet")]
  VIEW["Samtale · spørsmål · plan<br/>svar og kilder"]
  INPUT --> SRC --> PREP --> PY
  PY <-->|Utvalgt kontekst og strukturert resultat| MODEL
  PUBLIC --> PREP
  PY -->|Personlig SFO trenger data| ACTION
  ACTION -->|Ja| CONSENT --> KS --> SRC
  CONSENT --> INCOME --> SRC
  ACTION -->|Nei| DECLINE --> VIEW
  SRC --> VERIFY
  PY --> VERIFY --> FACT --> VIEW
  FACT -->|Menneskelig retting og avklaring| FACT
  classDef human fill:#fff1d6,stroke:#946000,color:#362a0e
  classDef model fill:#ece9ff,stroke:#6654b4,color:#252040
  classDef storage fill:#e2f2ec,stroke:#287460,color:#163b31
  class ACTION,CONSENT,DECLINE human
  class PY,MODEL model
  class SRC,FACT storage
```

## Livsløp / Lifecycle

Fakta, sakslagring og analyseforløp. / Facts, case storage and analysis runs.

[Kilde / Source](agentic-lifecycle.mmd) · [SVG](../../public/diagrams/agentic-lifecycle.svg)

```mermaid
flowchart TB
  accTitle: Søk én gang – varig saksminne og kortlevd agentprosess
  accDescr: Node lagrer saken i SQLite med absolutt 24 timers levetid. Hver analyse bruker en ny Python-prosess. Ingen separat framework-hukommelse eller checkpoint erstatter menneskelig bekreftelse.
  subgraph FACTS["Faktumets livsløp · Node bevarer kilde og historie"]
    direction TB
    A["Kildekontrollert kandidat"]
    P["Foreslått eller konflikt"]
    H["Menneskelig avklaring"]
    OK["Bekreftet<br/>brukes på tvers av tjenester"]
    NO["Avvist · beholdes i historikken"]
    OLD["Erstattet etter bekreftet ny verdi"]
    A --> P --> H
    H -->|Bekreft| OK
    H -->|Avvis| NO
    OK -->|Ny verdi bekreftes| OLD
  end
  subgraph CASE["Sakens levetid · autoritativt minne i Node"]
    direction TB
    NEW["Ny sak"]
    DB[("SQLite<br/>24 timer fra opprettelse<br/>inkludert kilder og samtykkekvittering")]
    LOAD["Reload eller serverrestart<br/>samme cookie og datakatalog"]
    DEL["Slettet ved brukerhandling<br/>eller opprydding etter utløp"]
    NEW --> DB --> LOAD
    LOAD -->|Gyldig sak| DB
    DB --> DEL
    KEEP["KS sin historikk og nedlastede filer<br/>slettes ikke av lokal sletting"]
    DEL -.-> KEEP
  end
  subgraph RUN["Én analyse · ingen varige framework-checkpoints"]
    direction TB
    START["Node starter Python<br/>under lås og ny revisjon"]
    WORK["Agent Framework<br/>planlegger · grener · join"]
    END["Resultat lagres i Node<br/>Python avsluttes"]
    FAIL["Avbrudd eller feil<br/>bevar saksdata og analyser på nytt"]
    START --> WORK --> END
    WORK --> FAIL
  end
  classDef human fill:#fff1d6,stroke:#946000,color:#362a0e
  classDef storage fill:#e2f2ec,stroke:#287460,color:#163b31
  classDef model fill:#ece9ff,stroke:#6654b4,color:#252040
  class H human
  class DB,OK storage
  class WORK model
```

