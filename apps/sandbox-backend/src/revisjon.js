import { lesJson, nyttId, skrivJson } from "./tilstand.js";

// This service is the only writer of the audit log — fiks-simulator posts its
// events to /api/revisjonslogg rather than touching the file.
//
// Writes are chained so that concurrent requests cannot interleave their
// read-modify-write and drop each other's events.
let revisjonsKoe = Promise.resolve();

export async function leggTilRevisjon(hendelse) {
  revisjonsKoe = revisjonsKoe.then(async () => {
    const revisjonslogg = await lesJson("revisjonslogg.json", []);
    revisjonslogg.push({
      hendelseId: nyttId("revisjon"),
      tidspunkt: new Date().toISOString(),
      syntetisk: true,
      ...hendelse
    });
    await skrivJson("revisjonslogg.json", revisjonslogg);
  }).catch((error) => {
    console.warn(`Kunne ikke skrive revisjonslogg: ${error.message}`);
  });
  return revisjonsKoe;
}
