import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LucideProvider } from 'lucide-react';
import { AppShell } from './components/shell/AppShell';
import { START } from './lib/navigation';
import EinAusgaenge from './pages/EinAusgaenge';
import Termine from './pages/Termine';
import Belege from './pages/Belege';
import BelegEditor from './pages/BelegEditor';
import Vorlagen from './pages/Vorlagen';
import Kunden from './pages/Kunden';
import Ueberblick from './pages/auswertung/Ueberblick';
import Liquiditaet from './pages/auswertung/Liquiditaet';
import Kennzahlen from './pages/auswertung/Kennzahlen';
import Steuer from './pages/auswertung/Steuer';
import Einstellungen from './pages/Einstellungen';

export default function App() {
  return (
    // Icons einheitlich: 18 px, Strich 1.8, Klasse .ic (§9.7)
    <LucideProvider size={18} strokeWidth={1.8} className="ic">
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to={START} replace />} />
            <Route path="ein-ausgaenge" element={<EinAusgaenge />} />
            <Route path="termine" element={<Termine />} />
            <Route path="belege" element={<Belege />} />
            <Route path="belege/vorlagen" element={<Vorlagen />} />
            <Route path="belege/neu" element={<BelegEditor />} />
            <Route path="belege/:id" element={<BelegEditor />} />
            <Route path="kunden" element={<Kunden />} />
            <Route path="auswertung" element={<Ueberblick />} />
            <Route path="auswertung/liquiditaet" element={<Liquiditaet />} />
            <Route path="auswertung/kennzahlen" element={<Kennzahlen />} />
            <Route path="auswertung/steuer" element={<Steuer />} />
            <Route path="einstellungen" element={<Einstellungen />} />
            <Route path="einstellungen/:bereich" element={<Einstellungen />} />
            <Route path="*" element={<Navigate to={START} replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </LucideProvider>
  );
}
