import React, { useEffect, useState } from "react";
import type { Person } from "../../types";
import { hentPersoner } from "../../integrations/lommebokApi";

const TESTPERSONER = [
  { personId: "person-215", scenario: "Ingen anmerkninger" },
  { personId: "person-004", scenario: "Har anmerkning" }
] as const;

function harGyldigSkoleattest(person: Person): boolean {
  const attest = person.politiattest;
  if (!attest || attest.formaal !== "skole") return false;
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
  const [simuleringPersonId, setSimuleringPersonId] = useState("person-215");

  useEffect(() => {
    let aktiv = true;
    hentPersoner()
      .then((alle) => {
        if (!aktiv) return;
        setPersoner(
          TESTPERSONER.flatMap(({ personId, scenario }) => {
            const person = alle.find((kandidat) => kandidat.personId === personId);
            return person && harGyldigSkoleattest(person) ? [{ person, scenario }] : [];
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
        <h1>Politiattest for skolejobb - demo av digital lommebok-flyt</h1>
        <p>
          Denne demoen viser hvordan en søker på en skolejobb i Drammen kommune kan bruke en
          digital lommebok til å hente en formålsbekreftelse fra kommunen, legge den fram for
          politiet, og levere den ferdige politiattesten til riktig mottaker, Drammen kommune -
          uten papir. Formålet er ansettelse i skolen.
        </p>
        <p className="start-page__merknad">
          Velg én av to testpersoner for å prøve hele flyten. Den ene har ingen
          anmerkninger, den andre har en anmerkning. Du kan også åpne en ferdigbehandlet
          sak uten å gå gjennom stegene.
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
              <span>{person.personId}</span>
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
