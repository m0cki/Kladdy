/* Marke oben links (§9.7, §6.10): eigenes Firmenlogo auf weißer Kachel (.logo-eigen: 34 × 34 px, Radius 9 px, 3 px
 * Innenabstand, object-fit: contain, feine Kontur – in Hell und Dunkel lesbar, so wie auf dem weißen Beleg) oder,
 * ohne Logo, das Kladdy-Symbol. Das App-Symbol im Dock bleibt immer Kladdy. */
import { useEffect } from 'react';
import { firmenlogoLaden, useFirmenlogo, useLogoUrl } from '../../lib/logoablage';
import { Logo } from './Logo';

/** Logo `name` bzw. ohne Angabe das aktuelle aus den Einstellungen; solange keins da ist, das App-Symbol. */
export function Firmenlogo({ name }: { name?: string }) {
  const aktuell = useFirmenlogo((s) => s.name);
  const url = useLogoUrl(name ?? aktuell);
  if (!url) return <Logo />;
  return (
    <span className="logo logo-eigen">
      <img src={url} alt="" />
    </span>
  );
}

/** Marke in der Seitenleiste: liest beim Start einmal die Einstellung `firmenlogo`. */
export function Marke() {
  useEffect(() => {
    void firmenlogoLaden();
  }, []);
  return <Firmenlogo />;
}
