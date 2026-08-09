/*
 * Shared frontend helpers for demo-gui and process-builder.
 *
 * Plain globals, no module system: the pages are static HTML with inline
 * <script>, and keeping it that way is the point — a participant can read the
 * whole client in one file without a build step.
 *
 * Served by both frontends at /assets/felles.js.
 */

/* eslint-disable no-unused-vars */

let chatTarget = null;

function initChat(element) {
  chatTarget = element;
}

function htmlEscape(tekst) {
  return String(tekst ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("nb-NO").format(Number(value || 0));
}

function addMsg(role, text) {
  if (!chatTarget) return null;
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatTarget.appendChild(row);
  chatTarget.scrollTop = chatTarget.scrollHeight;
  return row;
}

function addTyping(tekst = "Tenker…") {
  if (!chatTarget || document.getElementById("typing")) return;
  const row = document.createElement("div");
  row.className = "msg assistant";
  row.id = "typing";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  bubble.appendChild(spinner);
  bubble.appendChild(document.createTextNode(tekst));
  row.appendChild(bubble);
  chatTarget.appendChild(row);
  chatTarget.scrollTop = chatTarget.scrollHeight;
}

function removeTyping() {
  document.getElementById("typing")?.remove();
}

/*
 * Which sources an answer was built from. Without this the citizen has no way
 * to tell a grounded answer from an invented one.
 */
function addGrunnlagsfot(grunnlag) {
  if (!chatTarget || !grunnlag) return;
  const kilder = Array.isArray(grunnlag.kilder) ? grunnlag.kilder : [];
  if (kilder.length === 0) return;

  const foot = document.createElement("div");
  foot.className = "grunnlag";
  foot.appendChild(document.createTextNode(`Basert på: ${kilder.join(" · ")}`));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Vis grunnlag";
  const detaljer = document.createElement("pre");
  detaljer.hidden = true;
  detaljer.textContent = JSON.stringify(grunnlag.verdier ?? {}, null, 2);

  toggle.onclick = () => {
    detaljer.hidden = !detaljer.hidden;
    toggle.textContent = detaljer.hidden ? "Vis grunnlag" : "Skjul grunnlag";
  };

  foot.appendChild(toggle);
  foot.appendChild(detaljer);
  chatTarget.appendChild(foot);
  chatTarget.scrollTop = chatTarget.scrollHeight;
}

/* ── Er modellen faktisk koblet på? ────────────────────────────────────────
 *
 * ai-gateway answers with template text when the model is down and sets an
 * advarsel field. Without this banner a broken setup looks exactly like a
 * working one — well-formed Norwegian prose, just from a template.
 */

function visModellBanner(tekst, elementId = "modellBanner") {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (!tekst) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  element.className = "banner";
  element.textContent = tekst;
}

async function sjekkModell(aiBase, valg = {}) {
  const konsekvens = valg.konsekvens || "Svarene under kommer fra maler, ikke fra en modell.";
  try {
    const res = await fetch(`${aiBase}/helse`);
    const data = await res.json();
    if (data.modellNaaBar) {
      visModellBanner(null, valg.elementId);
      return data;
    }
    visModellBanner(
      `⚠️ Modellen er ikke koblet på (${data.modell || data.provider}). ${konsekvens} ${data.feil || ""}`.trim(),
      valg.elementId
    );
    return data;
  } catch {
    visModellBanner(`⚠️ Får ikke kontakt med ai-gateway. ${konsekvens}`, valg.elementId);
    return null;
  }
}

/*
 * A single reply can fall back even when the gateway looked healthy at load,
 * so advarsel is surfaced where it happens too. Kept quiet by default: a
 * warning shown on every turn teaches the user to ignore it.
 */
function varsleOmFallback(result) {
  if (result && typeof result.advarsel === "string" && result.advarsel.trim()) {
    addMsg("system", `⚠️ ${result.advarsel}`);
  }
}
