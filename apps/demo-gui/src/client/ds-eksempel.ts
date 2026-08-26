// Sidescript for ds-eksempel. Lastes som <script type="module">, så alt her har sitt
// eget scope — to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere.
//
// I motsetning til de andre sidene laster denne IKKE felles.ts eller felles.css.
// Det er med vilje: dette er malen team kopierer når de bygger egen frontend, og
// den skal stå på egne bein. Derfor har den sin egen krevEl nedenfor i stedet for
// å bruke den i felles.ts.
export {};

function krevEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Fant ikke elementet #${id} på siden.`);
  return element as T;
}

// Serialise the live DOM back to indented HTML, so every code block below a demo
// is the markup that is actually rendering. Hand-written samples drift; this
// cannot. Attribute values come from the DOM, so they are already what the parser
// accepted — but they still get escaped, because a value could contain a quote.
const EMPTY = new Set(["img", "input", "br", "hr", "source", "circle"]);
const ONE_LINE = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "summary", "label", "legend", "caption", "th", "td", "option", "li", "a", "button", "span", "code", "strong"]);

function attributes(element: Element): string {
  return [...element.attributes]
    .filter((attributt) => attributt.name !== "data-kode")
    .map((attributt) => {
      if (attributt.value === "") return ` ${attributt.name}`;
      return ` ${attributt.name}="${attributt.value.replace(/"/g, "&quot;")}"`;
    })
    .join("");
}

// Inline serialisation keeps children — collapsing them to textContent would drop
// the markup that matters, so a <td> holding a .ds-tag would print as bare text.
function serializeInline(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (EMPTY.has(tag)) return `<${tag}${attributes(element)} />`;
  const parts = [...element.childNodes]
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
      if (node.nodeType === Node.ELEMENT_NODE) return serializeInline(node as Element);
      return "";
    })
    .join("");
  return `<${tag}${attributes(element)}>${parts.trim()}</${tag}>`;
}

function serialize(element: Element, depth = 0): string {
  const indent = "  ".repeat(depth);
  const tag = element.tagName.toLowerCase();

  if (EMPTY.has(tag)) return `${indent}<${tag}${attributes(element)} />`;

  const children = [...element.children];
  const canInline =
    children.length === 0 ||
    (ONE_LINE.has(tag) && children.every((b) => ONE_LINE.has(b.tagName.toLowerCase()) || EMPTY.has(b.tagName.toLowerCase())));
  if (canInline) return `${indent}${serializeInline(element)}`;

  const inner = children.map((child) => serialize(child, depth + 1)).join("\n");
  return `${indent}<${tag}${attributes(element)}>\n${inner}\n${indent}</${tag}>`;
}

for (const vis of document.querySelectorAll<HTMLElement>(".vis")) {
  if (vis.dataset.kode === "nei") continue;
  const pre = document.createElement("pre");
  pre.className = "kode";
  pre.textContent = [...vis.children].map((child) => serialize(child)).join("\n\n");
  vis.parentElement?.append(pre);
}

// data-color-scheme belongs on the root element: the theme defines its colour
// variables on :root and on [data-color-scheme], so anything below inherits.
const mode = krevEl<HTMLSelectElement>("mode");
mode.onchange = () => document.documentElement.setAttribute("data-color-scheme", mode.value);

// data-size is inherited too. Setting it once on the gallery rescales every
// component inside it — that is the whole sizing mechanism, not a per-component prop.
const size = krevEl<HTMLSelectElement>("size");
const gallery = krevEl("gallery");
size.onchange = () => gallery.setAttribute("data-size", size.value);

// One real call, so the page proves it is inside the sandbox rather than a
// detached static demo.
const healthNote = krevEl("healthNote");
function showHelse(farge: string, tekst: string): void {
  healthNote.setAttribute("data-color", farge);
  const paragraph = document.createElement("p");
  paragraph.className = "ds-paragraph";
  paragraph.textContent = tekst;
  healthNote.replaceChildren(paragraph);
}

fetch("http://localhost:8080/helse")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
  .then((svar) => showHelse("success", `sandbox-backend svarer: ${svar.status ?? "ok"}. Du er inne i sandkassen.`))
  .catch((error: unknown) => showHelse("warning", `Fikk ikke svar fra sandbox-backend på 8080 (${error instanceof Error ? error.message : String(error)}). Malen virker likevel — den trenger ingen backend.`));
