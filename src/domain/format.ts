export const kroner = (nok: number, decimals = 0) => new Intl.NumberFormat('nb-NO', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(nok) + ' kr';
export const ore = (value: number) => kroner(value / 100, 2);
export const dateTime = (iso: string) => new Intl.DateTimeFormat('nb-NO', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Oslo',
}).format(new Date(iso));
