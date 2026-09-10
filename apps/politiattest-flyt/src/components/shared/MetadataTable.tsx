import React from "react";

interface Props {
  rader: Array<{ label: string; verdi: React.ReactNode }>;
  tittel?: string;
}

export const MetadataTable: React.FC<Props> = ({ rader, tittel }) => (
  <div className="metadata-table">
    {tittel && <h3 className="metadata-table__tittel">{tittel}</h3>}
    <dl>
      {rader.map((rad) => (
        <div className="metadata-table__rad" key={rad.label}>
          <dt>{rad.label}</dt>
          <dd>{rad.verdi}</dd>
        </div>
      ))}
    </dl>
  </div>
);
