/* Rückfragen zu Belegen als kleine Schublade (Prototyp bezahltDialog, dochOffenDialog, stornoDialog, alsRechnungDialog,
 * verwerfenDialog): „Bezahlt …“ fragt Datum und Zahlungsweg, die anderen erklären, was passiert (GoBD: Storno statt
 * Löschen, Nummer bleibt vergeben). Geöffnet von überall über `belegDialog(…)`; hängt im AppShell. */
import { useEffect, useState } from 'react';
import { Ban, Check, FileText, RotateCcw, Trash2 } from 'lucide-react';
import { create } from 'zustand';
import { alsBezahlt, alsRechnungNeu, dochOffen, entwurfLoeschen, stornieren } from '../../lib/belegaktionen';
import { ZAHLUNGSWEGE, type Zahlungsart } from '../../lib/buchungen';
import { formatBetrag } from '../../lib/money';
import { ART_NAME, type BelegZeile } from '../../lib/rechnungen';
import { datumText } from '../../lib/vorlagen/dokument';
import { heute } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { Drawer } from '../ui/Drawer';
import { Seg } from '../ui/Seg';
import { ZAHLUNGSWEG_ICON } from '../buchungen/Symbole';

export type BelegDialogArt = 'bezahlt' | 'doch-offen' | 'stornieren' | 'als-rechnung' | 'loeschen';

type Ziel = Pick<BelegZeile, 'id' | 'nummer' | 'art' | 'status' | 'summe_cent' | 'zahlungsart' | 'bezahlt_am' | 'termin_id'>;

interface Auftrag {
  art: BelegDialogArt;
  ziel: Ziel;
  /** nach Erfolg, z. B. zum neuen Entwurf springen (ID des neuen Entwurfs bei „als Rechnung“) */
  danach?: (id: number | null) => void;
  n: number;
}

const useBelegDialog = create<{ auftrag: Auftrag | null }>(() => ({ auftrag: null }));
let zaehler = 0;

export function belegDialog(art: BelegDialogArt, ziel: Ziel, danach?: (id: number | null) => void): void {
  useBelegDialog.setState({ auftrag: { art, ziel, danach, n: ++zaehler } });
  useUi.getState().openDrawer('beleg');
}

const TITEL: Readonly<Record<BelegDialogArt, string>> = {
  bezahlt: 'Als bezahlt markieren',
  'doch-offen': 'Doch noch offen?',
  stornieren: 'Stornieren',
  'als-rechnung': 'Als Rechnung neu ausstellen',
  loeschen: 'Entwurf löschen',
};

export function BelegDialog() {
  const open = useUi((s) => s.drawer === 'beleg');
  const closeDrawer = useUi((s) => s.closeDrawer);
  const auftrag = useBelegDialog((s) => s.auftrag);
  const [datum, setDatum] = useState(heute());
  const [za, setZa] = useState<Zahlungsart>('bank');
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (!auftrag) return;
    setDatum(heute());
    setZa(auftrag.ziel.zahlungsart ?? 'bank');
    setLaeuft(false);
  }, [auftrag]);

  if (!auftrag) return null;
  const { art, ziel, danach } = auftrag;
  const nr = ziel.nummer ?? 'Entwurf';
  const betrag = formatBetrag(Math.abs(ziel.summe_cent));
  const was = ziel.art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme';
  const mitZahlung = ziel.status === 'bezahlt';

  const los = async () => {
    if (laeuft) return;
    setLaeuft(true);
    let ok = false;
    let neu: number | null = null;
    if (art === 'bezahlt') ok = await alsBezahlt(ziel, datum, za);
    else if (art === 'doch-offen') ok = await dochOffen(ziel);
    else if (art === 'stornieren') ok = (await stornieren(ziel)) != null;
    else if (art === 'loeschen') ok = await entwurfLoeschen(ziel);
    else {
      neu = await alsRechnungNeu(ziel);
      ok = neu != null;
    }
    setLaeuft(false);
    if (!ok) return;
    closeDrawer();
    danach?.(neu);
  };

  const fuss = (
    <>
      <span className="spacer" />
      <button type="button" className="btn ghost" onClick={closeDrawer}>
        Abbrechen
      </button>
      {art === 'bezahlt' ? (
        <button type="button" className="btn-primary sm" disabled={laeuft || !datum} onClick={() => void los()}>
          <Check />
          Bezahlt buchen
        </button>
      ) : art === 'doch-offen' ? (
        <button type="button" className="btn-primary sm" disabled={laeuft} onClick={() => void los()}>
          <RotateCcw />
          Wieder offen
        </button>
      ) : art === 'als-rechnung' ? (
        <button type="button" className="btn-primary sm" disabled={laeuft} onClick={() => void los()}>
          <FileText />
          Stornieren &amp; Rechnung anlegen
        </button>
      ) : (
        <button type="button" className="btn danger" disabled={laeuft} onClick={() => void los()}>
          {art === 'loeschen' ? <Trash2 /> : <Ban />}
          {art === 'loeschen' ? 'Löschen' : 'Stornieren'}
        </button>
      )}
    </>
  );

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      title={art === 'stornieren' ? `${ART_NAME[ziel.art]} stornieren` : TITEL[art]}
      sub={`${nr} · ${betrag}`}
      icon={art === 'bezahlt' ? Check : art === 'doch-offen' ? RotateCcw : art === 'loeschen' ? Trash2 : Ban}
      width={440}
      foot={fuss}
      className="bl-dialog"
    >
      <section>
        {art === 'bezahlt' ? (
          <>
            <div className="field">
              <label className="field-label" htmlFor="bl-bezahlt-am">
                Zahlungseingang am
              </label>
              <input id="bl-bezahlt-am" type="date" className="input" value={datum} max={heute()} onChange={(e) => setDatum(e.target.value)} />
            </div>
            <div className="field">
              <span className="field-label">Zahlungsweg</span>
              <Seg
                className="full bl-zaseg"
                ariaLabel="Zahlungsweg"
                value={za}
                onChange={setZa}
                options={ZAHLUNGSWEGE.map((z) => {
                  const Icon = ZAHLUNGSWEG_ICON[z.id];
                  return {
                    value: z.id,
                    label: (
                      <>
                        <Icon />
                        {z.name}
                      </>
                    ),
                  };
                })}
              />
            </div>
            <p className="hint">
              Gebucht wird eine Einnahme über {betrag} mit Beleg {nr}. Über den Status lässt sich das jederzeit wieder umkehren.
            </p>
          </>
        ) : art === 'doch-offen' ? (
          <>
            <p>
              {nr} wird wieder als <b>offen</b> geführt{ziel.bezahlt_am ? ` – bisher bezahlt am ${datumText(ziel.bezahlt_am)}` : ''}.
            </p>
            <p className="hint">Die Einnahme wird per Storno-Buchung zurückgenommen (GoBD). Nummer und Beleg der Rechnung bleiben unverändert.</p>
          </>
        ) : art === 'stornieren' ? (
          <>
            <p>
              Der Beleg wird als <b>storniert</b> markiert und bleibt unverändert archiviert. Seine Nummer bleibt vergeben. Das ist
              endgültig.
            </p>
            <p className="hint">
              Es entsteht ein Stornobeleg mit eigener Nummer über −{betrag}, der auf {nr} verweist
              {mitZahlung ? `, und eine Storno-Buchung zur ${was}` : ''}.
            </p>
          </>
        ) : art === 'als-rechnung' ? (
          <>
            <p>
              {nr} wird <b>storniert</b>
              {mitZahlung ? ' (die Einnahme wird zurückgenommen)' : ''}. Mit denselben Angaben entsteht eine <b>Rechnung als Entwurf</b> – mit
              Zahlungsziel und GiroCode.
            </p>
            <p className="hint">Beim Ausstellen bekommt sie eine RE-Nummer. Ist das Geld schon da, danach über den Status als bezahlt markieren.</p>
          </>
        ) : (
          <p>
            Der Entwurf hat noch keine Nummer – er wird gelöscht, ein Storno ist nicht nötig.
            {ziel.termin_id != null ? ' Der Termin bleibt geplant.' : ''}
          </p>
        )}
      </section>
    </Drawer>
  );
}
