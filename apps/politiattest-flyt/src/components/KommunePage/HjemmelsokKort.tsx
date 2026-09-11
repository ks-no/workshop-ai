import React from "react";
import type { HjemmelTreff, Hjemmelvalg, Person } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { sokHjemler } from "../../integrations/hjemmelsokApi";
import { hjemmelFraAttest } from "../../integrations/credentialDefinitions";
import { LoadingIndicator } from "../shared/LoadingIndicator";
import { MetadataTable } from "../shared/MetadataTable";
import { StatusBadge } from "../shared/StatusBadge";

interface Props {
  person: Person;
  hjemmelvalg: Hjemmelvalg | null;
  /** Formålsbekreftelsen er utstedt - grunnlaget er da en del av et bevis og står fast. */
  laast: boolean;
  dispatch: React.Dispatch<SakHandling>;
}

// Steg 0. Saksbehandleren skriver noen få ord om hva attesten skal brukes til, og
// velger hjemmelen i nedtrekket - den kommer ordrett fra politiets formålsoversikt via
// apps/hjemmelsok. Grunnen til at den ikke bare skrives inn: hjemmelen ender som en
// claim i formålsbeviset, og en lovhenvisning skrevet for hånd er en lovhenvisning
// ingen har kontrollert.
export const HjemmelsokKort: React.FC<Props> = ({ person, hjemmelvalg, laast, dispatch }) => {
  const [soketekst, setSoketekst] = React.useState("");
  const [treff, setTreff] = React.useState<HjemmelTreff[] | null>(null);
  const [kilde, setKilde] = React.useState("");
  const [modell, setModell] = React.useState<string | undefined>(undefined);
  const [merknad, setMerknad] = React.useState<string | undefined>(undefined);
  const [laster, setLaster] = React.useState(false);
  const [feil, setFeil] = React.useState<string | null>(null);

  const valgtId = hjemmelvalg?.treff.id ?? "";

  async function utforSok(event: React.FormEvent) {
    event.preventDefault();
    const beskrivelse = soketekst.trim();
    if (!beskrivelse || laster) return;
    setLaster(true);
    setFeil(null);
    setTreff(null);
    try {
      const svar = await sokHjemler(beskrivelse);
      setTreff(svar.treff);
      setKilde(svar.kilde);
      setModell(svar.modell);
      setMerknad(svar.merknad);
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Oppslaget feilet.");
    } finally {
      setLaster(false);
    }
  }

  function velg(id: string) {
    const rad = treff?.find((t) => t.id === id);
    if (!rad) return;
    dispatch({
      type: "HJEMMEL_VALGT",
      hjemmelvalg: { treff: rad, soketekst: soketekst.trim(), kilde }
    });
  }

  const valgtRader = hjemmelvalg
    ? [
        { label: "Kategori", verdi: hjemmelvalg.treff.kategori },
        { label: "Formål", verdi: hjemmelvalg.treff.formaal },
        { label: "Hjemmel", verdi: hjemmelvalg.treff.hjemmel },
        { label: "Attesttype", verdi: hjemmelvalg.treff.attesttype },
        ...(hjemmelvalg.treff.bekreftelse
          ? [{ label: "Politiet krever", verdi: hjemmelvalg.treff.bekreftelse }]
          : []),
        ...(hjemmelvalg.soketekst
          ? [{ label: "Slått opp på", verdi: `«${hjemmelvalg.soketekst}»` }]
          : [])
      ]
    : [];

  if (laast) {
    return (
      <section className="kommune-page__kort">
        <h2>Steg 0: Hjemmelen formålsbekreftelsen ble utstedt på</h2>
        {hjemmelvalg ? (
          <MetadataTable tittel="Rettslig grunnlag" rader={valgtRader} />
        ) : (
          <StatusBadge tekst="Ingen hjemmel ble slått opp i denne saken" tone="advarsel" />
        )}
      </section>
    );
  }

  return (
    <section className="kommune-page__kort kommune-page__hjemmelsok">
      <h2>Steg 0: Finn hjemmelen formålet krever</h2>
      <p>
        Skriv noen få ord om hva attesten skal brukes til. Treffene er politiets egen
        formålsoversikt, ordrett - hjemmelen du velger her er den som legges i
        formålsbekreftelsen.
      </p>

      <form className="kommune-page__hjemmelsok-skjema" onSubmit={utforSok}>
        <div className="kommune-page__hjemmelsok-felt">
          <label htmlFor="hjemmelsok-beskrivelse">Hva skal attesten brukes til?</label>
          <input
            id="hjemmelsok-beskrivelse"
            type="text"
            value={soketekst}
            maxLength={500}
            placeholder="For eksempel: vikar i barnehage"
            onChange={(event) => setSoketekst(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={laster || !soketekst.trim()}>
          Søk etter hjemmel
        </button>
      </form>

      {laster && <LoadingIndicator tekst="Slår opp i politiets formålsoversikt…" />}

      {feil && (
        <div className="kommune-page__hjemmelsok-feil">
          <StatusBadge tekst={`Oppslaget feilet: ${feil}`} tone="feil" />
          <p>
            Uten oppslaget står saken igjen med hjemmelen som allerede lå på attesten. Da
            er den ikke kontrollert mot oversikten, og beviset sier hvor den kom fra.
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              dispatch({ type: "HJEMMEL_VALGT", hjemmelvalg: hjemmelFraAttest(person) })
            }
          >
            Fortsett med hjemmelen fra attesten
          </button>
        </div>
      )}

      {treff != null && treff.length === 0 && (
        <StatusBadge
          tekst={merknad || "Ingen treff. Prøv andre ord om hva attesten skal brukes til."}
          tone="advarsel"
        />
      )}

      {treff != null && treff.length > 0 && (
        <>
          <div className="kommune-page__hjemmelsok-felt">
            <label htmlFor="hjemmelsok-treff">Hjemler som passer beskrivelsen</label>
            <select
              id="hjemmelsok-treff"
              // Et nytt søk kan gi en liste der den valgte raden ikke er med. Nedtrekket
              // står da tomt, og tabellen under sier hva som fortsatt er valgt.
              value={treff.some((rad) => rad.id === valgtId) ? valgtId : ""}
              onChange={(event) => velg(event.target.value)}
            >
              <option value="">Velg hjemmel …</option>
              {treff.map((rad) => (
                <option key={rad.id} value={rad.id}>
                  {rad.kategori} - {rad.formaal}
                </option>
              ))}
            </select>
          </div>
          <p className="kommune-page__hjemmelsok-merknad">
            {merknad
              ? merknad
              : kilde === "modell"
                ? `${treff.length} treff, rangert av ${modell || "modellen"}. Modellen velger blant politiets rader, den skriver ingen hjemmel.`
                : `${treff.length} treff. Rekkefølgen er ordsøkets egen.`}
          </p>
        </>
      )}

      {hjemmelvalg && (
        <div className="kommune-page__hjemmelsok-valgt">
          <MetadataTable tittel="Valgt rettslig grunnlag" rader={valgtRader} />
          {hjemmelvalg.treff.beskrivelse && <p>{hjemmelvalg.treff.beskrivelse}</p>}
          {hjemmelvalg.treff.begrunnelse && (
            <p className="kommune-page__ki-merknad">
              Modellens begrunnelse: {hjemmelvalg.treff.begrunnelse}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
