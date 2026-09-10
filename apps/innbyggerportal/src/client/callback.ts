/*
 * Sidescript for callback. Lastes som <script type="module">, så alt her har sitt
 * eget scope. felles.ts lastes som klassisk skript foran denne, så funksjonene
 * derfra er globale og trenger ingen import.
 */
export {};

const KLIENT_ID = "innbyggerportal";

// Der ID-porten sender nettleseren tilbake. Den eneste jobben er å veksle koden
// mot et token og sende brukeren dit hun kom fra - returveien lå i `state`.
(async () => {
  try {
    const tilbakeTil = await completeLogin({ clientId: KLIENT_ID });
    location.replace(tilbakeTil);
  } catch (feil) {
    krevEl("tittel").textContent = "Innloggingen gikk ikke gjennom";
    krevEl("melding").textContent = feilmelding(feil);
    krevEl("tilbake").hidden = false;
  }
})();
