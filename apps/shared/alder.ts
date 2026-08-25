// Age has three callers that must agree: the rules that decide a vedtak, the gate
// that validates the seed, and the importer that generates it. When each carried
// its own copy, the producer could classify a person as a child while the rule
// classified them as an adult, and nothing in CI could see it.
//
// Age is computed at the rates' effective date, not at call time, so the same test
// person yields the same outcome whenever the demo runs.
export function alderVed(foedselsdato: string, referansedato: string): number {
  const foedt = new Date(foedselsdato);
  const reference = new Date(referansedato);
  const alder = reference.getFullYear() - foedt.getFullYear();
  const beforeBirthday =
    reference.getMonth() < foedt.getMonth() ||
    (reference.getMonth() === foedt.getMonth() && reference.getDate() < foedt.getDate());
  return beforeBirthday ? alder - 1 : alder;
}
