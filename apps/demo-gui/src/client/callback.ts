// Sidescript for callback. Lastes som <script type="module">, så alt her har sitt
// eget scope - to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

// The redirect target from ID-porten. Its only job is to swap the code for a
// token and send the browser back where it came from - the return path rode
// along in `state`.
(async () => {
  try {
    const tilbakeTil = await completeLogin();
    location.replace(tilbakeTil);
  } catch (feil) {
    krevEl("tittel").textContent = "Innloggingen gikk ikke gjennom";
    krevEl("melding").textContent = feilmelding(feil);
    krevEl("tilbake").hidden = false;
  }
})();
