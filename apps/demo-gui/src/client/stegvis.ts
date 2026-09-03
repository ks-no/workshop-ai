// Sidescript for stegvis. Lastes som <script type="module">, så alt her har sitt
// eget scope - to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

renderTopNav("/stegvis");

const aiBase = "http://localhost:8082";
const personvelger = krevEl<HTMLSelectElement>("personvelger");
const prosessvelger = krevEl<HTMLSelectElement>("prosessvelger");
const statusEl = krevEl("status");
const visning = krevEl("visning");
const hendelser = krevEl("hendelser");
const samtykkeIdEl = krevEl("samtykkeId");
const sporingsIdEl = krevEl("sporingsId");
const oektsIdEl = krevEl("oektsId");
const stegCounter = krevEl("stegTeller");
const aktivtStegEl = krevEl("aktivtSteg");
const prosessOversikt = krevEl("prosessOversikt");

let personer: Person[] = [];
let prosesser: Prosess[] = [];
let aktivProsessoekt: Prosessoekt | null = null;
let aktivProsess: Prosess | null = null;
let sporingsId = `flyt-${Date.now()}`;
sporingsIdEl.textContent = sporingsId;

function setStatus(tekst: string): void {
  statusEl.textContent = tekst;
}

function log(tekst: string): void {
  const node = document.createElement("div");
  node.className = "line";
  node.textContent = tekst;
  hendelser.prepend(node);
}

function valgtPersonId(): string {
  return personvelger.value;
}

function valgtProsessId(): string {
  return prosessvelger.value;
}

function prosessFromId(prosessId: string): Prosess | null {
  return prosesser.find((prosess) => prosess.id === prosessId) || null;
}

// Generisk over svarformen, så hvert kallsted navngir hva det venter seg i
// stedet for at én any smitter videre gjennom hele siden.
async function getJson<T>(
  url: string,
  valg: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<T> {
  const svar = await fetch(url, { ...valg, headers: withToken(valg.headers || {}) });
  const data = (await svar.json()) as { feil?: string };
  if (!svar.ok) {
    throw new Error(data.feil || `Feil ${svar.status}`);
  }
  return data as T;
}

async function postJson<T>(url: string, payload: unknown = {}): Promise<T> {
  return getJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// Who you are is settled at ID-porten, not in a dropdown here. The selector
// is filled with the single person you logged in as, so valgtPersonId() and
// everything downstream keeps working unchanged.
let meg: Person | null = null;

async function loadGrunnlag(): Promise<void> {
  personer = await getJson<Person[]>("http://localhost:8080/api/personer");
  prosesser = await getJson<Prosess[]>("http://localhost:8080/api/prosesser");

  meg = showLoggedInPerson(personvelger, personer);
  showLoginBanner(hendelser, meg);

  prosessvelger.innerHTML = prosesser
    .map((prosess) => `<option value="${htmlEscape(prosess.id)}">${htmlEscape(prosess.navn)}</option>`)
    .join("");

  renderProsessOversikt();
}

function renderProsessOversikt(): void {
  const prosess = aktivProsess || prosessFromId(valgtProsessId());
  if (!prosess) {
    prosessOversikt.innerHTML = `<div class="muted">Ingen prosess valgt.</div>`;
    stegCounter.textContent = "0 / 0";
    return;
  }

  const aktivIndex = aktivProsessoekt?.stegIndex ?? -1;
  const steg = prosess.steg ?? [];
  stegCounter.textContent = `${Math.max(aktivIndex + 1, 0)} / ${steg.length}`;
  prosessOversikt.innerHTML = steg.map((steg, indeks) => {
    const klasser: string[] = [];
    if (indeks === aktivIndex) klasser.push("active");
    if (indeks < aktivIndex) klasser.push("done");
    return `
      <div class="step-card ${klasser.join(" ")}">
        <div class="step-type">${htmlEscape(steg.type)}</div>
        <div><strong>${indeks + 1}. ${htmlEscape(steg.tittel)}</strong></div>
      </div>
    `;
  }).join("");
}

function updateSessionView(oekt: Prosessoekt): void {
  aktivProsessoekt = oekt;
  aktivProsess = prosessFromId(oekt.prosessId);
  sporingsId = oekt.sporingsId;
  sporingsIdEl.textContent = sporingsId;
  oektsIdEl.textContent = oekt.oektsId;
  samtykkeIdEl.textContent = oekt.aktivtSamtykkeId || "ikke opprettet";
  renderProsessOversikt();
}

function renderAktivtSteg(): void {
  const steg = aktivProsessoekt?.aktivtSteg;
  if (!steg) {
    aktivtStegEl.innerHTML = `<div class="muted">Ingen aktivt steg.</div>`;
    renderProsessOversikt();
    return;
  }

  renderProsessOversikt();

  let innhold = `
    <div class="step-type">${htmlEscape(steg.type)}</div>
    <h2>${htmlEscape(steg.tittel)}</h2>
    ${steg.tekst ? `<p>${htmlEscape(steg.tekst)}</p>` : ""}
  `;

  if (steg.type === "QUESTION") {
    if (Array.isArray(steg.felter) && steg.felter.length > 0) {
      const svar = (aktivProsessoekt?.svar?.[steg.id] || {}) as Record<string, unknown>;
      const feltHtml = steg.felter.map((felt) => {
        const svarverdi = String(svar[felt.id] ?? "");
        const feltId = `felt-${htmlEscape(felt.id)}`;
        const labelHtml = `<label for="${feltId}">${htmlEscape(felt.label)}${felt.obligatorisk ? " *" : ""}</label>`;
        if (felt.type === "ja-nei") {
          return `
            <div class="row">
              ${labelHtml}
              <select id="${feltId}" class="field-answer" data-felt-id="${htmlEscape(felt.id)}">
                <option value="">Velg</option>
                <option value="Ja" ${svarverdi === "Ja" ? "selected" : ""}>Ja</option>
                <option value="Nei" ${svarverdi === "Nei" ? "selected" : ""}>Nei</option>
              </select>
            </div>
          `;
        }
        if (felt.type === "valg") {
          const alternativer = (felt.alternativer || []).map((alternativ) => {
            const verdi = alternativVerdi(alternativ);
            return `<option value="${htmlEscape(verdi)}" ${svarverdi === verdi ? "selected" : ""}>${htmlEscape(alternativLabel(alternativ))}</option>`;
          }).join("");
          return `
            <div class="row">
              ${labelHtml}
              <select id="${feltId}" class="field-answer" data-felt-id="${htmlEscape(felt.id)}">
                <option value="">Velg</option>
                ${alternativer}
              </select>
            </div>
          `;
        }
        return `
          <div class="row">
            ${labelHtml}
            <textarea id="${feltId}" class="field-answer" data-felt-id="${htmlEscape(felt.id)}" placeholder="${htmlEscape(felt.placeholder || "")}">${htmlEscape(svarverdi)}</textarea>
          </div>
        `;
      }).join("");
      innhold += `${feltHtml}<button id="lagreSvar">Lagre svar</button>`;
    } else {
      const svar = aktivProsessoekt?.svar?.[steg.id] || "";
      innhold += `
        <div class="row">
          <label for="fritekstSvar">Ditt svar</label>
          <textarea id="fritekstSvar" placeholder="Skriv svaret ditt her...">${htmlEscape(svar)}</textarea>
        </div>
        <button id="lagreSvar">Lagre svar</button>
      `;
    }
  }

  if (steg.type === "CONSENT_REQUEST") {
    innhold += `
      <p><strong>Formål:</strong> ${htmlEscape(steg.formaal || "Ikke oppgitt")}</p>
      <p><strong>Datakilder:</strong> ${htmlEscape((steg.dataKilder || []).join(", ") || "Ingen")}</p>
      <div class="actions">
        <button id="opprettSamtykke">Opprett samtykke</button>
        <button id="samtykk">Gi samtykke</button>
        <button id="ikkeSamtykk" class="secondary">Ikke samtykk</button>
      </div>
    `;
  }

  if (steg.type === "DATA_FETCH") {
    innhold += `<button id="kjorHandling">Kjør datahenting</button>`;
  }

  if (steg.type === "SJEKK") {
    innhold += `<button id="kjorHandling">Kjør sjekk</button>`;
  }

  if (steg.type === "SUMMARY") {
    innhold += `<button id="kjorHandling">Lag oppsummering</button>`;
  }

  if (steg.type === "SUBMIT") {
    innhold += `<button id="kjorHandling">Send søknad</button>`;
  }

  if (steg.type === "INFO") {
    innhold += `<div class="muted">Bruk Neste steg for å fortsette.</div>`;
  }

  aktivtStegEl.innerHTML = innhold;
  wireStegHandlinger(steg);
}

function wireStegHandlinger(steg: ProsessSteg): void {
  if (steg.type === "QUESTION") {
    krevEl("lagreSvar").onclick = async () => {
      try {
        // Enten ett fritekstsvar, eller ett per felt. Backend tar imot begge.
        let svar: string | Record<string, string>;
        if (Array.isArray(steg.felter) && steg.felter.length > 0) {
          const felter: Record<string, string> = {};
          const feltNoder = document.querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >("[data-felt-id]");
          for (const node of feltNoder) {
            const feltId = node.dataset.feltId;
            if (feltId) felter[feltId] = node.value.trim();
          }
          svar = felter;
          const mangler = steg.felter.filter((felt) => felt.obligatorisk && !felter[felt.id]);
          if (mangler.length > 0) {
            throw new Error(`Mangler svar for: ${mangler.map((felt) => felt.label).join(", ")}`);
          }
        } else {
          svar = krevEl<HTMLTextAreaElement>("fritekstSvar").value.trim();
        }
        // wireStegHandlinger kalles bare fra renderAktivtSteg, som returnerer
        // tidlig uten aktivProsessoekt?.aktivtSteg. Da finnes økten.
        const oekt = await postJson<Prosessoekt>(`http://localhost:8080/api/prosessoekter/${aktivProsessoekt!.oektsId}/svar`, {
          stegId: steg.id,
          svar
        });
        updateSessionView(oekt);
        visning.textContent = JSON.stringify(oekt, null, 2);
        setStatus("Svar lagret i prosessøkten.");
        log(`Svar lagret for steg ${steg.id}.`);
        renderAktivtSteg();
      } catch (error) {
        setStatus(feilmelding(error));
      }
    };
  }

  if (steg.type === "CONSENT_REQUEST") {
    krevEl("opprettSamtykke").onclick = async () => {
      await runStegHandling({ handling: "opprett-samtykke" }, "Samtykke opprettet.");
    };
    krevEl("samtykk").onclick = async () => {
      await runStegHandling({ handling: "samtykkesvar", status: "SAMTYKKET" }, "Samtykke registrert.");
    };
    krevEl("ikkeSamtykk").onclick = async () => {
      await runStegHandling({ handling: "samtykkesvar", status: "IKKE_SAMTYKKET" }, "Svar registrert uten samtykke.");
    };
  }

  if (steg.type === "DATA_FETCH" || steg.type === "SJEKK" || steg.type === "SUMMARY" || steg.type === "SUBMIT") {
    krevEl("kjorHandling").onclick = async () => {
      const meldinger: Record<string, string> = {
        DATA_FETCH: "Handling kjørt for datahenting.",
        SJEKK: "Sjekk utført.",
        SUMMARY: "Oppsummering laget.",
        SUBMIT: "Søknad sendt inn."
      };
      await runStegHandling({}, meldinger[steg.type]);
    };
  }
}

async function runStegHandling(payload: Record<string, unknown>, statusmelding: string): Promise<void> {
  try {
    const data = await postJson<{ oekt: Prosessoekt; resultat?: { melding?: string } }>(
      `http://localhost:8080/api/prosessoekter/${aktivProsessoekt!.oektsId}/handling`,
      payload
    );
    updateSessionView(data.oekt);
    visning.textContent = JSON.stringify(data.resultat, null, 2);
    // Et SJEKK-steg som ikke godkjennes setter okten til AVVIST og avslutter
    // flyten. Uten dette ville avslaget sett ut som et vanlig utfort steg.
    if (data.oekt?.status === "AVVIST") {
      const avvist = data.oekt.avvistMelding || data.resultat?.melding || "Prosessen ble avvist.";
      setStatus(`Avvist: ${avvist}`);
      log(`Avvist: ${avvist}`);
    } else {
      setStatus(statusmelding);
      log(statusmelding);
    }
    renderAktivtSteg();
  } catch (error) {
    setStatus(feilmelding(error));
    visning.textContent = JSON.stringify({ feil: feilmelding(error) }, null, 2);
  }
}

async function startProsess(): Promise<void> {
  try {
    const oekt = await postJson<Prosessoekt>("http://localhost:8080/api/prosessoekter", {
      personId: valgtPersonId(),
      prosessId: valgtProsessId(),
      sporingsId: `flyt-${Date.now()}`
    });
    updateSessionView(oekt);
    visning.textContent = JSON.stringify(oekt, null, 2);
    setStatus(`Prosess startet: ${aktivProsess?.navn || "ukjent prosess"}`);
    log("Prosess startet.");
    renderAktivtSteg();
  } catch (error) {
    setStatus(feilmelding(error));
  }
}

async function moveSteg(retning: number): Promise<void> {
  if (!aktivProsessoekt) {
    setStatus("Start en prosess først.");
    return;
  }
  try {
    const endepunkt = retning < 0 ? "forrige" : "neste";
    const oekt = await postJson<Prosessoekt>(`http://localhost:8080/api/prosessoekter/${aktivProsessoekt.oektsId}/${endepunkt}`);
    updateSessionView(oekt);
    visning.textContent = JSON.stringify(oekt, null, 2);
    setStatus(`Viser steg ${oekt.stegIndex + 1} av ${oekt.totaltAntallSteg}.`);
    renderAktivtSteg();
  } catch (error) {
    setStatus(feilmelding(error));
  }
}

krevEl("start").onclick = startProsess;
krevEl("forrige").onclick = () => moveSteg(-1);
krevEl("neste").onclick = () => moveSteg(1);
krevEl("hentLogg").onclick = async () => {
  try {
    const data = await getJson<unknown>(`http://localhost:8080/api/revisjonslogg/${sporingsId}`);
    visning.textContent = JSON.stringify(data, null, 2);
    setStatus("Revisjonslogg hentet.");
    log("Revisjonslogg hentet.");
  } catch (error) {
    setStatus(feilmelding(error));
  }
};

prosessvelger.onchange = () => {
  if (!aktivProsessoekt) {
    renderProsessOversikt();
  }
};

checkModell(aiBase, {
  konsekvens: "Oppsummeringen under kommer fra maler, ikke fra en modell."
});

// Log in first. requireLogin() returns false when it has already started
// navigating to ID-porten, and then there is nothing more to do on this load.
requireLogin().then((innlogget) => {
  if (!innlogget) return null;
  return loadGrunnlag().then(() => {
    setStatus(`Demo-GUI klar. Innlogget som ${meg?.visningsnavn}.`);
  });
}).catch((error: unknown) => {
  setStatus(`Kunne ikke laste grunnlag: ${feilmelding(error)}`);
});
