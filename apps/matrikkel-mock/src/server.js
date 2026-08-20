import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8085);
const wsPath = "/geointegrasjon/matrikkel/wsapi/v1/BasisService";
const wsNamespace = "http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31";
const geonorgeAdresseBaseUrl = process.env.GEONORGE_ADRESSE_API_BASE_URL || "https://ws.geonorge.no/adresser/v1";
const matrikkelHttpTimeoutMs = Number(process.env.MATRIKKEL_HTTP_TIMEOUT_MS || 6000);
const maksSideStoerrelse = Number(process.env.MATRIKKEL_PAGE_MAX || 5000);
// Bønesheien is injected below for the fartsdempende case, and this is its owner.
// It is deliberately NOT applied to every property: doing that used to make
// person-001 a co-owner of all 8202 of them, so every ownership check said yes
// and the documented "Fjøsangerveien gives a rejection" could never happen.
const bonesheienEierPersonId = "person-001";

function normaliser(verdi) {
  return String(verdi || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

function safeNumber(verdi, fallback = 0) {
  const n = Number.parseInt(String(verdi ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parsePagination(searchParams) {
  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const harPagination = limitRaw !== null || offsetRaw !== null;
  if (!harPagination) {
    return { harPagination, limit: null, offset: 0 };
  }

  const limit = Math.max(1, Math.min(safeNumber(limitRaw, 100), maksSideStoerrelse));
  const offset = Math.max(0, safeNumber(offsetRaw, 0));
  return { harPagination, limit, offset };
}

function paginer(items, searchParams) {
  const { harPagination, limit, offset } = parsePagination(searchParams);
  if (!harPagination) return items;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit
  };
}

function normaliserAdresse(verdi) {
  return normaliser(verdi).replace(/\s+/g, " ").trim();
}

function lagTomtRegister(kilde) {
  return {
    gater: [],
    gaterPerId: new Map(),
    gaterPerNormalisertNavn: new Map(),
    eiendommer: [],
    eiendomPerId: new Map(),
    eiendomPerGnrBnr: new Map(),
    eiendomPerNormalisertAdresse: new Map(),
    eiendomPerAdressePrefix: new Map(),
    kilde,
    lastetTidspunkt: new Date().toISOString()
  };
}

async function readMatrikkelData() {
  // matrikkel.json is the full Bergen extract: 220 streets, 8202 properties with
  // coordinates. It was 5.9 MB of dead weight that no code read, while the case
  // that needs streets had four to choose from. matrikkel.seed.json stays as the
  // small fixture the mock's own tests point at via MATRIKKEL_DATA_FILE.
  const kandidatfiler = [
    process.env.MATRIKKEL_DATA_FILE,
    path.resolve(__dirname, "../../../data/matrikkel.json"),
    path.resolve(__dirname, "../data/matrikkel.json"),
    path.resolve(__dirname, "../../../data/matrikkel.seed.json"),
    path.resolve(__dirname, "../data/matrikkel.seed.json")
  ].filter(Boolean);

  for (const fil of kandidatfiler) {
    try {
      if (fil.endsWith(".jsonl") || fil.endsWith(".ndjson") || fil.endsWith(".jsonl.gz") || fil.endsWith(".ndjson.gz")) {
        return await lesJsonlRegister(fil);
      }
      return await lesJsonRegister(fil);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  throw new Error("Fant ikke matrikkeldata. Sett MATRIKKEL_DATA_FILE eller legg data/matrikkel.json i repoet.");
}

function leggTilPrefixIndeks(register, prefix, matrikkelId) {
  if (!prefix) return;
  const liste = register.eiendomPerAdressePrefix.get(prefix) || [];
  if (liste[liste.length - 1] !== matrikkelId) {
    liste.push(matrikkelId);
    register.eiendomPerAdressePrefix.set(prefix, liste);
  }
}

function hentGateNoekkel(gate) {
  if (gate?.gateId) return String(gate.gateId);
  return [
    normaliser(gate?.adressenavn),
    String(gate?.kommunenummer || "")
  ].join("|");
}

function hentEllerOpprettGate(register, gateInput = {}) {
  const noekkel = hentGateNoekkel(gateInput);
  if (register.gaterPerId.has(noekkel)) {
    return register.gaterPerId.get(noekkel);
  }

  const gate = {
    gateId: String(gateInput.gateId || noekkel),
    adressenavn: String(gateInput.adressenavn || ""),
    kommunenummer: String(gateInput.kommunenummer || ""),
    kommune: String(gateInput.kommune || ""),
    postnummer: String(gateInput.postnummer || ""),
    poststed: String(gateInput.poststed || ""),
    eiendomIds: []
  };

  register.gaterPerId.set(noekkel, gate);
  register.gater.push(gate);

  const normNavn = normaliser(gate.adressenavn);
  if (normNavn) {
    const liste = register.gaterPerNormalisertNavn.get(normNavn) || [];
    liste.push(gate);
    register.gaterPerNormalisertNavn.set(normNavn, liste);
  }

  return gate;
}

function normaliserTekst(verdi) {
  return String(verdi || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function leggTilBonesheienHvisMangler(register) {
  const finnesAllerede = register.gater.some((gate) => normaliserTekst(gate.adressenavn) === normaliserTekst("Bønesheien"));
  if (finnesAllerede) return;

  const gate = hentEllerOpprettGate(register, {
    gateId: "gate-bonesheien-bergen",
    adressenavn: "Bønesheien",
    kommunenummer: "4601",
    kommune: "Bergen",
    postnummer: "5154",
    poststed: "BØNES"
  });
  leggTilEiendom(register, gate, {
    matrikkelId: "matr-bonesheien-258",
    gnr: 20,
    bnr: 258,
    adresse: "Bønesheien 258",
    bruksenhetstype: "bolig",
    eiere: [bonesheienEierPersonId],
    postnummer: "5154",
    poststed: "BØNES"
  });
}

function finnEiendomViaLive(register, adresseSoek) {
  return finnEiendomLive(adresseSoek).then((treff) => {
    if (!treff) return null;
    const gate = hentEllerOpprettGate(register, {
      gateId: `geo-${treff.kommunenummer || ""}-${normaliser(treff.adressenavn)}`,
      adressenavn: treff.adressenavn,
      kommunenummer: treff.kommunenummer,
      kommune: treff.kommune,
      postnummer: treff.postnummer,
      poststed: treff.poststed
    });
    return { gate, eiendom: treff };
  });
}

async function finnGaterViaLive(gateSoek, includeEiendommer = false, kommunenummer = null) {
  return finnGaterLive(gateSoek, includeEiendommer, kommunenummer);
}

function jsonResponse(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,SOAPAction"
  });
  response.end(JSON.stringify(data, null, 2));
}

function textResponse(response, statusCode, data, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,SOAPAction"
  });
  response.end(data);
}

function xmlEscape(verdi) {
  return String(verdi)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function finnTagg(xml, taggnavn) {
  const treff = xml.match(new RegExp(`<(?:\\w+:)?${taggnavn}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${taggnavn}>`, "i"));
  return treff ? treff[1].trim() : null;
}

function findOperation(xml) {
  const bodyTreff = xml.match(/<(?:\w+:)?Body[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/i);
  if (!bodyTreff) return null;
  const operasjonTreff = bodyTreff[1].match(/<\s*(?:\w+:)?([A-Za-z0-9_]+)\b[^>]*>/);
  return operasjonTreff ? operasjonTreff[1] : null;
}

function byggMatrikkelNoekkel(eiendom) {
  return `${safeNumber(eiendom.gnr, -1)}:${safeNumber(eiendom.bnr, -1)}`;
}

function leggTilEiendom(register, gate, eiendomInput = {}) {
  const matrikkelId = String(eiendomInput.matrikkelId || "").trim();
  if (!matrikkelId || register.eiendomPerId.has(matrikkelId)) {
    return;
  }

  const enriched = enrichEiendom(gate, eiendomInput);
  const eiendom = {
    ...enriched,
    matrikkelId,
    adressenavn: gate.adressenavn,
    kommunenummer: gate.kommunenummer,
    kommune: gate.kommune,
    gateId: gate.gateId,
    syntetisk: true
  };

  register.eiendommer.push(eiendom);
  register.eiendomPerId.set(matrikkelId, eiendom);
  gate.eiendomIds.push(matrikkelId);

  const matrikkelNoekkel = byggMatrikkelNoekkel(eiendom);
  const perGnrBnr = register.eiendomPerGnrBnr.get(matrikkelNoekkel) || [];
  perGnrBnr.push(matrikkelId);
  register.eiendomPerGnrBnr.set(matrikkelNoekkel, perGnrBnr);

  const normAdresse = normaliserAdresse(eiendom.adresse);
  if (normAdresse) {
    const perAdresse = register.eiendomPerNormalisertAdresse.get(normAdresse) || [];
    perAdresse.push(matrikkelId);
    register.eiendomPerNormalisertAdresse.set(normAdresse, perAdresse);
    leggTilPrefixIndeks(register, normAdresse.split(" ")[0], matrikkelId);
  }

  if (!gate.postnummer && eiendom.postnummer) gate.postnummer = eiendom.postnummer;
  if (!gate.poststed && eiendom.poststed) gate.poststed = eiendom.poststed;
}

function ferdigstillRegister(register) {
  leggTilBonesheienHvisMangler(register);
  register.gater.sort((a, b) => a.adressenavn.localeCompare(b.adressenavn, "nb"));
  for (const gate of register.gater) {
    gate.antallEiendommer = gate.eiendomIds.length;
    gate.antallBoligeiendommer = gate.eiendomIds
      .map((id) => register.eiendomPerId.get(id))
      .filter((eiendom) => eiendom?.bruksenhetstype === "bolig").length;
  }
}

function gateSomRespons(register, gate, includeEiendommer = false) {
  const base = {
    gateId: gate.gateId,
    adressenavn: gate.adressenavn,
    kommunenummer: gate.kommunenummer,
    kommune: gate.kommune,
    postnummer: gate.postnummer,
    poststed: gate.poststed,
    antallEiendommer: gate.antallEiendommer,
    antallBoligeiendommer: gate.antallBoligeiendommer
  };
  if (!includeEiendommer) return base;
  return {
    ...base,
    eiendommer: gate.eiendomIds
      .map((id) => register.eiendomPerId.get(id))
      .filter(Boolean)
  };
}

function gateTreffSomListe(gateTreff, includeEiendommer = false) {
  return gateTreff.map((gate) => {
    const base = gateSomRespons({ eiendomPerId: new Map() }, gate, includeEiendommer);
    if (!includeEiendommer) return base;
    return {
      ...base,
      eiendommer: Array.isArray(gate.eiendommer) ? gate.eiendommer : []
    };
  });
}

async function lesJsonRegister(fil) {
  const json = JSON.parse(await readFile(fil, "utf8"));
  const register = lagTomtRegister({ fil, format: "json", metadata: json.kilde || null });
  for (const gateInput of json.gater || []) {
    const gate = hentEllerOpprettGate(register, gateInput);
    for (const eiendom of gateInput.eiendommer || []) {
      leggTilEiendom(register, gate, eiendom);
    }
  }
  ferdigstillRegister(register);
  return register;
}

function parseJsonlLinje(raw, linjeNr) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Ugyldig JSONL pa linje ${linjeNr}: ${error.message}`);
  }
}

function utledGateFraFlatLinje(post) {
  return {
    gateId: post.gateId,
    adressenavn: post.adressenavn,
    kommunenummer: post.kommunenummer,
    kommune: post.kommune,
    postnummer: post.postnummer,
    poststed: post.poststed
  };
}

function utledEiendomFraFlatLinje(post) {
  return {
    matrikkelId: post.matrikkelId,
    gnr: post.gnr,
    bnr: post.bnr,
    festenummer: post.festenummer,
    undernummer: post.undernummer,
    adressekode: post.adressekode,
    adresse: post.adresse,
    husnummer: post.husnummer,
    husbokstav: post.husbokstav,
    postnummer: post.postnummer,
    poststed: post.poststed,
    bruksenhetstype: post.bruksenhetstype,
    adressetilleggsnavn: post.adressetilleggsnavn,
    objtype: post.objtype,
    koordinater: post.koordinater,
    eiere: post.eiere
  };
}

async function lesJsonlRegister(fil) {
  // Validate early so missing files become normal ENOENT errors (handled by fallback logic).
  await access(fil, constants.R_OK);
  const input = createReadStream(fil);
  const stream = fil.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  const leser = createInterface({ input: stream, crlfDelay: Infinity });
  const register = lagTomtRegister({ fil, format: fil.endsWith(".gz") ? "jsonl.gz" : "jsonl", metadata: null });
  let linjeNr = 0;

  for await (const linje of leser) {
    linjeNr += 1;
    const trimmed = linje.trim();
    if (!trimmed) continue;
    const post = parseJsonlLinje(trimmed, linjeNr);

    if (post.type === "meta") {
      register.kilde.metadata = post;
      continue;
    }

    const gateData = post.gate || utledGateFraFlatLinje(post);
    const eiendomData = post.eiendom || utledEiendomFraFlatLinje(post);
    if (!gateData?.adressenavn || !eiendomData?.matrikkelId) {
      continue;
    }

    const gate = hentEllerOpprettGate(register, gateData);
    leggTilEiendom(register, gate, eiendomData);
  }

  ferdigstillRegister(register);
  return register;
}

function finnGate(register, gateSoek) {
  const soek = normaliser(gateSoek);
  if (!soek) return null;

  const eksakt = register.gaterPerNormalisertNavn.get(soek);
  if (eksakt?.length) return eksakt[0];

  return register.gater.find((gate) => normaliser(gate.adressenavn).includes(soek)) || null;
}

function finnGater(register, gateSoek) {
  const soek = normaliser(gateSoek);
  if (!soek) return register.gater;
  return register.gater.filter((gate) => normaliser(gate.adressenavn).includes(soek));
}

function finnEiendomFraAdresse(register, adresseSoek) {
  const soek = normaliserAdresse(adresseSoek);
  if (!soek) return null;

  const eksakt = register.eiendomPerNormalisertAdresse.get(soek);
  if (eksakt?.length) {
    return register.eiendomPerId.get(eksakt[0]) || null;
  }

  const prefix = soek.split(" ")[0];
  const kandidater = register.eiendomPerAdressePrefix.get(prefix) || [];
  for (const matrikkelId of kandidater) {
    const eiendom = register.eiendomPerId.get(matrikkelId);
    if (!eiendom) continue;
    const adresse = normaliserAdresse(eiendom.adresse);
    if (adresse === soek || adresse.includes(soek) || soek.includes(adresse)) {
      return eiendom;
    }
  }

  for (const eiendom of register.eiendommer) {
    const adresse = normaliserAdresse(eiendom.adresse);
    if (adresse === soek || adresse.includes(soek) || soek.includes(adresse)) {
      return eiendom;
    }
  }

  return null;
}

function finnEiendommerFraAdresse(register, adresseSoek) {
  const soek = normaliserAdresse(adresseSoek);
  if (!soek) return [];

  const normPrefix = soek.split(" ")[0];
  const kandidaterFraPrefix = register.eiendomPerAdressePrefix.get(normPrefix) || [];
  const kandidatIds = kandidaterFraPrefix.length ? kandidaterFraPrefix : register.eiendommer.map((e) => e.matrikkelId);

  const filtrert = [];
  for (const matrikkelId of kandidatIds) {
    const eiendom = register.eiendomPerId.get(matrikkelId);
    if (!eiendom) continue;
    const adresse = normaliserAdresse(eiendom.adresse);
    if (adresse === soek || adresse.includes(soek) || soek.includes(adresse)) {
      filtrert.push(eiendom);
    }
  }

  return filtrert;
}

function enrichEiendom(gate, eiendom) {
  const adresse = String(eiendom.adresse || "").trim();
  const match = adresse.match(/(\d+)([A-Za-zÆØÅæøå]?)$/u);
  const husnummer = eiendom.husnummer ?? (match ? Number.parseInt(match[1], 10) : null);
  const husbokstav = eiendom.husbokstav ?? (match && match[2] ? match[2].toUpperCase() : null);
  return {
    ...eiendom,
    adresse,
    husnummer,
    husbokstav,
    festenummer: eiendom.festenummer ?? 0,
    undernummer: eiendom.undernummer ?? 0,
    adressekode: eiendom.adressekode ?? null,
    postnummer: eiendom.postnummer || gate.postnummer || "",
    poststed: eiendom.poststed || gate.poststed || "",
    koordinater: eiendom.koordinater || { lat: 0, lon: 0, epsg: "EPSG:4258" },
    adressetilleggsnavn: eiendom.adressetilleggsnavn ?? null,
    objtype: eiendom.objtype || "Vegadresse"
  };
}

function finnEiendom(register, matrikkelId, gnr, bnr) {
  if (matrikkelId) {
    return register.eiendomPerId.get(matrikkelId) || null;
  }

  if (gnr !== null && bnr !== null) {
    const kandidater = register.eiendomPerGnrBnr.get(`${safeNumber(gnr, -1)}:${safeNumber(bnr, -1)}`) || [];
    if (kandidater.length) {
      return register.eiendomPerId.get(kandidater[0]) || null;
    }
  }

  return null;
}

function normaliserGeonorgeSoek(verdi) {
  return normaliser(verdi)
    .replaceAll("ø", "o")
    .replaceAll("æ", "ae")
    .replaceAll("å", "aa");
}

function geonorgeQueryVariants(query) {
  const tekst = String(query || "").trim();
  if (!tekst) return [];
  const varianter = new Set([
    tekst,
    normaliserGeonorgeSoek(tekst),
    tekst.replaceAll("ø", "o").replaceAll("Ø", "O"),
    tekst.replaceAll("æ", "ae").replaceAll("Æ", "AE"),
    tekst.replaceAll("å", "aa").replaceAll("Å", "AA")
  ]);
  return [...varianter].filter(Boolean);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), matrikkelHttpTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "workshop-ai-matrikkel-mock/0.1 (+local sandbox)" }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.feilmelding || data?.feil || `HTTP ${res.status}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timeout mot Geonorge etter ${matrikkelHttpTimeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function geonorgeAdresseTekst(adresse) {
  if (adresse?.adressetekst) return String(adresse.adressetekst).replace(/\s+/g, " ").trim();
  const navn = String(adresse?.adressenavn || "").trim();
  const nummer = safeNumber(adresse?.nummer, 0);
  const bokstav = String(adresse?.bokstav || "").trim().toUpperCase();
  return [navn, nummer ? `${nummer}${bokstav}` : ""].filter(Boolean).join(" ").trim();
}

function byggAdresseKjerne(verdi) {
  const tekst = normaliser(verdi).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const treff = tekst.match(/([\p{L}][\p{L}\s.-]*?(?:gata|gate|veien|vegen)\s+\d+[\p{L}]?)/iu);
  return treff?.[1] ? normaliser(treff[1]).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim() : tekst;
}

function velgBesteLiveAdresse(adresser, query) {
  if (!Array.isArray(adresser) || !adresser.length) return null;
  const soek = normaliser(normaliserGeonorgeSoek(query)).replace(/\s+/g, " ").trim();
  const soekKjerne = byggAdresseKjerne(query);
  const kandidatTekst = (adresse) => normaliser(geonorgeAdresseTekst(adresse)).replace(/\s+/g, " ").trim();
  const kandidatKjerne = (adresse) => byggAdresseKjerne(geonorgeAdresseTekst(adresse));
  const eksakt = adresser.find((adresse) => kandidatTekst(adresse) === soek);
  if (eksakt) return eksakt;
  const eksaktKjerne = adresser.find((adresse) => kandidatKjerne(adresse) === soekKjerne);
  if (eksaktKjerne) return eksaktKjerne;
  const starterMed = adresser.find((adresse) => kandidatTekst(adresse).startsWith(soek));
  if (starterMed) return starterMed;
  const starterMedKjerne = adresser.find((adresse) => kandidatKjerne(adresse).startsWith(soekKjerne));
  if (starterMedKjerne) return starterMedKjerne;
  const inneholder = adresser.find((adresse) => kandidatTekst(adresse).includes(soek));
  if (inneholder) return inneholder;
  const inneholderKjerne = adresser.find((adresse) => kandidatKjerne(adresse).includes(soekKjerne));
  return inneholderKjerne || adresser[0] || null;
}

function geonorgeAdresseTilGate(adresse) {
  return {
    gateId: `geo-${adresse.kommunenummer || ""}-${normaliser(adresse.adressenavn)}`,
    adressenavn: String(adresse.adressenavn || ""),
    kommunenummer: String(adresse.kommunenummer || ""),
    kommune: String(adresse.kommunenavn || ""),
    postnummer: String(adresse.postnummer || ""),
    poststed: String(adresse.poststed || ""),
    antallEiendommer: 1,
    antallBoligeiendommer: 0
  };
}

function geonorgeAdresseTilEiendom(adresse) {
  const husnummer = safeNumber(adresse?.nummer, 0);
  const husbokstav = String(adresse?.bokstav || "").trim().toUpperCase() || null;
  return {
    matrikkelId: `geo-${String(adresse?.kommunenummer || "")}-${safeNumber(adresse?.adressekode, 0)}-${husnummer}${husbokstav || ""}-${safeNumber(adresse?.gardsnummer, 0)}-${safeNumber(adresse?.bruksnummer, 0)}`,
    gnr: safeNumber(adresse?.gardsnummer, 0),
    bnr: safeNumber(adresse?.bruksnummer, 0),
    festenummer: safeNumber(adresse?.festenummer, 0),
    undernummer: safeNumber(adresse?.undernummer, 0) || null,
    adressekode: safeNumber(adresse?.adressekode, 0),
    adresse: geonorgeAdresseTekst(adresse),
    husnummer,
    husbokstav,
    postnummer: String(adresse?.postnummer || ""),
    poststed: String(adresse?.poststed || ""),
    bruksenhetstype: "ukjent",
    adressenavn: String(adresse?.adressenavn || ""),
    kommunenummer: String(adresse?.kommunenummer || ""),
    kommune: String(adresse?.kommunenavn || ""),
    objtype: String(adresse?.objtype || "Vegadresse"),
    koordinater: adresse?.representasjonspunkt
      ? {
          lat: Number(adresse.representasjonspunkt.lat || 0),
          lon: Number(adresse.representasjonspunkt.lon || 0),
          epsg: String(adresse.representasjonspunkt.epsg || "EPSG:4258")
        }
      : null,
    eiere: [],
    syntetisk: false,
    kilde: {
      navn: "Geonorge adresser v1",
      type: "offentlig-adressegrunnlag"
    }
  };
}

function byggLiveGateTreff(adresser, includeEiendommer = false) {
  const perGate = new Map();
  for (const adresse of adresser || []) {
    if (!adresse?.adressenavn) continue;
    const key = `${adresse.kommunenummer || ""}|${normaliser(adresse.adressenavn)}`;
    if (!perGate.has(key)) {
      perGate.set(key, {
        gateId: `geo-${String(adresse.kommunenummer || "")}-${normaliser(adresse.adressenavn)}`,
        adressenavn: String(adresse.adressenavn || ""),
        kommunenummer: String(adresse.kommunenummer || ""),
        kommune: String(adresse.kommunenavn || ""),
        postnummer: String(adresse.postnummer || ""),
        poststed: String(adresse.poststed || ""),
        antallEiendommer: 0,
        antallBoligeiendommer: 0,
        eiendommer: []
      });
    }
    const gate = perGate.get(key);
    gate.antallEiendommer += 1;
    const eiendom = geonorgeAdresseTilEiendom(adresse);
    if (includeEiendommer) {
      gate.eiendommer.push(eiendom);
    }
  }

  return [...perGate.values()].map((gate) => ({
    ...gate,
    eiendommer: includeEiendommer ? gate.eiendommer.sort((a, b) => a.adresse.localeCompare(b.adresse, "nb")) : []
  })).sort((a, b) => a.adressenavn.localeCompare(b.adressenavn, "nb"));
}

async function hentLiveAdresser(gateSoek, kommunenummer = null) {
  const term = String(gateSoek || "").trim();
  if (!term) return [];

  const kandidater = [];
  for (const variant of geonorgeQueryVariants(term)) {
    const params = new URLSearchParams({ sok: variant, treffPerSide: "50", side: "0" });
    if (kommunenummer) params.set("kommunenummer", String(kommunenummer));
    const data = await fetchJson(`${geonorgeAdresseBaseUrl}/sok?${params.toString()}`);
    kandidater.push(...(Array.isArray(data?.adresser) ? data.adresser : []));
  }
  return kandidater;
}

async function finnGaterLive(gateSoek, includeEiendommer = false, kommunenummer = null) {
  return byggLiveGateTreff(await hentLiveAdresser(gateSoek, kommunenummer), includeEiendommer);
}

async function finnEiendomLive(adresseSoek) {
  const term = String(adresseSoek || "").trim();
  if (!term) return null;
  const adresser = await hentLiveAdresser(term);
  const adresseTreff = velgBesteLiveAdresse(adresser, term);
  return adresseTreff ? geonorgeAdresseTilEiendom(adresseTreff) : null;
}

function soapEnvelope(innhold) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="${wsNamespace}">\n  <soapenv:Body>\n${innhold}\n  </soapenv:Body>\n</soapenv:Envelope>`;
}

function soapFault(feilkode, melding) {
  return soapEnvelope(`    <soapenv:Fault>\n      <faultcode>${xmlEscape(feilkode)}</faultcode>\n      <faultstring>${xmlEscape(melding)}</faultstring>\n    </soapenv:Fault>`);
}

function wsdlDocument(baseUrl) {
  const serviceUrl = `${baseUrl}${wsPath}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions
  name="MatrikkelBasisMock"
  targetNamespace="${wsNamespace}"
  xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:tns="${wsNamespace}">
  <wsdl:types>
    <xs:schema targetNamespace="${wsNamespace}" elementFormDefault="qualified">
      <xs:element name="FinnVeger" type="xs:anyType"/>
      <xs:element name="FinnMatrikkelenheter" type="xs:anyType"/>
      <xs:element name="HentMatrikkelenhet" type="xs:anyType"/>
      <xs:element name="HentEiere" type="xs:anyType"/>
      <xs:element name="FinnVegerResponse" type="xs:anyType"/>
      <xs:element name="FinnMatrikkelenheterResponse" type="xs:anyType"/>
      <xs:element name="HentMatrikkelenhetResponse" type="xs:anyType"/>
      <xs:element name="HentEiereResponse" type="xs:anyType"/>
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="FinnVegerRequest"><wsdl:part name="parameters" element="tns:FinnVeger"/></wsdl:message>
  <wsdl:message name="FinnVegerResponse"><wsdl:part name="parameters" element="tns:FinnVegerResponse"/></wsdl:message>
  <wsdl:message name="FinnMatrikkelenheterRequest"><wsdl:part name="parameters" element="tns:FinnMatrikkelenheter"/></wsdl:message>
  <wsdl:message name="FinnMatrikkelenheterResponse"><wsdl:part name="parameters" element="tns:FinnMatrikkelenheterResponse"/></wsdl:message>
  <wsdl:message name="HentMatrikkelenhetRequest"><wsdl:part name="parameters" element="tns:HentMatrikkelenhet"/></wsdl:message>
  <wsdl:message name="HentMatrikkelenhetResponse"><wsdl:part name="parameters" element="tns:HentMatrikkelenhetResponse"/></wsdl:message>
  <wsdl:message name="HentEiereRequest"><wsdl:part name="parameters" element="tns:HentEiere"/></wsdl:message>
  <wsdl:message name="HentEiereResponse"><wsdl:part name="parameters" element="tns:HentEiereResponse"/></wsdl:message>
  <wsdl:portType name="MatrikkelBasisPortType">
    <wsdl:operation name="FinnVeger"><wsdl:input message="tns:FinnVegerRequest"/><wsdl:output message="tns:FinnVegerResponse"/></wsdl:operation>
    <wsdl:operation name="FinnMatrikkelenheter"><wsdl:input message="tns:FinnMatrikkelenheterRequest"/><wsdl:output message="tns:FinnMatrikkelenheterResponse"/></wsdl:operation>
    <wsdl:operation name="HentMatrikkelenhet"><wsdl:input message="tns:HentMatrikkelenhetRequest"/><wsdl:output message="tns:HentMatrikkelenhetResponse"/></wsdl:operation>
    <wsdl:operation name="HentEiere"><wsdl:input message="tns:HentEiereRequest"/><wsdl:output message="tns:HentEiereResponse"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="MatrikkelBasisBinding" type="tns:MatrikkelBasisPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="FinnVeger"><soap:operation soapAction="FinnVeger"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="FinnMatrikkelenheter"><soap:operation soapAction="FinnMatrikkelenheter"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="HentMatrikkelenhet"><soap:operation soapAction="HentMatrikkelenhet"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="HentEiere"><soap:operation soapAction="HentEiere"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="MatrikkelBasisMockService">
    <wsdl:port name="MatrikkelBasisMockPort" binding="tns:MatrikkelBasisBinding">
      <soap:address location="${serviceUrl}"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}

function byggGateReturn(gate) {
  return [
    "      <return>",
    `        <gateId>${xmlEscape(gate.gateId)}</gateId>`,
    `        <adressenavn>${xmlEscape(gate.adressenavn)}</adressenavn>`,
    `        <kommunenummer>${xmlEscape(gate.kommunenummer)}</kommunenummer>`,
    `        <kommune>${xmlEscape(gate.kommune)}</kommune>`,
    `        <postnummer>${xmlEscape(gate.postnummer)}</postnummer>`,
    `        <poststed>${xmlEscape(gate.poststed)}</poststed>`,
    "      </return>"
  ].join("\n");
}

function byggEiendomReturn(gate, eiendom) {
  const enriched = enrichEiendom(gate, eiendom);
  return [
    "      <return>",
    `        <matrikkelId>${xmlEscape(enriched.matrikkelId)}</matrikkelId>`,
    `        <gnr>${xmlEscape(enriched.gnr)}</gnr>`,
    `        <bnr>${xmlEscape(enriched.bnr)}</bnr>`,
    `        <festenummer>${xmlEscape(enriched.festenummer)}</festenummer>`,
    `        <undernummer>${xmlEscape(enriched.undernummer)}</undernummer>`,
    `        <adressekode>${xmlEscape(enriched.adressekode ?? "")}</adressekode>`,
    `        <adresse>${xmlEscape(enriched.adresse)}</adresse>`,
    `        <husnummer>${xmlEscape(enriched.husnummer ?? "")}</husnummer>`,
    `        <husbokstav>${xmlEscape(enriched.husbokstav || "")}</husbokstav>`,
    `        <postnummer>${xmlEscape(enriched.postnummer)}</postnummer>`,
    `        <poststed>${xmlEscape(enriched.poststed)}</poststed>`,
    `        <bruksenhetstype>${xmlEscape(enriched.bruksenhetstype)}</bruksenhetstype>`,
    `        <adressenavn>${xmlEscape(gate.adressenavn)}</adressenavn>`,
    `        <kommunenummer>${xmlEscape(gate.kommunenummer)}</kommunenummer>`,
    `        <kommune>${xmlEscape(gate.kommune || "")}</kommune>`,
    "      </return>"
  ].join("\n");
}

async function readBody(request) {
  const chunks = [];
  for await (const del of request) {
    chunks.push(del);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function handterSoap(operasjon, xml, register) {
  if (operasjon === "FinnVeger") {
    const tekst = finnTagg(xml, "soeketekst") || finnTagg(xml, "adressenavn") || "";
    const kommunenummer = finnTagg(xml, "kommunenummer");
    const gater = register.gater.filter((gate) => {
      const matcherKommune = !kommunenummer || gate.kommunenummer === kommunenummer;
      const matcherTekst = !tekst || normaliser(gate.adressenavn).includes(normaliser(tekst));
      return matcherKommune && matcherTekst;
    });

    return soapEnvelope(`    <mat:FinnVegerResponse>\n${gater.map(byggGateReturn).join("\n")}\n    </mat:FinnVegerResponse>`);
  }

  if (operasjon === "FinnMatrikkelenheter") {
    const gateSoek = finnTagg(xml, "adressenavn") || finnTagg(xml, "soeketekst") || finnTagg(xml, "gate");
    const kommunenummer = finnTagg(xml, "kommunenummer");
    const gater = register.gater.filter((gate) => {
      const matcherKommune = !kommunenummer || gate.kommunenummer === kommunenummer;
      const matcherGate = !gateSoek || normaliser(gate.adressenavn).includes(normaliser(gateSoek));
      return matcherKommune && matcherGate;
    });
    const eiendommer = gater.flatMap((gate) => gate.eiendomIds.map((id) => register.eiendomPerId.get(id)).filter(Boolean));

    return soapEnvelope(`    <mat:FinnMatrikkelenheterResponse>\n${eiendommer.map((eiendom) => byggEiendomReturn({
      adressenavn: eiendom.adressenavn,
      kommunenummer: eiendom.kommunenummer,
      kommune: eiendom.kommune,
      postnummer: eiendom.postnummer,
      poststed: eiendom.poststed
    }, eiendom)).join("\n")}\n    </mat:FinnMatrikkelenheterResponse>`);
  }

  if (operasjon === "HentMatrikkelenhet") {
    const matrikkelId = finnTagg(xml, "matrikkelId") || finnTagg(xml, "matrikkelenhetsId");
    const gnr = finnTagg(xml, "gaardsnummer") || finnTagg(xml, "gnr");
    const bnr = finnTagg(xml, "bruksnummer") || finnTagg(xml, "bnr");
    const treff = finnEiendom(register, matrikkelId, gnr, bnr);
    if (!treff) {
      return soapFault("Client.NotFound", "Fant ikke matrikkelenhet for forespoerselen.");
    }

    return soapEnvelope(`    <mat:HentMatrikkelenhetResponse>\n${byggEiendomReturn({
      adressenavn: treff.adressenavn,
      kommunenummer: treff.kommunenummer,
      kommune: treff.kommune,
      postnummer: treff.postnummer,
      poststed: treff.poststed
    }, treff)}\n    </mat:HentMatrikkelenhetResponse>`);
  }

  if (operasjon === "HentEiere") {
    const matrikkelId = finnTagg(xml, "matrikkelId") || finnTagg(xml, "matrikkelenhetsId");
    const gnr = finnTagg(xml, "gaardsnummer") || finnTagg(xml, "gnr");
    const bnr = finnTagg(xml, "bruksnummer") || finnTagg(xml, "bnr");
    const treff = finnEiendom(register, matrikkelId, gnr, bnr);
    if (!treff) {
      return soapFault("Client.NotFound", "Fant ikke matrikkelenhet for forespoerselen.");
    }

    const eiere = treff.eiere || [];
    return soapEnvelope(`    <mat:HentEiereResponse>\n${eiere.map((eier) => `      <return><personId>${xmlEscape(eier)}</personId></return>`).join("\n")}\n    </mat:HentEiereResponse>`);
  }

  return soapFault(
    "Client.UnsupportedOperation",
    `Operasjonen ${operasjon} er ikke implementert i mocken. Stoettede: FinnVeger, FinnMatrikkelenheter, HentMatrikkelenhet, HentEiere.`
  );
}

function handleSoap(operasjon, xml, matrikkel) {
  return handterSoap(operasjon, xml, matrikkel);
}

const matrikkelPromise = readMatrikkelData();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    const register = await matrikkelPromise;
    const matrikkel = register;

    if (request.method === "GET" && (url.pathname === "/helse" || url.pathname === "/health")) {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "matrikkel-mock",
        kilde: register.kilde,
        antallGater: register.gater.length,
        antallEiendommer: register.eiendommer.length,
        wsdl: `${wsPath}?wsdl`,
        tidspunkt: new Date().toISOString(),
        lastetTidspunkt: register.lastetTidspunkt
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock/matrikkel/gater") {
      const gateSoek = url.searchParams.get("gate");
      const includeEiendommer = url.searchParams.get("includeEiendommer") === "true";
      if (gateSoek) {
        const treff = finnGater(register, gateSoek).map((gate) => gateSomRespons(register, gate, includeEiendommer));
        if (!treff.length) {
          const liveTreff = await finnGaterViaLive(gateSoek, includeEiendommer);
          if (liveTreff.length) {
            jsonResponse(response, 200, paginer(liveTreff, url.searchParams));
            return;
          }
          jsonResponse(response, 404, { feil: `Fant ikke gate ${gateSoek}.` });
          return;
        }
        jsonResponse(response, 200, paginer(treff, url.searchParams));
        return;
      }
      const alle = register.gater.map((gate) => gateSomRespons(register, gate, includeEiendommer));
      jsonResponse(response, 200, paginer(alle, url.searchParams));
      return;
    }

    const eiendomTreff = url.pathname.match(/^\/mock\/matrikkel\/eiendom\/([^/]+)$/);
    if (request.method === "GET" && eiendomTreff) {
      const treff = finnEiendom(register, decodeURIComponent(eiendomTreff[1]), null, null);
      if (!treff) {
        const liveTreff = await finnEiendomViaLive(register, decodeURIComponent(eiendomTreff[1]));
        if (liveTreff?.eiendom) {
          jsonResponse(response, 200, liveTreff.eiendom);
          return;
        }
        jsonResponse(response, 404, { feil: "Fant ikke matrikkelenhet." });
        return;
      }
      jsonResponse(response, 200, treff);
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock/matrikkel/eiendommer") {
      const gateSoek = url.searchParams.get("gate");
      const adresseSoek = url.searchParams.get("adresse");
      const personId = url.searchParams.get("personId");
      const gnr = url.searchParams.get("gnr");
      const bnr = url.searchParams.get("bnr");

      let kandidater;
      if (url.searchParams.get("matrikkelId")) {
        const treff = finnEiendom(register, url.searchParams.get("matrikkelId"), null, null);
        kandidater = treff ? [treff] : [];
      } else if (gnr !== null && bnr !== null) {
        const treff = finnEiendom(register, null, gnr, bnr);
        kandidater = treff ? [treff] : [];
      } else if (gateSoek) {
        const gater = finnGater(register, gateSoek);
        kandidater = gater.flatMap((gate) => gate.eiendomIds.map((id) => register.eiendomPerId.get(id)).filter(Boolean));
        if (!kandidater.length) {
          const liveGater = await finnGaterViaLive(gateSoek, true);
          kandidater = liveGater.flatMap((gate) => gate.eiendommer || []);
        }
      } else if (adresseSoek) {
        kandidater = finnEiendommerFraAdresse(register, adresseSoek);
        if (!kandidater.length) {
          const liveTreff = await finnEiendomViaLive(register, adresseSoek);
          kandidater = liveTreff?.eiendom ? [liveTreff.eiendom] : [];
        }
      } else {
        kandidater = register.eiendommer;
      }

      let filtrert = personId ? kandidater.filter((eiendom) => (eiendom.eiere || []).includes(personId)) : kandidater;
      if (adresseSoek) {
        const norm = normaliserAdresse(adresseSoek);
        filtrert = filtrert.filter((eiendom) => {
          const adresse = normaliserAdresse(eiendom.adresse);
          return adresse === norm || adresse.includes(norm) || norm.includes(adresse);
        });
      }
      jsonResponse(response, 200, paginer(filtrert, url.searchParams));
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock/matrikkel/eiendom-oppslag") {
      const adresse = url.searchParams.get("adresse") || "";
      const treff = finnEiendomFraAdresse(register, adresse);
      if (!treff) {
        const liveTreff = await finnEiendomViaLive(register, adresse);
        if (liveTreff?.eiendom) {
          jsonResponse(response, 200, liveTreff.eiendom);
          return;
        }
        jsonResponse(response, 404, { feil: `Fant ikke matrikkelenhet for adresse ${adresse}.` });
        return;
      }
      jsonResponse(response, 200, treff);
      return;
    }

    if (request.method === "GET" && url.pathname === wsPath && url.searchParams.has("wsdl")) {
      const baseUrl = `http://${request.headers.host}`;
      textResponse(response, 200, wsdlDocument(baseUrl), "text/xml; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === wsPath) {
      const xml = await readBody(request);
      const operasjon = findOperation(xml);
      if (!operasjon) {
        textResponse(response, 400, soapFault("Client.InvalidRequest", "Fant ingen SOAP-operasjon i Body."), "text/xml; charset=utf-8");
        return;
      }
      if (operasjon === "FinnVeger") {
        const gateSoek = finnTagg(xml, "adressenavn") || finnTagg(xml, "soeketekst") || finnTagg(xml, "gate") || "";
        const kommunenummer = finnTagg(xml, "kommunenummer");
        const treff = gateSoek
          ? finnGater(register, gateSoek).map((gate) => gateSomRespons(register, gate, false))
          : register.gater.map((gate) => gateSomRespons(register, gate, false));
        const svar = treff.length > 0
          ? treff
          : await finnGaterViaLive(gateSoek, false, kommunenummer);
        textResponse(response, 200, soapEnvelope(`    <mat:FinnVegerResponse>\n${svar.map(byggGateReturn).join("\n")}\n    </mat:FinnVegerResponse>`), "text/xml; charset=utf-8");
        return;
      }

      if (operasjon === "FinnMatrikkelenheter") {
        const gateSoek = finnTagg(xml, "adressenavn") || finnTagg(xml, "soeketekst") || finnTagg(xml, "gate") || "";
        const kommunenummer = finnTagg(xml, "kommunenummer");
        const gater = gateSoek
          ? finnGater(register, gateSoek)
          : register.gater;
        const treff = gater.length > 0
          ? gater.flatMap((gate) => gate.eiendomIds.map((id) => register.eiendomPerId.get(id)).filter(Boolean).map((eiendom) => ({
              gateId: gate.gateId,
              adressenavn: gate.adressenavn,
              kommunenummer: gate.kommunenummer,
              kommune: gate.kommune,
              postnummer: gate.postnummer,
              poststed: gate.poststed,
              eiendom
            })))
          : (await finnGaterViaLive(gateSoek, true, kommunenummer)).flatMap((gate) => (gate.eiendommer || []).map((eiendom) => ({ ...gate, eiendom })));
        const responseBody = treff.length > 0
          ? `    <mat:FinnMatrikkelenheterResponse>\n${treff.map(({ gateId, adressenavn, kommunenummer: kommuneNr, kommune, postnummer, poststed, eiendom }) => byggEiendomReturn({ gateId, adressenavn, kommunenummer: kommuneNr, kommune, postnummer, poststed }, eiendom)).join("\n")}\n    </mat:FinnMatrikkelenheterResponse>`
          : "    <mat:FinnMatrikkelenheterResponse></mat:FinnMatrikkelenheterResponse>";
        textResponse(response, 200, soapEnvelope(responseBody), "text/xml; charset=utf-8");
        return;
      }

      textResponse(response, 200, handterSoap(operasjon, xml, register), "text/xml; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/docs") {
      textResponse(
        response,
        200,
        [
          "<!doctype html>",
          "<html lang=\"nb\"><head><meta charset=\"utf-8\"><title>Matrikkel Mock</title></head><body>",
          "<h1>Matrikkel Mock API</h1>",
          "<ul>",
          `<li><code>GET ${wsPath}?wsdl</code></li>`,
          `<li><code>POST ${wsPath}</code> (SOAP)</li>`,
          "<li><code>GET /mock/matrikkel/gater?gate=Storgata</code></li>",
          "<li><code>GET /mock/matrikkel/gater?limit=100&offset=0</code></li>",
          "<li><code>GET /mock/matrikkel/eiendommer?gate=Storgata</code></li>",
          "<li><code>GET /mock/matrikkel/eiendommer?gnr=165&bnr=5</code></li>",
          "<li><code>GET /mock/matrikkel/eiendom-oppslag?adresse=Storgata%205</code></li>",
          "<li><code>GET /mock/matrikkel/eiendom/matr-storg-003</code></li>",
          "</ul>",
          "</body></html>"
        ].join("\n"),
        "text/html; charset=utf-8"
      );
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonResponse(response, 500, { feil: "Intern feil i matrikkel-mock.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`Matrikkel-mock kjorer pa http://localhost:${port}`);
});

