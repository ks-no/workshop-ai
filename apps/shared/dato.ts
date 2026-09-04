const norwegianYearFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Oslo",
  year: "numeric"
});

export function getNorwegianCalendarYear(now: number = Date.now()): number {
  return Number(norwegianYearFormatter.format(now));
}
