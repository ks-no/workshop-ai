import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource-variable/source-sans-3';
import './globals.css';
import './punkt.scss';
import './assistant.css';
import '@digdir/designsystemet-css';
import '@digdir/designsystemet-css/theme';
import './designsystemet.css';

export const metadata: Metadata = {
  title: 'Søk én gang | Fra skjema til samtale',
  description: 'En innbyggerassistent for familie, bolig og flytting. Se kilder, bekreft opplysninger og forbered saken din i en lokal hackathondemo.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="nb"><body>{children}</body></html>;
}
