/* Daten der Einstellungsbereiche (Firma, Steuern, Nummernkreise) aus SQLite laden.
 * Im reinen Browser (npm run dev) gibt es keine Datenbank: dann ein ruhiger Hinweis statt Absturz.
 * Fehler beim Laden ⇒ Meldung mit „Erneut versuchen“. Nach dem Speichern lädt `neuLaden` still nach (kein Skeleton). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { datenbankVerfuegbar } from '../../lib/db';
import { fehlerText } from '../../lib/fehler';
import { EmptyState } from '../../components/ui/EmptyState';
import { reveal } from '../../components/ui/PageHead';

export type Ladezustand<T> = { status: 'laden' } | { status: 'ohne-db' } | { status: 'fehler'; fehler: string } | { status: 'ok'; daten: T };

export { fehlerText };

/** `laden` sollte stabil sein (Modulfunktion oder useCallback). */
export function useLaden<T>(laden: () => Promise<T>) {
  const [zustand, setZustand] = useState<Ladezustand<T>>(() => (datenbankVerfuegbar() ? { status: 'laden' } : { status: 'ohne-db' }));
  const aktiv = useRef(true);

  const neuLaden = useCallback(async () => {
    if (!datenbankVerfuegbar()) return;
    try {
      const daten = await laden();
      if (aktiv.current) setZustand({ status: 'ok', daten });
    } catch (e) {
      if (aktiv.current) setZustand({ status: 'fehler', fehler: fehlerText(e) });
    }
  }, [laden]);

  useEffect(() => {
    aktiv.current = true;
    void neuLaden();
    return () => {
      aktiv.current = false;
    };
  }, [neuLaden]);

  const erneut = useCallback(() => {
    setZustand({ status: 'laden' });
    void neuLaden();
  }, [neuLaden]);

  return { zustand, neuLaden, erneut };
}

/** Anzeige für alles außer „ok“. */
export function Ladeansicht({ zustand, icon, was, erneut }: { zustand: Ladezustand<unknown>; icon: LucideIcon; was: string; erneut: () => void }) {
  if (zustand.status === 'ok') return null;
  if (zustand.status === 'laden') {
    return (
      <section className="card set-card reveal" style={reveal(1)} aria-busy="true">
        <div className="sk set-sk" />
      </section>
    );
  }
  if (zustand.status === 'ohne-db') {
    return (
      <section className="card reveal" style={reveal(1)}>
        <EmptyState icon={icon} title="Nur in der Mac-App">
          {was} liegen in der Datenbank auf diesem Mac. Im Browser-Vorschaumodus gibt es sie nicht – bitte die App starten
          (npm run tauri dev).
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="card reveal" style={reveal(1)}>
      <EmptyState icon={TriangleAlert} title={`${was} konnten nicht geladen werden`}>
        {zustand.fehler}
      </EmptyState>
      <div className="row set-erneut">
        <button type="button" className="btn ghost" onClick={erneut}>
          <RefreshCw />
          Erneut versuchen
        </button>
      </div>
    </section>
  );
}
