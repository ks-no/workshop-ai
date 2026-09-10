/*
 * Retursiden fra ID-porten. Eneste jobb: bytte engangskoden i et token og sende
 * nettleseren dit den kom fra. Returstien red med i `state`.
 */
export {};

const KLIENT_ID = "innbyggerportal";

(async () => {
  try {
    const tilbakeTil = await completeLogin({ clientId: KLIENT_ID });
    location.replace(tilbakeTil === "/" ? "/minside" : tilbakeTil);
  } catch (feil) {
    krevEl("tittel").textContent = "Innloggingen gikk ikke gjennom";
    krevEl("melding").textContent = feilmelding(feil);
    krevEl("tilbake").hidden = false;
  }
})();
