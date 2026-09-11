import React, { useEffect, useState } from "react";
import type { Person } from "../../types";
import { hentPersoner } from "../../integrations/lommebokApi";
import { erPolitiattestRolle, navnForRolle } from "../../utils/roller";

const TESTPERSONER = [
  { personId: "person-026", scenario: "Godkjent - støttekontakt" },
  { personId: "person-138", scenario: "Manuell vurdering - støttekontakt" },
  { personId: "person-137", scenario: "Avvist - barnehage" }
] as const;

function harGyldigPolitiattest(person: Person): boolean {
  const attest = person.politiattest;
  if (!attest || !erPolitiattestRolle(attest.formaal)) return false;
  // Attesten skal ikke framstå som utstedt langt fram i tid heller - datagrunnlaget er
  // syntetisk og kan inneholde datoer som ikke lenger er "nylig" sett fra i dag, men vi
  // krever i det minste at den faktisk er utstedt.
  return typeof attest.utstedt === "string" && attest.utstedt.length === 10;
}

interface Props {
  onVelgPerson: (person: Person) => void;
  onSimulerFullfortSak: (person: Person) => void;
}

export const StartPage: React.FC<Props> = ({ onVelgPerson, onSimulerFullfortSak }) => {
  const [personer, setPersoner] = useState<Array<{ person: Person; scenario: string }>>([]);
  const [laster, setLaster] = useState(true);
  const [feil, setFeil] = useState<string | null>(null);
  const [simuleringPersonId, setSimuleringPersonId] = useState("person-026");

  useEffect(() => {
    let aktiv = true;
    hentPersoner()
      .then((alle) => {
        if (!aktiv) return;
        setPersoner(
          TESTPERSONER.flatMap(({ personId, scenario }) => {
            const person = alle.find((kandidat) => kandidat.personId === personId);
            return person && harGyldigPolitiattest(person) ? [{ person, scenario }] : [];
          })
        );
      })
      .catch((err) => {
        if (!aktiv) return;
        setFeil(err instanceof Error ? err.message : "Kunne ikke hente personer fra lommebok.");
      })
      .finally(() => {
        if (aktiv) setLaster(false);
      });
    return () => {
      aktiv = false;
    };
  }, []);

  const simuleringPerson = personer.find(({ person }) => person.personId === simuleringPersonId)?.person;

  return (
    <main className="start-page">
      <div className="start-page__intro">
        <h1>Politiattest til jobb - demo av digital lommebok-flyt</h1>
        <p>
          Demo av digital søknad om politiattest i Drammen kommune.
        </p>
        <p className="start-page__merknad">
          Velg en testperson for å prøve flyten, eller åpne en ferdigbehandlet sak.
        </p>
      </div>

      {laster && <p>Henter testpersoner…</p>}
      {feil && (
        <div className="alert alert-feil">
          <p>{feil}</p>
          <p>Sjekk at apps/lommebok kjører (port 3002) - denne appen bruker dens API for persondata.</p>
        </div>
      )}

      {!laster && !feil && (
        <div className="start-page__personvelger">
          {personer.map(({ person, scenario }) => (
            <button
              type="button"
              key={person.personId}
              className="start-page__person"
              onClick={() => onVelgPerson(person)}
            >
              <span className="start-page__person-merke">{scenario}</span>
              <strong>{person.visningsnavn}</strong>
              <span>{person.personId} · {navnForRolle(person.politiattest?.formaal || "")}</span>
            </button>
          ))}
          {personer.length > 0 && (
            <div className="start-page__simulering">
              <span className="start-page__person-merke">Simulering</span>
              <strong>Ferdigbehandlet sak</strong>
              <label htmlFor="simulering-anmerkninger">Velg scenario</label>
              <select
                id="simulering-anmerkninger"
                value={simuleringPersonId}
                onChange={(event) => setSimuleringPersonId(event.target.value)}
              >
                {personer.map(({ person, scenario }) => (
                  <option key={person.personId} value={person.personId}>{scenario}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => simuleringPerson && onSimulerFullfortSak(simuleringPerson)}
                disabled={!simuleringPerson}
              >
                Åpne ferdigbehandlet sak
              </button>
            </div>
          )}
          {personer.length === 0 && <p>Fant ikke testpersonene for politiattestflyten.</p>}
        </div>
      )}
    </main>
  );
};
