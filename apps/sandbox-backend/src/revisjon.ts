import { readJson, newId, writeJson } from "./state.ts";

// This service is the only writer of the audit log — fiks-simulator posts its
// events to /api/revisjonslogg rather than touching the file.
//
// Writes are chained so that concurrent requests cannot interleave their
// read-modify-write and drop each other's events.
let revisjonsKoe = Promise.resolve();

export async function leggTilRevisjon(hendelse: Record<string, unknown>) {
  revisjonsKoe = revisjonsKoe.then(async () => {
    const revisjonslogg = await readJson("revisjonslogg.json", []);
    revisjonslogg.push({
      hendelseId: newId("revisjon"),
      tidspunkt: new Date().toISOString(),
      syntetisk: true,
      ...hendelse
    });
    await writeJson("revisjonslogg.json", revisjonslogg);
  }).catch((error: Error) => {
    console.warn(`Kunne ikke skrive revisjonslogg: ${error.message}`);
  });
  return revisjonsKoe;
}
