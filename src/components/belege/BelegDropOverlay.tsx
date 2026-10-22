/* Overlay „Beleg hier ablegen“, solange eine Datei über das Fenster gezogen wird (§6.4, Optik wie im Prototyp:
 * .drop-overlay/.drop-card). Ist die Erfassen-Schublade offen und nimmt Dateien an, bleibt das Overlay weg: Dann leuchtet
 * dort die Dropzone (.over), und der Drop landet in dieser Eingabe. Ebenso über der eigenen Dropzone einer Seite
 * (Firmenlogo-Kachel). Bewegung folgt data-motion (belege.css). */
import { Upload } from 'lucide-react';
import { useBelegZiehen } from '../../lib/belegablage';
import { useErfassen } from '../../lib/erfassen';
import { useUi } from '../../store/ui';

export function BelegDropOverlay() {
  const ziehen = useBelegZiehen((s) => s.ziehen && !s.zone);
  const schubladeOffen = useUi((s) => s.drawer === 'erfassen');
  const nimmt = useErfassen((s) => s.auftrag !== null && s.nimmtBelege);
  const inSchublade = schubladeOffen && nimmt;
  return (
    <div className={`drop-overlay ${ziehen && !inSchublade ? 'show' : ''}`} aria-hidden="true">
      <div className="drop-card">
        <Upload />
        <b>Beleg hier ablegen</b>
        <small>PDF, Foto oder E-Rechnung · öffnet „Ausgabe erfassen“ mit dem Beleg</small>
      </div>
    </div>
  );
}
