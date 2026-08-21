/**
 * En liten tilstandsmaskin, delt av samtykke og oppgave.
 *
 * Both resources had the same hole: `status` was whatever string the caller sent,
 * so a withdrawn samtykke could be revived by answering it again. Written twice
 * the two would drift apart, and a state machine that only mostly holds is worse
 * than none — it teaches that the rule is advisory.
 *
 * `Record<T, T[]>` is the point of the type parameter: the compiler demands an
 * entry for every status, so adding one without deciding what it may become is a
 * compile error rather than a quiet dead end. Same pattern as `regelHandtere` in
 * regler.ts and `REGLER` in skjerming.ts.
 */

export type Overgangsutfall<T extends string> =
  | { lovlig: true; fra: T; til: T }
  | { lovlig: false; status: 400 | 409; kode: "UKJENT_STATUS" | "UGYLDIG_OVERGANG"; melding: string };

/**
 * @param navn What the resource is called in a message to a citizen, capitalised
 *   and definite: "Samtykket", "Oppgaven".
 */
export function lagTilstandsmaskin<T extends string>(navn: string, overganger: Record<T, T[]>) {
  const statuser = Object.keys(overganger) as T[];

  function erStatus(verdi: unknown): verdi is T {
    return typeof verdi === "string" && (statuser as string[]).includes(verdi);
  }

  // Two different failures, and they are not the same HTTP answer: an unknown
  // status is a malformed request (400), while a status the machine knows but
  // cannot reach from here is a conflict with the current state (409). Collapsing
  // them into one code would make "you spelled it wrong" and "you are too late"
  // indistinguishable to a client.
  function validerOvergang(fra: unknown, til: unknown): Overgangsutfall<T> {
    if (!erStatus(til)) {
      return {
        lovlig: false,
        status: 400,
        kode: "UKJENT_STATUS",
        melding: `«${String(til)}» er ikke en gyldig status. Gyldige: ${statuser.join(", ")}.`
      };
    }
    if (!erStatus(fra)) {
      // Persisted rubbish, from before the machine existed or from a hand-edited
      // state file. Answering 409 rather than 400 is deliberate: the request is
      // fine, the stored row is not.
      return {
        lovlig: false,
        status: 409,
        kode: "UKJENT_STATUS",
        melding: `${navn} har den ukjente statusen «${String(fra)}». Gyldige: ${statuser.join(", ")}.`
      };
    }
    const mulige = overganger[fra];
    if (!mulige.includes(til)) {
      return {
        lovlig: false,
        status: 409,
        kode: "UGYLDIG_OVERGANG",
        melding: mulige.length
          ? `${navn} har status ${fra}, og kan derfra bare settes til ${mulige.join(" eller ")}. Forsøkte ${til}.`
          : `${navn} har status ${fra}, som er endelig. Forsøkte ${til}.`
      };
    }
    return { lovlig: true, fra, til };
  }

  return { statuser, erStatus, validerOvergang };
}
