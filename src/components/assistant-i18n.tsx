'use client';

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { FactKey, ServiceCheck, ServiceId } from '../domain/assistant-types';

export type UiLocale = 'nb' | 'en';
export const UI_LOCALE_KEY = 'sok-assistant-ui-language';
const translations: Record<string, string> = {
  'Skjema': 'Form', 'redusert SFO-betaling': 'reduced SFO payment', 'Avklarer om skjemaet er aktuelt': 'Checking whether the form applies', 'Venter på samtykke': 'Awaiting consent',
  'Mangler opplysninger': 'Missing information', 'Klart til kontroll': 'Ready for review', 'Ikke aktuelt nå': 'Not applicable now',
  'Kan jeg hente opplysninger for deg?': 'May I fetch information for you?', 'Opplysningene er hentet': 'The information has been fetched',
  'Assistenten har bedt om tilgang til disse kildene for å forberede saken. Ingenting hentes før du velger.': 'The assistant has asked for access to these sources to prepare your case. Nothing is fetched until you choose.',
  'Agentene fortsatte automatisk med de nye kildene og fylte ut søknadsutkastet. Du kan kontrollere og rette opplysningene i oversikten.': 'The agents continued automatically with the new sources and filled in the application draft. You can check and correct the information in your overview.',
  'Vi fortsetter uten å hente opplysninger': 'We continue without fetching information', 'Fortsett uten å hente': 'Continue without fetching', 'Foreslått av koordinatoren.': 'Suggested by the coordinator.',
  'Jeg samtykker til at disse syntetiske opplysningene hentes for denne vurderingen.': 'I consent to these synthetic details being fetched for this assessment.',
  'Husstand, SFO-plass og satser': 'Household, SFO place and rates', 'Inntektsgrunnlag fra Skatteetaten': 'Income basis from Skatteetaten',
  'Kommunen via KS workshop API': 'The municipality via the KS workshop API', 'Skatteetaten via KS Fiks samtykke': 'Skatteetaten via KS Fiks consent',
  'Søknadsutkast': 'Application draft', 'felt fylt': 'fields filled', 'Fylt ut': 'Filled in',
  'Søknad om redusert foreldrebetaling i SFO (utkast)': 'Application for reduced SFO parental payment (draft)',
  'Utkastet er fylt fra bekreftede opplysninger og hentede registerutdrag. Kontroller feltene; ingenting er sendt.': 'The draft is filled from confirmed information and fetched register excerpts. Check the fields; nothing has been submitted.',
  'Husstand': 'Household', 'Husstandsmedlemmer': 'Household members', 'Barnet bruker SFO': 'The child uses SFO', 'SFO-plass': 'SFO place', 'Inntektsår': 'Income year',
  'Husholdningens årsinntekt': 'Household annual income', 'Hva inntekten gjelder': 'Income basis', 'Vesentlig og varig inntektsendring (mistet jobb)': 'Significant lasting income change (job lost)',
  'Endring i husstanden': 'Household change', 'KS regelresultat (veiledende)': 'KS rule result (indicative)', 'Signatur og innsending': 'Signature and submission',
  'Hentet fra kommunen etter samtykke.': 'Fetched from the municipality after consent.', 'Hentet fra Skatteetaten via KS Fiks etter samtykke.': 'Fetched from Skatteetaten via KS Fiks after consent.',
  'Hentet fra register etter samtykke.': 'Fetched from a register after consent.', 'Bekreftet av deg i samtalen.': 'Confirmed by you in the conversation.',
  'Gjøres av deg i kommunens tjeneste. Demoen sender ingenting.': 'Done by you in the municipality\u2019s service. The demo submits nothing.',
  'Deterministisk testresultat, ikke et vedtak. Kommunen avgjør.': 'Deterministic test result, not a decision. The municipality decides.',
  'Ingen endring meldt': 'No change reported', 'Si fra hvis samboer eller andre mangler i grunnlaget.': 'Tell us if a partner or others are missing from the basis.',
  'Hopp til innhold': 'Skip to content', 'Hackathondemo': 'Hackathon demo', 'Hackathondemo · Team Oslo': 'Hackathon demo · Team Oslo', 'Dokumentasjon': 'Documentation',
  'Bruk bare testopplysninger. Ingen søknad sendes.': 'Use test information only. No application is submitted.',
  'Søk én gang, forsiden': 'Søk én gang, home', 'Fra skjema til samtale.': 'From forms to conversation.',
  'Hovedmeny': 'Main navigation', 'SFO-sjekken': 'SFO check', 'Om løsningen': 'About this demo', 'Avslutt og slett': 'End and delete',
  'Henter saken og kontrollerer tilkoblingen…': 'Loading your case and checking the connection…',
  'Språkmodellen er konfigurert': 'Language models are configured', 'Språkmodellen er ikke tilgjengelig': 'Language models are unavailable',
  'Om tilkoblingen': 'About the connection', 'Triage:': 'Triage:', 'Utkast:': 'Draft:', 'Kritiker:': 'Critic:', 'Språkvask:': 'Proofreading:', 'Leverandør:': 'Provider:', 'Modell:': 'Model:',
  'Kontroller tilkoblingen': 'Check connection', 'Prøv å koble til igjen': 'Try connecting again',
  'Slett saken': 'Delete case', 'Slette denne demosaken?': 'Delete this demo case?', 'Behold saken': 'Keep case',
  'Samtalen, opplysningene og opplastede dokumenter fjernes. Dette kan ikke angres.': 'The conversation, information and uploaded documents will be removed. This cannot be undone.',
  'Last inn aktiv sak': 'Load active case', 'Velg visning': 'Choose view', 'Samtale': 'Conversation', 'Din oversikt': 'Your overview', 'til bekreftelse': 'awaiting confirmation',
  'Vi finner veien videre.': 'Let’s find your next steps.', 'Hva kan vi hjelpe deg med?': 'What can we help you with?',
  'Fortell med egne ord. Vi samler det som er relevant for deg, og spør om det som mangler.': 'Tell us in your own words. We gather what is relevant and ask about anything missing.',
  'Du trenger ikke velge tjeneste.': 'You do not need to choose a service.',
  'Beskriv situasjonen din, så finner agenten relevante tjenester og neste steg. Du kan for eksempel skrive om jobb, familie, bolig eller flytting i samme melding.': 'Describe your situation and the agent will find relevant services and next steps. You can mention work, family, housing or moving in the same message.',
  'Du kan for eksempel fortelle om': 'You could tell us about', 'Familie og SFO': 'Family and after-school care', 'Bolig og økonomi': 'Housing and finances', 'Bolig og bostøtte': 'Housing and housing allowance', 'Flytting': 'Moving',
  'Jeg trenger hjelp med familien min og SFO.': 'I need help with my family and after-school care (SFO).',
  'Jeg trenger hjelp med boligsituasjonen og økonomien min.': 'I need help with my housing situation and finances.',
  'Jeg planlegger å flytte og trenger hjelp med hva jeg må gjøre.': 'I am planning to move and need help with what to do.',
  'Samtalen': 'Conversation history', 'Du': 'You', 'Innbyggerassistenten · KI-tolkning': 'Citizen assistant · AI interpretation',
  'Kontroller tolkningen før du bruker den. Sjekklisten og kildene viser grunnlaget.': 'Check this interpretation before using it. The checklist and sources show its basis.',
  'Dette trenger vi å vite': 'What we need to know', 'Svar i samtalen. Det samme svaret kan brukes av flere tjenester.': 'Answer in the conversation. Several services can use the same answer.',
  'Saksgrunnlaget er klargjort.': 'Your preparation packet is ready.', 'Saksgrunnlaget er lagret.': 'Preparation packet saved.',
  'Du finner oppsummering og nedlasting i oversikten. Start på nytt ved å avslutte og slette demosaken.': 'Find the summary and download in your overview. End and delete this demo case to start again.', 'Saksgrunnlaget samler resultatet og det som fortsatt må vurderes. Det betyr ikke at spørsmålet er endelig avgjort.': 'The packet records the result and what still needs review. It does not mean that your question has been finally resolved.',
  'Se saksgrunnlaget': 'View preparation packet', 'Skriv en melding': 'Write a message', 'Hva er situasjonen din?': 'What is your situation?',
  'For eksempel: Jeg har mistet jobben og er usikker på hvordan jeg skal betale husleien.': 'For example: I have lost my job and am unsure how to pay the rent.',
  'Legg ved dokument': 'Attach document', 'Arbeider…': 'Working…', 'Send melding': 'Send message',
  'Bruk forhåndsberegnet svar': 'Use precomputed answer', 'Forhåndsberegnet svar': 'Precomputed answer', 'Hurtigtast: Alt+D': 'Shortcut: Alt+D',
  'Du kan skrive et utkast. Sending og dokumentanalyse blir tilgjengelig når språkmodellen er tilkoblet.': 'You can write a draft. Sending and document analysis become available when the language models are connected.',
  'Velg et dokument': 'Choose a document',
  'TXT eller tekstbasert PDF, inntil 1,5 MB, ti sider og 14 000 tegn. Skannede bilder støttes ikke. Bruk testdokumenter.': 'TXT or a text-based PDF, up to 1.5 MB, ten pages and 14,000 characters. Scanned images are not supported. Use test documents.',
  'Last opp og analyser': 'Upload and analyse', 'Oppdater planen': 'Update plan', 'Prøv planen på nytt': 'Retry plan', 'Oppdaterer planen automatisk': 'Updating the plan automatically', 'Din felles saksoversikt': 'Your shared case overview',
  'Du kan se kildebruk og fremdrift underveis. Dette kan ta litt tid.': 'You can follow source use and progress. This may take a little while.',
  'Fremdriften kunne ikke hentes akkurat nå. Handlingen kan fortsatt kjøre.': 'Progress could not be loaded just now. The operation may still be running.',
  'Se arbeidet som pågår': 'View work in progress', 'Se hva som har skjedd': 'View activity',
  'Arbeider': 'Working', 'Fullført': 'Completed', 'Feilet': 'Failed', 'Koordinator': 'Coordinator', 'Bolig': 'Housing', 'Systemet': 'System',
  'Startet': 'Started', 'Leste kilde': 'Read source', 'Bekreftelse': 'Confirmation', 'Stoppet for avklaring': 'Paused for clarification', 'sekunder': 'seconds',
  'Til bekreftelse': 'Awaiting confirmation', 'Bekreftet av deg': 'Confirmed by you', 'Hentet fra KS': 'Retrieved from KS', 'Avvist av deg': 'Rejected by you', 'Erstattet': 'Replaced', 'Motstridende opplysning': 'Conflicting information',
  'Forberedt': 'Prepared', 'Trenger opplysninger': 'Needs information', 'Må vurderes av en person': 'Needs human review', 'Kontroller før du går videre': 'Review before continuing', 'Du må kontrollere': 'Review this', 'Kunne ikke fullføres': 'Could not complete',
  'Svar på spørsmålet ditt': 'Answer to your question', 'Resultat for SFO-spørsmålet ditt': 'Result for your SFO question', 'Ikke avklart ennå': 'Not resolved yet', 'Data fra KS-sandkassen': 'Data from KS sandbox', 'Ja i KS-sandkassen': 'Yes in the KS sandbox', 'Nei i KS-sandkassen': 'No in the KS sandbox',
  'Det finnes ikke noe regelresultat ennå. Hent KS-opplysningene og inntektsgrunnlaget med samtykke for å få et svar fra sandkassen.': 'There is no rules result yet. Retrieve the KS information and income basis with consent to get an answer from the sandbox.',
  'KS-sandkassen svarer': 'The KS sandbox answers', 'Resultat fra syntetiske KS-data:': 'Result from synthetic KS data:', 'Ordningen som ble kontrollert er': 'The scheme checked is', 'Inntektsgrunnlag brukt av KS': 'Income basis used by KS', 'Grense i KS-sandkassen': 'Threshold in the KS sandbox', 'Årsinntekt du oppga': 'Annual income you reported',
  'Hvorfor dette ikke er et endelig svar': 'Why this is not a final answer', 'KS-resultatet bruker et annet husholdningsgrunnlag enn opplysningene du ga.': 'The KS result uses a different household basis from the information you provided.', 'Du oppga også at en partner mangler i husholdningsgrunnlaget.': 'You also reported that a partner is missing from the household information.', 'En person må avklare riktig husholdning og inntekt før spørsmålet kan besvares endelig.': 'A person must clarify the correct household and income before the question can be answered finally.',
  'Dette er et resultat for syntetiske testopplysninger, ikke et kommunalt vedtak.': 'This is a result for synthetic test information, not a municipal decision.', 'Lagret regelmelding fra KS:': 'Stored rules message from KS:',
  'Din felles oversikt': 'Your shared overview', 'Lagres i denne demoen': 'Saved in this demo',
  'Opplysningene brukes på tvers av tjenestene. Du bestemmer hva som stemmer.': 'Information is shared across services. You decide what is correct.',
  'KI-tolkning av situasjonen. Kontroller at den stemmer.': 'AI interpretation of your situation. Check that it is correct.',
  'Når du forteller om situasjonen din, samler vi opplysninger her. Ingenting er bekreftet før du sier ja.': 'As you describe your situation, we gather information here. Nothing is confirmed until you say yes.',
  'Se over': 'Review', 'opplysninger': 'facts', 'før du oppdaterer planen.': 'before updating the plan.', 'Planen oppdateres automatisk når den siste er avklart.': 'The plan updates automatically when the final proposal is resolved.',
  'Det finnes ulike verdier for denne opplysningen. Bekreft bare verdien som skal gjelde.': 'There are conflicting values for this fact. Confirm only the value that should apply.', 'Det finnes ulike verdier for denne opplysningen. Bekreft den korrigerte verdien; planen oppdateres deretter automatisk.': 'There are conflicting values for this fact. Confirm the corrected value; the plan will then update automatically.', 'Det finnes ulike verdier for denne opplysningen. Bekreft den korrigerte verdien. Når alle forslag er avklart, oppdateres planen automatisk.': 'There are conflicting values for this fact. Confirm the corrected value. When all proposals are resolved, the plan updates automatically.', 'Bekreft korrigering': 'Confirm correction', 'Bekreft og oppdater planen': 'Confirm and update plan', 'Bekreft korrigering og oppdater planen': 'Confirm correction and update plan',
  'Bekreft': 'Confirm', 'Avvis': 'Reject', 'Rett opplysningen': 'Correct fact', 'Avviste og erstattede opplysninger (': 'Rejected and replaced facts (',
  'Prøv med syntetiske registeropplysninger': 'Try synthetic register information',
  'Legg til en oppdiktet familie, SFO-plass og inntekt. Du må fortsatt kontrollere hver opplysning.': 'Add a fictional family, SFO place and income. You must still check each fact.',
  'Ja, bruk syntetiske demodata': 'Yes, use synthetic demo data', 'Ingen ekte registre kontaktes.': 'No real registers are contacted.',
  'Planen din': 'Your plan', 'Svar og kilder': 'Answer and sources', 'Trenger oppdatering': 'Needs updating',
  'Neste steg': 'Next steps', 'Se over opplysningene planen bruker': 'Review the information used by the plan',
  'Vi trenger kontrollen din før planen kan gjøres klar.': 'We need your review before the plan can be prepared.', 'venter på deg.': 'are waiting for you.',
  'Se over opplysningene': 'Review information', 'Oppdater planen med de siste opplysningene': 'Update the plan with the latest information',
  'Da får du neste handling her i samtalen.': 'Your next action will then appear here in the conversation.',
  'Planen er klar for gjennomgang': 'Your plan is ready to review', 'Vi har samlet planen.': 'We have gathered your plan.',
  'punkter': 'items', 'må følges opp av deg eller en saksbehandler.': 'need follow-up by you or a caseworker.',
  'Vi har samlet planen og opplysningene den bygger på.': 'We have gathered the plan and the information it uses.',
  'Se planen og klargjør': 'Review plan and prepare', 'Gå til siste gjennomgang': 'Go to final review', 'Se hva planen fortsatt trenger': 'See what the plan still needs',
  'Åpne planen for å se hva som må avklares videre.': 'Open the plan to see what still needs clarification.', 'Se planen': 'View plan',
  'Opplysningene er endret. Oppdater planen for å bruke siste versjon.': 'Information has changed. Update the plan to use the latest version.',
  'KI-tolkning. Kontroller mot kildene og sjekklisten.': 'AI interpretation. Check against the sources and checklist.',
  'Hvorfor denne tjenesten (KI-tolkning):': 'Why this service (AI interpretation):', 'Klart': 'Ready', 'Vurdering': 'Review', 'Mangler': 'Missing',
  'Beregnet SFO-betaling': 'Estimated SFO payment', 'per måned': 'per month', 'Mat kommer i tillegg': 'Food costs extra', 'Fast beregning i demoen ·': 'Fixed demo calculation ·',
  'Begrunnelse og kilder': 'Reasoning and sources',
  'KI-tolkninger må kontrolleres. Et ordrett sitat viser hvor teksten finnes, men beviser ikke at tolkningen er riktig.': 'AI interpretations need checking. A literal quote shows where the text appears, but does not prove that the interpretation is correct.',
  'Dette må du få hjelp med': 'Where you need further help',
  'Demoen kan forberede familie/SFO, bolig og flytting. Andre tjenester er ikke koblet til.': 'The demo can prepare family/SFO, housing and moving cases. Other services are not connected.',
  'Saken er klargjort lokalt': 'Case prepared locally', 'Du har siste ord': 'You have the final say', 'Kontroller og fullfør': 'Review and complete', 'Gjennomgangen er fullført': 'Review completed', 'Gjennomgangen er fullført.': 'Review completed.',
  'Oppsummeringen er klar for at en person kan se over saken. Ingen søknad er sendt til kommunen.': 'The summary is ready for a person to review. No application has been sent to the municipality.',
  'Bekreftet': 'Confirmed', 'Gjennomført': 'Completed', 'Last ned saksgrunnlag (JSON)': 'Download preparation packet (JSON)', 'Last ned oppsummeringen (JSON)': 'Download summary (JSON)',
  'Lag et lokalt saksgrunnlag med opplysningene, kildene og planen. Det er en forberedelse til videre hjelp, ikke et vedtak.': 'Create a local packet with your information, sources and plan. It prepares you for further help; it is not a decision.',
  'Denne demoen kan ikke sende en søknad. Kontroller punktene nedenfor, bekreft at du har lest dem, og fullfør gjennomgangen.': 'This demo cannot submit an application. Review the items below, confirm that you have read them, and complete the review.',
  'Les hva du eller en saksbehandler fortsatt må kontrollere.': 'Read what you or a caseworker still need to check.', 'Kontroller at opplysningene og kildene stemmer.': 'Check that the information and sources are correct.', 'Kryss av og velg Fullfør gjennomgangen.': 'Tick the box and select Complete review.',
  'Dette gjenstår før videre behandling (': 'Still needed before further processing (', 'Dette må fortsatt følges opp (': 'Still needs follow-up (',
  'Bekreft eller avvis opplysningene først.': 'Confirm or reject the facts first.', 'Oppdater planen med de siste opplysningene først.': 'Update the plan with the latest information first.',
  'Alle tjenestevurderinger må fullføres først.': 'All service reviews must complete first.', 'Vent til arbeidet er fullført.': 'Wait for the work to complete.',
  'Jeg har sett over opplysningene og det som gjenstår, og vil klargjøre saksgrunnlaget lokalt.': 'I have reviewed the information and remaining tasks, and want to prepare the packet locally.', 'Jeg har kontrollert opplysningene og forstår hva som fortsatt må følges opp.': 'I have reviewed the information and understand what still needs follow-up.',
  'Bekreft og klargjør': 'Confirm and prepare', 'Fullfør gjennomgangen': 'Complete review', 'Fullfører gjennomgangen': 'Completing review', 'Ingen søknad sendes. Saksgrunnlaget lagres bare i demoen.': 'No application is sent. The packet is saved only in this demo.', 'Dette lager bare en lokal oppsummering. Ingenting sendes.': 'This only creates a local summary. Nothing is sent.',
  'Ingen søknad er sendt': 'No application has been sent', 'Du har fullført gjennomgangen. En lokal oppsummering er klar til nedlasting.': 'You have completed the review. A local summary is ready to download.', 'Dette kan du gjøre nå': 'What you can do now',
  'Last ned oppsummeringen og behold den til eget bruk.': 'Download the summary and keep it for your own use.', 'Fortsett hos kommunen eller den relevante offentlige tjenesten. Punkter merket for kontroll må fortsatt vurderes av en person.': 'Continue with the municipality or relevant official service. Items marked for review still need a person to assess them.', 'Når du er ferdig med demoen, velg Avslutt og slett.': 'When you are finished with the demo, choose End and delete.',
  'Ingen søknad er sendt. Åpne Neste steg for å laste ned oppsummeringen og se hva du kan gjøre videre.': 'No application has been sent. Open Next steps to download the summary and see what you can do next.', 'Se neste steg': 'View next steps',
  'Alle kildene dine': 'All your sources', 'Kilder': 'Sources', 'Kilder og referanser': 'Sources and references', 'Kilder for dette svaret': 'Sources for this answer', 'Kilde for dette resultatet': 'Source for this result', 'Se alle kilder og utdrag': 'View all sources and excerpts',
  'Her finner du kildene agentene faktisk brukte. Åpne en kilde for å se type, tidspunkt, lagret tekst og lenke til originalen når den finnes.': 'Here are the sources the agents actually used. Open a source to see its type, retrieval time, saved text and a link to the original when available.',
  'Ingen kilder er brukt ennå. Kilder vises her når agentene har analysert spørsmålet ditt.': 'No sources have been used yet. Sources appear here after the agents analyse your question.',
  'Saken lagres til': 'This case is saved until', '. Du kan avslutte og slette den når som helst.': '. You can end and delete it at any time.',
  'Ja': 'Yes', 'Nei': 'No', 'Hele husholdningens årsinntekt': 'Entire household’s annual income', 'Én persons årsinntekt': 'One person’s annual income', 'Månedsinntekt': 'Monthly income', 'Inntektsgrunnlaget må avklares': 'Income basis needs clarification',
  'Opplastet dokument': 'Uploaded document', 'Syntetisk register': 'Synthetic register', 'Veiledning': 'Guidance', 'Se kilde': 'View source',
  'Kilden er ikke tilgjengelig': 'Source unavailable', 'linje': 'line', 'side': 'page', 'Side': 'Page', 'Kildetype': 'Source type', 'Hentet': 'Retrieved', 'Gjelder': 'Applies to',
  'Ikke angitt': 'Not specified', 'Formål': 'Purpose', 'Åpne originalkilden': 'Open original source', 'Les lagret kildetekst': 'Read saved source text', 'Personvern i demoen': 'Privacy in the demo',
  'Vi fikk ikke fullført handlingen. Prøv igjen.': 'We could not complete this action. Please try again.',
  'En annen demosak er aktiv i nettleseren. Last inn den aktive saken før du fortsetter.': 'Another demo case is active in this browser. Load it before continuing.',
  'Vi har hentet samtalen og opplysningene du allerede har lagt inn.': 'Your existing conversation and information have been restored.', 'Kunne ikke hente saken.': 'Could not load the case.',
  'Kunne ikke starte en ny sak. Prøv igjen.': 'Could not start a new case. Please try again.', 'Skriv hva du trenger hjelp med.': 'Write what you need help with.',
  'Leser meldingen og undersøker relevante tjenester': 'Reading your message and checking relevant services', 'Henter syntetiske registeropplysninger': 'Loading synthetic register information',
  'Syntetiske demodata er lagt til som kilder. Fortell i samtalen hva du trenger hjelp med.': 'Synthetic demo data was added as sources. Tell us what you need help with in the conversation.',
  'Velg et TXT- eller PDF-dokument først.': 'Choose a TXT or PDF document first.', 'Velg en TXT-fil eller en tekstbasert PDF. Andre filtyper støttes ikke.': 'Choose TXT or a text-based PDF. Other file types are not supported.',
  'Leser dokumentet og oppdaterer saken': 'Reading the document and updating your case', 'Dokumentet er lagt til som kilde. Kontroller foreslåtte opplysninger i oversikten.': 'Document added as a source. Check the proposed facts in your overview.',
  'Sletter saken': 'Deleting case', 'Kunne ikke slette saken. Prøv igjen.': 'Could not delete the case. Please try again.', 'Kunne ikke slette saken.': 'Could not delete the case.',
  'Samtalen, opplysningene og dokumentene er slettet. Du kan starte på nytt.': 'The conversation, information and documents have been deleted. You can start again.',
  'Kontrollerer modelltilkoblingen': 'Checking the model connection', 'Kunne ikke kontrollere tilkoblingen.': 'Could not check the connection.',
  'Arbeider med saken din': 'Working on your case', 'Oppdaterer planen': 'Updating plan', 'Lagrer bekreftelsen': 'Saving confirmation', 'Avviser opplysningen': 'Rejecting fact', 'Klargjør saksgrunnlaget': 'Preparing case packet',
  'Agentarbeid pågår': 'Agents are working', 'Aktive agenter:': 'Active agents:', 'Aktivitet': 'Activity',
  'Pågående oppgave': 'Current task', 'Siste oppgave': 'Latest task', 'Agentarbeidet er fullført': 'Agent work is complete',
  'Agentoppgaver': 'Agent tasks', 'Vis detaljer for': 'View details for', 'Oppgavedetaljer': 'Task details',
  'Ingen agentoppgaver er registrert ennå.': 'No agent tasks have been recorded yet.', 'Varighet': 'Duration', 'Pågår': 'In progress', 'Modell': 'Model', 'Rammeverk': 'Framework',
  'Aktiviteter i denne oppgaven': 'Activity in this task', 'Ingen detaljer er registrert for denne oppgaven.': 'No details have been recorded for this task.',
  'Triage': 'Triage', 'Kritiker': 'Critic', 'Språkvask': 'Proofreading',
  'Kritikerens gjennomgang': 'The critic’s review', 'Dette er modellens egen kontroll av utkastet. Det erstatter ikke en saksbehandlers vurdering.': 'This is the model checking its own draft. It does not replace a caseworker’s assessment.',
  'Runde': 'Round', 'Godkjent': 'Approved', 'Må revideres': 'Needs revision',
  'Demo: naivt utkast mot kritikergodkjent svar': 'Demo: naive draft vs. critic-approved answer',
  'Kritikeren ba om en revisjon, men demobryteren CRITIC_ALWAYS_PASS lot utkastet stå uendret. Kritikken over viser hva som ble fanget opp.': 'The critic asked for a revision, but the CRITIC_ALWAYS_PASS demo switch left the draft unchanged. The critique above shows what it caught.',
  'Naivt utkast (uten revisjon)': 'Naive draft (before revision)', 'Kritikergodkjent svar': 'Critic-approved answer',
  'Kontrollerer kontekst, kilder og hva vi bør spørre om videre.': 'Checking context, sources and what to ask next.',
  'Oversikt': 'Overview', 'Tavle': 'Board', 'Gjennomgang': 'Review', 'Planvisning': 'Plan view', 'Tjenestetavle': 'Service board',
  'Tavlen viser faktiske sjekkpunkter i planen. Du kan svare på manglende opplysninger; vurderinger må fortsatt gjøres av en person.': 'The board shows actual plan checklist items. You can answer missing information; a person must still carry out the reviews.',
  'Tjenestene vises her når samtalen har gitt grunnlag for en plan.': 'Services appear here once the conversation provides a basis for a plan.',
  'Svar eller rett opplysninger': 'Answer or correct information', 'Kilder for tjenesten': 'Sources for this service', 'Ingen sjekkpunkter ennå.': 'No checklist items yet.',
  'Svar på spørsmål': 'Answer questions', 'Svar på det du vet. Tomme felt sendes ikke. Svarene blir forslag som du må kontrollere og bekrefte.': 'Answer what you know. Empty fields are not sent. Your answers become proposals for you to check and confirm.', 'Svar på det du vet. Tomme felt sendes ikke. Det du skriver i disse tydelig merkede feltene bekreftes direkte av deg.': 'Answer what you know. Empty fields are not sent. What you enter in these clearly labelled fields is confirmed directly by you.',
  'Se meldingen før sending': 'Preview message before sending', 'Send svar': 'Send answers', 'Velg': 'Choose', 'Vet ikke': 'Do not know', 'Fyll ut minst ett svar.': 'Enter at least one answer.',
  'Svarene er sendt som en melding. Se over forslagene i oversikten.': 'Your answers were sent as a message. Review the proposals in your overview.', 'Beløp i NOK': 'Amount in NOK', 'personer': 'people', 'Meldingen kan ha høyst 4000 tegn.': 'The message can contain at most 4,000 characters.',
  'Kontroll': 'Validation', 'Innbygger': 'Citizen', 'Dataverktøy': 'Data tool',
  'AI-modellen svarte på siste fullførte modellkall. Bare utvalgte utdrag behandles; saksminnet lagres lokalt.': 'The AI model responded to the last completed model call. Only selected excerpts are processed; case memory stays local.',
  'AI-modellen er konfigurert. Forbindelsen prøves når du sender en beskrivelse. Bare utvalgte utdrag behandles.': 'The AI model is configured. The connection is tested when you send a description. Only selected excerpts are processed.',
  'AI-modellen er ikke konfigurert. Legg inn serverinnstillingene i .env.local. Saksminnet lagres lokalt.': 'The AI model is not configured. The operator must configure the server. Case memory stays local.',
  'Installer Python-agentene med npm run setup:backend før du starter.': 'The operator must install the Python agents before starting.',
  'Foreslå dokumenterte opplysninger som du selv må kontrollere.': 'Propose documented facts for you to check.',
  'Dokumentets dato og periode må bekreftes av deg.': 'You must confirm the document date and period.',
  'Forstå behov og foreslå opplysninger du selv kontrollerer.': 'Understand your needs and propose information for you to check.', 'Oppgitt i denne samtalen.': 'Provided in this conversation.',
  'Veiledning til forberedelse; gir ikke vedtak eller registerverifisering.': 'Guidance for preparation; no decision or register verification.',
  'Kildeutdrag kontrollert 3. september 2026; kontroller gjeldende veiledning ved innsending.': 'Excerpt checked on 3 September 2026; check current guidance before submission.',
  'Modellanalysen er startet.': 'Model analysis started.', 'Strukturert svar mottatt og kontrollert.': 'Structured response received and checked.',
  'Innbygger valgte syntetiske familie-, SFO- og inntektsdata. Ingen offentlige registre er kontaktet.': 'The citizen selected synthetic family, SFO and income data. No public registers were contacted.',
  'Et AI-forslag manglet en gyldig kilde eller entydig verdi og ble utelatt.': 'An AI proposal lacked a valid source or unambiguous value and was omitted.',
  'En KI-oppsummering med ubekreftede tall eller påstand om vedtak/innsending ble utelatt.': 'An AI summary with unverified numbers or a claim of a decision or submission was omitted.',
  'Vi mangler en opplysning': 'Information is missing', 'Vi spør bare om det vi ikke kan hente eller bekrefte selv.': 'We ask about information we cannot obtain or confirm ourselves.',
  'Kommunen må se på opplysningene': 'The municipality must review the information', 'Grunnlaget er ufullstendig eller ugyldig. Vi beregner ikke en pris fra usikre tall.': 'The information is incomplete or invalid. We do not calculate a price from uncertain numbers.',
  'Denne sjekken dekker 1.–4. trinn': 'This check covers school years 1–4', 'Vi kan ikke vurdere denne SFO-plassen med denne sjekken. Kommunen må veilede om andre ordninger.': 'This check cannot assess this SFO place. The municipality must advise on other schemes.',
  'Takk. Kommunen må se nærmere på dette': 'The municipality must review this more closely', 'Endringen er registrert separat. Kommunen må avklare husholdningen eller de korrigerte opplysningene før den kan vurdere betalingen.': 'The change was recorded separately. The municipality must clarify the household or corrected information before assessing payment.',
  'Vi tar hensyn til at livet endrer seg': 'We take changes in your situation into account', 'Vi har laget et prisanslag fra inntekten du oppga. Kommunen må vurdere dokumentasjon og om inntektsnedgangen er varig.': 'An estimate was prepared from your stated income. The municipality must assess the documentation and whether the income reduction is lasting.',
  'Du kan få lavere SFO-betaling': 'Your SFO payment may be lower', 'Vi finner ingen ekstra reduksjon': 'No additional reduction found',
  'Inntekten og SFO-plassen gir grunnlag for redusert betaling i denne demoberegningen. Du kontrollerer før saken går videre.': 'The income and SFO place give a reduced payment in this demo calculation. You review it before proceeding.',
  'Med disse opplysningene gir inntektsregelen ingen ekstra reduksjon. Eventuelle gratistimer er allerede trukket fra.': 'With this information, the income rule gives no additional reduction. Any free hours have already been deducted.',

  'Finne barnet og den registrerte familien som SFO-vurderingen gjelder.': 'Find the child and registered family relevant to the SFO assessment.',
  'Sammenligne husholdningens årsinntekt med betalingen for SFO.': 'Compare household annual income with SFO payment.',
  'Finne klassetrinn, avtalt plass, timer og pris for barnets SFO.': 'Find the school year, agreed place, hours and price for the child’s SFO.',
  'Demogrunnlag for skoleåret 2026/2027': 'Demo information for the 2026/2027 school year', 'Inntektsåret 2025': 'Income year 2025', 'Skoleåret 2026/2027': 'School year 2026/2027',
  'Folkeregisteret (syntetisk)': 'Population Register (synthetic)', 'Skatteetaten via Fiks (syntetisk)': 'Skatteetaten via Fiks (synthetic)', 'Kommunens oppvekstsystem (syntetisk)': 'Municipal education system (synthetic)',
  'Udir – finansiering av SFO (kort kildeutdrag)': 'Udir – SFO funding (short source excerpt)', 'Husbanken – bostøtte (kort kildeutdrag)': 'Husbanken – housing allowance (short source excerpt)',
  'Husbanken – slik søker du (kort kildeutdrag)': 'Husbanken – how to apply (short source excerpt)', 'Skatteetaten – flytte i Norge (kort kildeutdrag)': 'Skatteetaten – moving within Norway (short source excerpt)',
  'Kildeverktøy': 'Source tool', 'En spesialistpåstand manglet eksakt kilde og ble utelatt.': 'A specialist claim lacked an exact source and was omitted.',
  'Gjeldende plan bekreftet. Lokal dokumentpakke opprettet for menneskelig oppfølging; ingenting sendt til kommunen.': 'Current plan confirmed. A local packet was created for human follow-up; nothing was sent to the municipality.',

  'Hent opplysninger': 'Retrieve information', 'Hent fra KS': 'Retrieve from KS',
  'Handling kreves': 'Action required', 'Kan vi hente testopplysninger fra KS?': 'May we retrieve test information from KS?',
  'Agenten trenger personopplysninger for å forberede SFO-vurderingen. Ingenting hentes før du velger.': 'The agent needs personal information to prepare the SFO assessment. Nothing is retrieved until you choose.',
  'Husstand og SFO-plass fra KS workshop-sandkassen': 'Household and SFO placement from the KS workshop sandbox',
  'Inntektsgrunnlag og regelresultat med uttrykkelig samtykke': 'Income basis and rules result with explicit consent',
  'Testidentitet via ID-porten digdir-mock; ingen oppslag om deg': 'Test identity via ID-porten digdir-mock; no lookup about you',
  'Jeg samtykker til å hente disse syntetiske personopplysningene fra KS-sandkassen for denne SFO-vurderingen.': 'I consent to retrieving this synthetic personal information from the KS sandbox for this SFO assessment.',
  'Samtykk, hent og fortsett': 'Consent, retrieve and continue', 'Fortsett uten KS': 'Continue without KS',
  'Et ja starter neste agentsteg automatisk. Du kan fortsatt rette hentede opplysninger.': 'A yes starts the next agent step automatically. You can still correct retrieved information.',
  'KS-opplysningene er hentet': 'KS information retrieved',
  'Agentene fortsatte automatisk med de nye kildene. Du kan kontrollere og rette opplysningene i oversikten.': 'The agents continued automatically with the new sources. You can review and correct the information in the overview.',
  'Ditt valg': 'Your choice', 'Vi fortsetter uten KS': 'We will continue without KS',
  'Ingen personopplysninger blir hentet. Svar på spørsmålene under med det du vet.': 'No personal information will be retrieved. Answer the questions below with what you know.',
  'Vi henter husholdning og SFO fra KS sin offisielle sandkasse, for testinnbyggeren som er konfigurert for denne løsningen. Dette er testdata, ikke et oppslag om deg i offentlige registre.': 'We retrieve household and SFO information from the official KS sandbox for the test citizen configured for this service. These are test data, not a public register lookup about you.',
  'Testinnbygger': 'Test citizen', 'Husholdning og SFO hentet': 'Household and SFO retrieved',
  'Inntekt krever et eget samtykke. Skattemessig person- og kapitalinntekt er ikke det samme som husholdningens brutto årsinntekt.': 'Income requires separate consent. Tax personal and capital income is not the same as the household’s gross annual income.',
  'Jeg samtykker til å hente skattemessig person- og kapitalinntekt for testinnbyggeren fra KS-sandkassen, for å forberede SFO-vurderingen.': 'I consent to retrieving the test citizen’s tax personal and capital income from the KS sandbox to prepare the SFO assessment.',
  'Samtykk og hent inntekt': 'Consent and retrieve income', 'Henter inntekt med samtykke': 'Retrieving income with consent',
  'Inntektsopplysninger hentet': 'Income information retrieved', 'Samtykket gjelder til': 'Consent expires on',
  'Nye kilder er lagt til. Oppdater planen for å bruke dem. Opplysningene er ikke automatisk bekreftet av deg.': 'New sources were added. Update the plan to use them. The information has not been automatically confirmed by you.',
  'Nye KS-kilder er lagt til. Planen oppdateres automatisk når en samtale er startet. Hentede verdier kan rettes av deg.': 'New KS sources were added. The plan updates automatically once a conversation has started. You can correct retrieved values.',
  'Inntekt krever et eget samtykke. KS returnerer beregningsgrunnlaget som brukes i SFO-regelen. Det fylles inn automatisk med KS som kilde, og du kan rette det dersom situasjonen er endret.': 'Income requires separate consent. KS returns the calculation basis used by the SFO rule. It is filled in automatically with KS as its source, and you can correct it if your situation has changed.',
  'Testidentitet': 'Test identity', 'ID-porten via digdir-mock': 'ID-porten via digdir-mock',
  'Henter husholdning og SFO fra KS': 'Retrieving household and SFO information from KS',
  'Opplysninger fra KS er lagt til som kilder. Se over grunnlaget før du oppdaterer planen.': 'Information from KS was added as sources. Review it before updating the plan.',
  'Registeropplysning': 'Register information',
  'Samtykket er registrert, men inntektsinnhentingen er ikke fullført.': 'Consent was registered, but income retrieval has not completed.',

  'Forberede oversikt over husstanden.': 'Prepare a household overview.', 'Forberede vurdering av SFO-betaling.': 'Prepare an assessment of SFO payment.', 'Forstå reglene i KS-sandkassen.': 'Understand the rules in the KS sandbox.',
  'Øyeblikksbilde fra KS workshop. Et utvalg av API-feltene; identifikatorer er utelatt.': 'Snapshot from the KS workshop. Selected API fields; identifiers are omitted.',
  'Hentet husstand, SFO-plasser og satser fra KS workshop API. Inntekt er ikke hentet.': 'Retrieved household, SFO places and rates from the KS workshop API. Income has not been retrieved.',
  'Leste inntektsgrunnlag og deterministisk SFO-vurdering fra KS etter kontrollert samtykke. Resultatet gjelder registerøyeblikksbildet.': 'Read income information and the deterministic SFO assessment from KS after checking consent. The result applies to the register snapshot.',
  'KS-tjenesten kunne ikke fullføre forespørselen. Kontroller tilkoblingen og prøv igjen.': 'The KS service could not complete the request. Check the connection and try again.',
  'KS-opplysningene er allerede hentet i denne samtalen.': 'KS information has already been retrieved in this conversation.',
  'Hent KS-opplysningene og velg samtykke før inntekt kan leses.': 'Retrieve KS information and provide consent before income can be read.',
  'KS-demo API-et returnerte et svar som ikke kunne kontrolleres. Ingen opplysninger er lagt til.': 'The KS demo API returned a response that could not be validated. No information was added.',
  'KS-demo API-et kunne ikke nås eller svaret ble avbrutt. Prøv igjen når tjenesten er tilgjengelig.': 'The KS demo API could not be reached or its response was interrupted. Try again when the service is available.',
  'Samtykket til inntektsopplysninger er utløpt. Et nytt valg er nødvendig.': 'Income consent has expired. A new choice is required.',
  'KS-demo API-et krever samtykke før inntektsopplysninger kan leses.': 'The KS demo API requires consent before income information can be read.',
  'KS-demo API-et avviste tilgangen til disse opplysningene.': 'The KS demo API denied access to this information.',
  'KS-demo API-et fant ikke den etterspurte opplysningen.': 'The KS demo API did not find the requested information.',

  'Anbefalt neste steg': 'Recommended next step', 'Andre muligheter': 'Other options', 'Gjør på nytt': 'Do again', 'Utført': 'Done', 'Anbefalt': 'Recommended',
  'Svar på det som mangler': 'Answer what is missing', 'Agenten trenger flere opplysninger før neste steg kan gjøres klart.': 'The agent needs more information before the next step can be prepared.',
  'Kontakt riktig person': 'Contact the right person', 'Du kan alltid ta saken videre med en person som kan hjelpe.': 'You can always take the case further with a person who can help.',
  'Send en e-post': 'Send an e-mail', 'Vi lager et utkast med opplysningene dine. Du leser over og sender selv.': 'We draft it with your information. You review it and send it yourself.',
  'Fyll ut skjemaet': 'Fill in the form', 'Vi fyller ut skjemaet fra opplysningene du har bekreftet. Du leser over og sender inn.': 'We fill in the form from the information you confirmed. You review it and submit.',
  'Gå til den offisielle tjenesten': 'Go to the official service', 'Søknaden eller meldingen sendes i den offisielle tjenesten med innlogging.': 'The application or notice is sent in the official service after signing in.',
  'Fullfør og last ned oppsummeringen': 'Complete and download the summary', 'Avslutt med en lokal oppsummering av saken og det som er gjort.': 'Finish with a local summary of the case and what has been done.',
  'Skjemaet fylles ut fra bekreftede opplysninger og sendes inn til KS-sandkassen som testsøknad.': 'The form is filled in from confirmed information and submitted to the KS sandbox as a test application.',
  'Søknad om redusert foreldrebetaling i SFO/AKS': 'Application for reduced parental payment in SFO/AKS', 'Forberedt søknad om bostøtte (til Husbanken)': 'Prepared housing allowance application (for Husbanken)', 'Forberedt flyttemelding (til Skatteetaten)': 'Prepared change-of-address notice (for Skatteetaten)',
  'Planen må oppdateres med de siste opplysningene.': 'The plan must be updated with the latest information.', 'Saken er fullført og låst.': 'The case is completed and locked.',
  'Noen opplysninger mangler før skjema eller e-post kan gjøres klart.': 'Some information is missing before a form or e-mail can be prepared.', 'Alle nødvendige opplysninger er bekreftet. Skjemaet kan fylles ut og sendes inn.': 'All required information is confirmed. The form can be filled in and submitted.',
  'Denne tjenesten har en offisiell selvbetjening. Vi har forberedt opplysningene du trenger.': 'This service has an official self-service. We have prepared the information you need.', 'Opplysningene er klare til å deles med en saksbehandler.': 'The information is ready to share with a caseworker.', 'Ta kontakt for å gå videre.': 'Get in touch to continue.',
  'Et generelt spørsmål er besvart fra veiledning. Ta kontakt dersom du vil gå videre med din egen sak.': 'A general question was answered from guidance. Get in touch if you want to continue with your own case.', 'Analysen kunne ikke fullføres. En person kan hjelpe deg videre.': 'The analysis could not complete. A person can help you further.',
  'Allerede utført. Kvitteringen ligger under Neste steg.': 'Already done. The receipt is under Next steps.', 'Saken er fullført.': 'The case is completed.', 'Når du er ferdig med handlingene, kan du': 'When you have finished the actions, you can', 'fullføre og laste ned oppsummeringen': 'complete and download the summary',
  'Oppsummeringen kan lastes ned når alle tjenestevurderinger er fullført.': 'The summary can be downloaded when all service reviews are complete.', 'handling er utført.': 'action completed.', 'handlinger er utført.': 'actions completed.',
  'Vis kontaktinformasjon': 'Show contact information', 'Skjul kontaktinformasjon': 'Hide contact information', 'Svar nå': 'Answer now', 'Lag e-postutkast': 'Draft an e-mail', 'Lag nytt utkast': 'Draft again', 'Fyll ut på nytt': 'Fill in again', 'Åpne tjenesten': 'Open the service',
  'Telefon': 'Phone', 'E-post': 'E-mail', 'Åpningstid': 'Opening hours', 'Nettside': 'Website', 'Mandag–fredag 08.00–15.30': 'Monday–Friday 08:00–15:30', 'Mandag–fredag 09.00–15.00': 'Monday–Friday 09:00–15:00', 'Mandag–fredag 09.00–15.30': 'Monday–Friday 09:00–15:30',
  'Aktivitetsskolen (AKS) – foreldrebetaling': 'Aktivitetsskolen (AKS) – parental payment', 'Saksbehandler for redusert foreldrebetaling i SFO/AKS': 'Caseworker for reduced parental payment in SFO/AKS', 'Oslo kommune · Utdanningsetaten': 'City of Oslo · Education Agency',
  'Boligkontoret i bydelen': 'District housing office', 'Veileder for bostøtte og kommunal bolig': 'Adviser for housing allowance and municipal housing', 'Oslo kommune · bydelens NAV-kontor': 'City of Oslo · district NAV office',
  'Husbanken – bostøtte': 'Husbanken – housing allowance', 'Statlig bostøtteordning': 'National housing allowance scheme', 'Skatteetaten – flyttemelding': 'Skatteetaten – change of address', 'Folkeregisteret': 'National Population Register',
  'Innbyggerservice': 'Citizen service', 'Veiledning om kommunale tjenester': 'Guidance on municipal services', 'Oslo kommune': 'City of Oslo',
  'Demo-kontaktpunkt. Telefonnummeret er Oslo kommunes publikumstelefon; e-postadressen er en plassholder for demoen.': 'Demo contact point. The phone number is the City of Oslo public line; the e-mail address is a demo placeholder.',
  'Demo-kontaktpunkt. Bostøtte vedtas av Husbanken; bydelen veileder og tar imot søknaden.': 'Demo contact point. Husbanken decides housing allowance; the district advises and receives the application.',
  'Offisiell selvbetjening. Søknaden sendes i Husbankens egen tjeneste med innlogging.': 'Official self-service. The application is sent in Husbanken’s own service after signing in.', 'Offisiell selvbetjening. Flyttemeldingen sendes av deg selv i Skatteetatens tjeneste.': 'Official self-service. You send the change-of-address notice yourself in Skatteetaten’s service.',
  'Demo-kontaktpunkt for spørsmål som ikke hører til én bestemt tjeneste.': 'Demo contact point for questions that do not belong to one specific service.',
  'Utkast · les over før du sender': 'Draft · review before sending', 'E-post til': 'E-mail to', 'Til': 'To', 'Emne': 'Subject', 'Tekst': 'Message',
  'KI-utkast kontrollert mot bekreftede opplysninger. Du kan endre alt før du sender.': 'AI draft checked against confirmed information. You can change everything before sending.', 'Fast utkast laget fra bekreftede opplysninger, uten KI. Du kan endre alt før du sender.': 'Fixed draft built from confirmed information, without AI. You can change everything before sending.',
  'Ingenting sendes fra denne appen; e-posten åpnes i ditt eget e-postprogram.': 'Nothing is sent from this app; the e-mail opens in your own mail client.', 'Godkjenn og åpne i e-postprogrammet': 'Approve and open in your mail client', 'Kopier teksten': 'Copy the text', 'Kopiert': 'Copied', 'Forkast utkastet': 'Discard draft',
  'Fyll inn en gyldig e-postadresse, et emne og en tekst på inntil 4000 tegn.': 'Enter a valid e-mail address, a subject and a message of up to 4,000 characters.',
  'Utfylt skjema · les over før du sender': 'Completed form · review before sending', 'Feltene er fylt ut fra opplysninger du har bekreftet. Ingen verdi er beregnet eller antatt. Bekreftede opplysninger rettes i oversikten, ikke her.': 'The fields are filled in from information you confirmed. No value is calculated or assumed. Confirmed information is corrected in the overview, not here.',
  'Fylt ut fra dine egne meldinger. Du kan endre teksten.': 'Filled in from your own messages. You can edit the text.', 'Dine egne ord': 'Your own words', 'Ikke utfylt': 'Not filled in', 'Dokumentasjon du må legge ved selv': 'Documentation you must attach yourself', 'Mottaker': 'Recipient',
  'Beskrivelse av situasjonen (dine egne ord)': 'Description of your situation (your own words)', 'Melding til saksbehandler': 'Message to the caseworker', 'Ny adresse (gate, postnummer, eventuelt bolignummer)': 'New address (street, postcode, dwelling number if any)', 'Hvem flytter': 'Who is moving',
  'Dokumentasjon på husholdningens inntekt (skattemelding eller lønnsslipper)': 'Documentation of household income (tax return or payslips)', 'Dokumentasjon på endret inntekt dersom situasjonen er ny': 'Documentation of changed income if the situation is new', 'Leiekontrakt': 'Lease', 'Oversikt over boutgifter': 'Overview of housing costs', 'Dokumentasjon på inntekt for søknadsmåneden': 'Documentation of income for the application month', 'Leiekontrakt eller kjøpekontrakt for ny bolig dersom Skatteetaten ber om det': 'Lease or purchase contract for the new home if Skatteetaten asks for it',
  'Innsendingen går til KS sin workshop-sandkasse for den konfigurerte testpersonen. Sandkassen registrerer søknaden og oppretter en saksbehandleroppgave. Dette er ikke en søknad til en virkelig kommune.': 'The submission goes to the KS workshop sandbox for the configured test citizen. The sandbox records the application and creates a casework task. This is not an application to a real municipality.',
  'Denne tjenesten krever innlogging hos mottakeren. Vi klargjør skjemaet og gir deg en kvittering du kan bruke når du fyller ut den offisielle tjenesten.': 'This service requires signing in with the recipient. We prepare the form and give you a receipt to use when you complete the official service.',
  'Godkjenn og send testsøknaden': 'Approve and send the test application', 'Godkjenn og klargjør skjemaet': 'Approve and prepare the form',
  'Utførte handlinger': 'Completed actions', 'Overlevert til e-postprogrammet': 'Handed to your mail client', 'Sendt inn til KS-sandkassen': 'Submitted to the KS sandbox', 'Klargjort lokalt': 'Prepared locally', 'Referanse': 'Reference', 'Saksbehandleroppgave': 'Casework task', 'Tidspunkt': 'Time', 'Merknad fra KS:': 'Note from KS:',
  'Last ned kvittering': 'Download receipt', 'Åpne i e-postprogrammet igjen': 'Open in your mail client again',
  'E-posten er lest gjennom av deg og overlevert til ditt e-postprogram. Selve sendingen skjer der.': 'You reviewed the e-mail and it was handed to your mail client. The actual sending happens there.',
  'Testsøknaden er registrert i KS-sandkassen, og en saksbehandleroppgave er opprettet i Fiks-simulatoren.': 'The test application is recorded in the KS sandbox and a casework task was created in the Fiks simulator.', 'Testsøknaden er registrert i KS-sandkassen. Saksbehandleroppgaven kunne ikke opprettes.': 'The test application is recorded in the KS sandbox. The casework task could not be created.',
  'Veien videre per tjeneste': 'The way forward per service', 'Hver tjeneste ender i en konkret handling. Agenten anbefaler, appen kontrollerer hva som er mulig, og du utfører.': 'Each service ends in a concrete action. The agent recommends, the app checks what is possible, and you carry it out.',
  'Handlingene dine er registrert': 'Your actions are recorded', 'Du har fullført gjennomgangen. Kvitteringene og en lokal oppsummering er klare til nedlasting.': 'You have completed the review. The receipts and a local summary are ready to download.',
  'Handlingene over er utført. Åpne Neste steg for å laste ned oppsummeringen og kvitteringene.': 'The actions above are done. Open Next steps to download the summary and receipts.',
  'Lager e-postutkast': 'Drafting the e-mail', 'Fyller ut skjemaet fra bekreftede opplysninger': 'Filling in the form from confirmed information', 'Registrerer e-posten og åpner e-postprogrammet': 'Recording the e-mail and opening your mail client', 'Sender testsøknaden til KS-sandkassen': 'Sending the test application to the KS sandbox', 'Klargjør skjemaet': 'Preparing the form', 'Forkaster utkastet': 'Discarding the draft',
  'Skribent': 'Writer', 'Skjemaverktøy': 'Form tool', 'Samtale og neste steg': 'Conversation and next steps',

  'KS API · Husstand (syntetiske testopplysninger)': 'KS API · Household (synthetic test information)',
  'KS API · SFO-plasser (syntetiske testopplysninger)': 'KS API · SFO places (synthetic test information)',
  'KS API · SFO-satser (syntetiske testopplysninger)': 'KS API · SFO rates (synthetic test information)',
  'KS API · Inntektsgrunnlag for SFO (syntetiske testopplysninger)': 'KS API · Income basis for SFO (synthetic test information)',
  'KS API · Regelvurdering for SFO (syntetiske testopplysninger)': 'KS API · SFO rules assessment (synthetic test information)',

  'Tolker henvendelsen': 'Interpreting your request', 'Forbereder svar for hver tjeneste': 'Preparing an answer for each service',
  'Kvalitetssikrer svaret': 'Quality-checking the answer', 'Retter opp basert på tilbakemeldingen': 'Revising based on the feedback', 'Finpusser språket': 'Polishing the language',

  'Forskriftstekst mot klarspråk': 'Regulation text versus plain language', 'Velg språk for klarspråksteksten': 'Choose a language for the plain-language text',
  'Forskriftstekst og satsgrunnlag': 'Regulation text and rate basis', 'Klarspråk': 'Plain language',
  'Fast tekst fra regelmotoren, ingen språkmodell er brukt. Beløpene er identiske i begge språk.': 'Fixed text from the rule engine, no language model was used. The amounts are identical in both languages.',
  'Teksten er skrevet om av KS-sandkassens KI-gateway. Den har bare en forklarende rolle og endrer ingen beløp. Beløpene er identiske i begge språk.': 'The text was rewritten by the KS sandbox AI gateway. It only has an explanatory role and changes no amounts. The amounts are identical in both languages.',
  'Teksten er skrevet om av vår egen KI-modell. Beløpene er identiske i begge språk.': 'The text was rewritten by our own AI model. The amounts are identical in both languages.',

  'Moderasjonsbevis for lommebok': 'Wallet moderation credential', 'Demosignatur – ingen tillitsforankring': 'Demo signature – no trust anchor',
  'Ordning': 'Scheme', 'Utfall': 'Outcome', 'Innvilget': 'Approved', 'Avslag': 'Denied', 'Gyldig fra': 'Valid from', 'Gyldig til': 'Valid until', 'Utsteder': 'Issuer', 'Signert': 'Signed',
  'QR-kode med et OpenID4VCI credential-offer for dette beviset': 'QR code with an OpenID4VCI credential offer for this credential',
  'Ingen inntektstall eller fødselsnummer er lagt inn i beviset. Formatet er W3C Verifiable Credentials, med et OpenID4VCI credential-offer i QR-koden.':
    'No income figures or national ID numbers are included in the credential. The format is W3C Verifiable Credentials, with an OpenID4VCI credential offer in the QR code.',
  'Demosignatur med en lokal nøkkel generert av demoen. Ingen kommune, Digdir eller annen tillitsforankring har godkjent eller signert dette beviset, og signaturtypen er ikke en registrert W3C-kryptosuite. En ekte lommebok vil ikke kunne verifisere den.':
    'Demo signature with a local key generated by this demo. No municipality, Digdir or other trust anchor has approved or signed this credential, and the proof type is not a registered W3C cryptosuite. A real wallet will not be able to verify it.',
  'Søk én gang – hackathondemo (ingen kommune eller nasjonal instans har signert dette)':
    'Søk én gang – hackathon demo (no municipality or national body has signed this)',
};

const LocaleContext = createContext<{ locale: UiLocale; setLocale: (value: UiLocale) => void }>({ locale: 'nb', setLocale: () => {} });
let inMemoryLocale: UiLocale = 'nb';
function readLocale(): UiLocale {
  try { const stored = localStorage.getItem(UI_LOCALE_KEY); return stored === 'en' || stored === 'nb' ? stored : inMemoryLocale; } catch { return inMemoryLocale; }
}
function subscribeLocale(callback: () => void) {
  window.addEventListener('storage', callback); window.addEventListener('assistant-locale-change', callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener('assistant-locale-change', callback); };
}
export function AssistantLocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, readLocale, () => 'nb' as const);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  function setLocale(value: UiLocale) {
    inMemoryLocale = value;
    try { localStorage.setItem(UI_LOCALE_KEY, value); } catch { /* The selection remains usable when storage is denied. */ }
    window.dispatchEvent(new Event('assistant-locale-change'));
  }
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
export function translate(text: string, locale: UiLocale) {
  if (locale !== 'en') return text;
  if (translations[text]) return translations[text];
  const description = /^Din beskrivelse (\d+)$/.exec(text);
  if (description) return `Your description ${description[1]}`;
  const sourceRead = /^Leste kontrollert veiledningsutdrag: ([a-z-]+)\. Ikke et live registeroppslag\.$/.exec(text);
  if (sourceRead) return `Read a checked guidance excerpt: ${sourceRead[1]}. This was not a live register lookup.`;
  const missing = /^Mangler: (.*)\.$/.exec(text);
  if (missing) return `Missing: ${missing[1].split(', ').map(label => Object.values(factNames).find(pair => pair[0] === label)?.[1] ?? label).join(', ')}.`;
  const pendingFacts = /^(\d+) foreslåtte opplysninger må bekreftes eller avvises\.$/.exec(text);
  if (pendingFacts) return `${pendingFacts[1]} proposed facts must be confirmed or rejected.`;
  const confirmation = /^(.*): (bekreftet|avvist)\. Tidligere analyse er ugyldig\.$/.exec(text);
  if (confirmation) {
    const name = Object.values(factNames).find(pair => pair[0] === confirmation[1])?.[1] ?? confirmation[1];
    return `${name}: ${confirmation[2] === 'bekreftet' ? 'confirmed' : 'rejected'}. The previous analysis is no longer current.`;
  }
  return text;
}
export function useAssistantLocale() { const context = useContext(LocaleContext); return { ...context, t: (text: string) => translate(text, context.locale), dateTime: (iso: string) => new Intl.DateTimeFormat(context.locale === 'en' ? 'en-GB' : 'nb-NO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Oslo' }).format(new Date(iso)) }; }

const factNames: Record<FactKey, [string, string]> = {
  job_lost: ['Har mistet jobben', 'Has lost their job'], has_children: ['Har barn', 'Has children'], uses_sfo: ['Bruker SFO', 'Uses after-school care (SFO)'],
  needs_housing: ['Ønsker hjelp med bolig', 'Needs housing help'], moving: ['Skal flytte', 'Is moving'], household_income_annual: ['Husholdningens årsinntekt (kr)', 'Household annual income (NOK)'],
  income_basis: ['Hva inntekten gjelder', 'Income basis'], monthly_rent: ['Månedlig husleie (kr)', 'Monthly rent (NOK)'], household_size: ['Antall personer i husholdningen', 'Number of people in the household'],
  move_date: ['Flyttedato', 'Moving date'], new_municipality: ['Ny kommune', 'New municipality'], cohabitant_missing: ['Samboer mangler i grunnlaget', 'Partner missing from the information'],
};
export function factLabel(key: string, fallback: string, locale: UiLocale) { return factNames[key as FactKey]?.[locale === 'en' ? 1 : 0] ?? fallback; }
export function serviceLabel(id: ServiceId, locale: UiLocale) { return translate({ family: 'Familie og SFO', housing: 'Bolig og bostøtte', moving: 'Flytting' }[id], locale); }
export function factValue(value: string, locale: UiLocale) { return translate(({ true: 'Ja', false: 'Nei', household_year: 'Hele husholdningens årsinntekt', individual_year: 'Én persons årsinntekt', month: 'Månedsinntekt', unknown: 'Inntektsgrunnlaget må avklares' } as Record<string, string>)[value] ?? value, locale); }

const checkEnglish: Record<string, [string, string]> = {
  'family-guidance': ['Discuss other family services', 'Contact your municipality for help with kindergarten or other family services.'],
  'income-scope': ['Clarify the income basis', 'Monthly or individual income is not automatically converted to annual household income.'],
  'sfo-price': ['Check the SFO place and price with the municipality', 'The estimate uses your selected synthetic SFO information. Free hours and prices are demo assumptions; the municipality must check the actual place and tariff.'],
  'sfo-evidence': ['Find the SFO agreement and municipal price', 'Prepare the school year, weekly hours, monthly price, payment months and food price. Missing amounts are not filled in.'],
  'household-review': ['Clarify who belongs to the household', 'A reported household change needs human clarification before a price can be calculated.'],
  'housing-documents': ['Find housing and income documents', 'Prepare the lease, housing expenses and evidence of income changes. Husbanken or your municipality decides which attachments are needed.'],
  'housing-period': ['Clarify monthly income and residence', 'Annual income is background information. Check the application month, income requested by Husbanken, home address and municipality. Annual income is not divided by twelve.'],
  'housing-handoff': ['Continue with Husbanken or the municipality', 'Check the conditions and application in the official service. No housing allowance amount or eligibility has been determined.'],
  'moving-address': ['Check the full address and who is moving', 'Have the street address, postcode and dwelling number ready. Check who the moving notice applies to.'],
  'moving-deadline': ['Check the deadline with Skatteetaten', 'The quoted guidance applies to moving within Norway. For international moves, select the relevant Skatteetaten guidance.'],
  'moving-handoff': ['Report the move yourself to Skatteetaten', 'Open the official service, check the information and submit when ready. No moving notice has been sent here.'],
  'guidance-missing': ['Guidance source missing', 'Guidance must be saved with a verifiable excerpt before handoff.'],
};
export function localizeCheck(check: ServiceCheck, locale: UiLocale): ServiceCheck {
  if (locale === 'nb') return check;
  const pair = checkEnglish[check.id];
  if (pair) return { ...check, label: pair[0], detail: pair[1] };
  if (factNames[check.id as FactKey]) {
    const prefix = 'Bekreftet av deg: ';
    const suffix = '. Opplysningen er lagret som innbyggerens egen bekreftelse.';
    const ksPrefix = 'Hentet fra KS: ';
    const ksSuffix = '. Du kan rette opplysningen hvis situasjonen din er annerledes.';
    const value = check.detail.startsWith(prefix) && check.detail.endsWith(suffix) ? check.detail.slice(prefix.length, -suffix.length) : null;
    const ksValue = check.detail.startsWith(ksPrefix) && check.detail.endsWith(ksSuffix) ? check.detail.slice(ksPrefix.length, -ksSuffix.length) : null;
    return { ...check, label: factLabel(check.id, check.label, locale), detail: value !== null ? `Confirmed by you: ${translate(value[0]?.toUpperCase() + value.slice(1), locale)}. Saved as your own confirmation.` : ksValue !== null ? `Retrieved from KS: ${translate(ksValue[0]?.toUpperCase() + ksValue.slice(1), locale)}. You can correct this if your situation is different.` : check.status === 'missing' ? `Please provide: ${factLabel(check.id, check.label, locale).toLowerCase()}.` : check.detail };
  }
  return check;
}
