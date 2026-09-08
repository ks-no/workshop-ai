function asRecord(verdi: unknown): Record<string, unknown> | undefined {
  return verdi !== null && typeof verdi === "object" && !Array.isArray(verdi)
    ? verdi as Record<string, unknown>
    : undefined;
}

function readText(verdi: unknown): string {
  return typeof verdi === "string" ? verdi.trim() : "";
}

function readBoligbekreftelse(svar: unknown): boolean | null {
  const felter = asRecord(svar);
  const verdi = felter ? felter.merEnn20Boliger : svar;
  if (typeof verdi === "boolean") return verdi;
  const tekst = readText(verdi).toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/g, "");
  // Et tall kan være selve terskelen, og «riktig» kan stå i en benektelse.
  // Bare et uttrykkelig ja eller nei kan gjengis som søkerens bekreftelse.
  if (/^(nei|neida|no)(?:$|[,!.]\s)/.test(tekst)
    || ["det stemmer ikke", "ikke riktig", "det er ikke riktig"].includes(tekst)) return false;
  if (/^(ja|japp|yes)(?:$|[,!.]\s)/.test(tekst)
    || ["greit", "ok", "okei", "det stemmer", "riktig"].includes(tekst)) return true;
  return null;
}

export function buildFartsdempendeOppsummering(
  tjeneste: unknown,
  data: object,
  svar: Record<string, unknown>
): string | null {
  const resultater = Object.values(data).map(asRecord);
  const gateData = resultater.find((v) => v?.adressenavn && v?.antallEiendommer !== undefined);
  if (!gateData || !String(tjeneste).toLowerCase().includes("fartsdempende")) {
    return null;
  }

  const flereEnn20 = readBoligbekreftelse(svar["boliger-bekreft"]);
  const begrunnelseSvar = asRecord(svar.begrunnelse);
  const begrunnelse = readText(begrunnelseSvar ? begrunnelseSvar.trafikkproblem : svar.begrunnelse);
  const oensketTiltak = readText(begrunnelseSvar?.oensketTiltak);
  const eierSjekk = resultater.find((v) => v?.godkjent !== undefined && typeof v?.melding === "string");

  const linjer = [
    `Her er en oppsummering av søknaden om fartsdempende tiltak i ${gateData.adressenavn}, ${gateData.kommune}.`,
    `Matrikkelen viser ${gateData.antallBoligeiendommer} boligeiendommer og ${gateData.antallEiendommer} eiendommer totalt i gaten.`
  ];

  if (eierSjekk?.godkjent === true) {
    linjer.push("Eierforholdet er kontrollert, og søker har registrert eiendom i gaten.");
  }

  linjer.push(
    flereEnn20 === true
      ? "Søker opplyser at gaten har mer enn 20 boliger."
      : flereEnn20 === false
        ? "Søker opplyser at gaten ikke har mer enn 20 boliger."
        : "Det er ikke avklart om gaten har mer enn 20 boliger."
  );

  if (begrunnelse) {
    linjer.push(`Begrunnelse fra søker: ${begrunnelse}`);
  }
  if (oensketTiltak) {
    linjer.push(`Ønsket tiltak: ${oensketTiltak}`);
  }

  linjer.push("Søknaden sendes inn med disse opplysningene som grunnlag for videre vurdering.");
  return linjer.join(" ");
}
