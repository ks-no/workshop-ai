export async function ventMinst(startet: number, varighet = 1200): Promise<void> {
  const gjenstaar = Math.max(0, varighet - (Date.now() - startet));
  if (gjenstaar === 0) return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, gjenstaar));
}
