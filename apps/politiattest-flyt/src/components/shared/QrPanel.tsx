import React from "react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  verdi: string;
  simulert?: boolean;
  bildeUrl?: string | null;
  storrelse?: number;
}

// Delt QR-visning for både utstedelses- og presentasjons-QR-koder. Bruker det ekte
// PNG-bildet fra testmiljøet når det finnes, ellers en generert SVG-kode fra verdien
// (fungerer også for simulerte koder, som aldri har et ekte bilde).
export const QrPanel: React.FC<Props> = ({ verdi, simulert = false, bildeUrl = null, storrelse = 220 }) => (
  <div className="qr-panel">
    <div className="qr-panel__kode">
      {bildeUrl ? (
        <img src={bildeUrl} alt="QR-kode for bevis" width={storrelse} height={storrelse} />
      ) : (
        <QRCodeSVG value={verdi} size={storrelse} level="M" includeMargin />
      )}
    </div>
    {simulert && (
      <p className="qr-panel__simulert-varsel">
        Simulert - ingen ekte kobling til testmiljøet akkurat nå. Bruk knappen «Simuler» under
        for å fortsette flyten uten en fysisk lommebok-app.
      </p>
    )}
  </div>
);
