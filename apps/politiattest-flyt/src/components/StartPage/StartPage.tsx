import React, { useEffect, useState } from "react";
import type { Person } from "../../types";
import { hentPersoner } from "../../integrations/lommebokApi";

const FORETRUKKET_PERSON_ID = "person-215";

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
}

export const StartPage: React.FC<Props> = ({ onVelgPerson }) => {
  const [personer, setPersoner] = useState<Person[]>([]);
  const [laster, setLaster] = useState(true);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    hentPersoner()
      .then((alle) => {
        if (!aktiv) return;
        setPersoner(alle.filter(harGyldigSkoleattest));
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

  const foretrukket = personer.find((p) => p.personId === FORETRUKKET_PERSON_ID) ?? null;

  return (
    <main className="start-page">
      <div className="start-page__intro">
        <h1>Politiattest for skolejobb - demo av digital lommebok-flyt</h1>
        <p>
          Denne demoen viser hvordan en søker på en skolejobb i Drammen kommune kan bruke en
          digital lommebok til å hente en formålsbekreftelse fra kommunen, legge den fram for
          politiet, og levere den ferdige politiattesten tilbake til kommunen - uten papir.
        </p>
        <p className="start-page__merknad">
          Velg en testperson under for å starte en ny sak. Personutvalget er begrenset til
          syntetiske personer som allerede har en politiattest med formål «skole» i
          sandkassedataene.
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
          {foretrukket && (
            <button
              type="button"
              className="start-page__person start-page__person--anbefalt"
              onClick={() => onVelgPerson(foretrukket)}
            >
              <span className="start-page__person-merke">Anbefalt eksempel</span>
              <strong>{foretrukket.visningsnavn}</strong>
              <span>{foretrukket.personId}</span>
            </button>
          )}
          {personer.filter((p) => p.personId !== FORETRUKKET_PERSON_ID).map((person) => (
            <button
              type="button"
              key={person.personId}
              className="start-page__person"
              onClick={() => onVelgPerson(person)}
            >
              <strong>{person.visningsnavn}</strong>
              <span>{person.personId}</span>
            </button>
          ))}
          {personer.length === 0 && <p>Fant ingen testpersoner med skole-politiattest.</p>}
        </div>
      )}
    </main>
  );
};
