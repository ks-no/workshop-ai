// Read-only inspection of the documented public sandbox surface. No token or personal data.
const base = new URL(process.env.SANDBOX_BASE_URL || 'http://127.0.0.1:8080');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') {
  throw new Error('Use the local sandbox on http://localhost or http://127.0.0.1.');
}
const routes = ['/helse', '/api/katalog/ressurser', '/api/regler/satser'];
const results = await Promise.allSettled(routes.map(async route => {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await response.json();
  return route;
}));
for (const [index, result] of results.entries()) {
  console.log(`${result.status === 'fulfilled' ? 'OK' : 'IKKE TILGJENGELIG'} ${routes[index]}`);
}
if (results.some(result => result.status === 'rejected')) {
  console.log('Start arrangørens sandkasse med ./start.sh --mock. Søk én gang virker fortsatt med sine egne testdata.');
  process.exitCode = 1;
} else {
  console.log('Sandkassens åpne grensesnitt svarer. Appen er fortsatt i lokal demomodus. Ingen persondata er lest.');
}
