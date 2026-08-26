// Sidescript for agent. Lastes som <script type="module">, så alt her har sitt
// eget scope - to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

renderTopNav("/agent");

const agentBase  = "http://localhost:8084";
const backendBase = "http://localhost:8080";
const aiBase = "http://localhost:8082";

// Svaret fra process-agent. Feltene varierer med hvor i løpet sesjonen er, så
// alt er valgfritt - det er formen tjenesten faktisk lover.
type AgentSvar = {
  sessionId?: string;
  message?: string;
  replies?: string[];
  grunnlag?: Grunnlag;
  awaiting?: string | null;
  selectedProcess?: { navn?: string };
  feil?: string;
  detalj?: string;
};

const personEl      = krevEl<HTMLSelectElement>("person");
const chatEl        = krevEl("chat");
const inputEl       = krevEl<HTMLTextAreaElement>("input");
const sessionInfoEl = krevEl("sessionInfo");

initChat(chatEl);

let sessionId: string | null = null;

function setSending(sending: boolean): void {
  krevEl<HTMLButtonElement>("send").disabled = sending;
  krevEl<HTMLButtonElement>("start").disabled = sending;
}

async function agentReq(
  path: string,
  options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<AgentSvar> {
  const res = await fetch(`${agentBase}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  // Ukontrollert JSON fra tråden; AgentSvar navngir formen vi regner med.
  const data = (await res.json()) as AgentSvar;
  if (!res.ok) {
    throw new Error(data.feil || data.detalj || `Feil ${res.status}`);
  }
  return data;
}

function updateSessionInfo(data: AgentSvar | null): void {
  if (!data || !sessionId) {
    sessionInfoEl.textContent = "Ingen aktiv agent-sesjon.";
    return;
  }
  const proc = data.selectedProcess?.navn || "–";
  const state = data.awaiting || "fullført";
  sessionInfoEl.textContent = `Sesjon: ${sessionId} | Prosess: ${proc} | Venter: ${state}`;
}

// ── init ─────────────────────────────────────────────────────────────────
async function loadPeople(): Promise<void> {
  try {
    const res = await fetch(`${backendBase}/api/personer`, { headers: withToken() });
    const people = (await res.json()) as Person[];
    showLoggedInPerson(personEl, people);
  } catch {
    addMsg("error", "Kunne ikke laste testbrukere fra backend.");
  }
}

// ── start session ────────────────────────────────────────────────────────
async function startSession(): Promise<void> {
  setSending(true);
  chatEl.innerHTML = "";
  sessionId = null;
  updateSessionInfo(null);

  try {
    addTyping();
    const created = await agentReq("/agent/sessions", {
      method: "POST",
      body: JSON.stringify({ personId: personEl.value })
    });
    removeTyping();

    sessionId = created.sessionId ?? null;
    updateSessionInfo(created);
    addMsg("system", `Sesjon startet for ${personEl.options[personEl.selectedIndex]?.text || personEl.value}`);
    addMsg("assistant", created.message ?? "");
  } catch (error) {
    removeTyping();
    addMsg("error", `Kunne ikke starte sesjon: ${feilmelding(error)}`);
  } finally {
    setSending(false);
    inputEl.focus();
  }
}

// ── send message ─────────────────────────────────────────────────────────
async function sendMessage(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) return;
  if (!sessionId) {
    addMsg("error", "Start en sesjon først.");
    return;
  }

  inputEl.value = "";
  addMsg("user", text);
  setSending(true);
  addTyping();

  try {
    const data = await agentReq(`/agent/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: text })
    });

    removeTyping();
    updateSessionInfo(data);

    for (const reply of data.replies || []) {
      addMsg("assistant", reply);
    }

    if (data.grunnlag) {
      addGrunnlagsfot(data.grunnlag);
    }

    if (!data.awaiting) {
      addMsg("system", "Prosessen er fullført.");
    }
  } catch (error) {
    removeTyping();
    addMsg("error", `Feil: ${feilmelding(error)}`);
  } finally {
    setSending(false);
    inputEl.focus();
  }
}

// ── event wiring ─────────────────────────────────────────────────────────
krevEl("start").onclick = () => startSession();
krevEl("send").onclick  = () => sendMessage();
krevEl("reset").onclick = () => {
  sessionId = null;
  chatEl.innerHTML = "";
  updateSessionInfo(null);
  addMsg("system", "Nullstilt. Velg bruker og start på nytt.");
};

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

// ── bootstrap ────────────────────────────────────────────────────────────
checkModell(aiBase, { konsekvens: "Agenten faller tilbake til heuristikk og maltekst." });

requireLogin().then((innlogget) => {
  // requireLogin() gir false når nettleseren allerede er på vei til ID-porten.
  if (innlogget) return loadPeople();
}).then(() => {
  addMsg("assistant", "Velg en testbruker og trykk «Start med AI-agent» for å begynne.");
});
