/* Einstellungen › Firma (§6.10, Pflichtangaben §2.3). Gespeichert in einstellungen['firma'] über lib/queries/einstellungen.ts
 * (jede Änderung ins Protokoll). Jedes Feld wird beim Verlassen geprüft (lib/firma.ts) und nur gültig gespeichert.
 * Firmenlogo (§6.10, Prototyp „logo-feld“): Kachel mit Vorschau, Klick oder Bild daraufziehen ⇒ Upload (lib/logoablage.ts),
 * „Zurücksetzen“ ⇒ App-Symbol, beides mit „Rückgängig“. Die Kachel ist eine eigene Dropzone: ein Drop auf sie öffnet
 * nicht die Erfassen-Schublade. */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Building2, CircleCheck, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { Firmenlogo } from '../../components/ui/Firmenlogo';
import { setzeDropZone, useBelegZiehen } from '../../lib/belegablage';
import {
  FIRMA_FELDER,
  FIRMA_LABEL,
  fehlendePflichtangaben,
  feldAnzeige,
  feldUebernehmen,
  type Firma as FirmaDaten,
  type FirmaFeld,
} from '../../lib/firma';
import { logoAusDrop, logoWaehlen, logoZuruecksetzen, useFirmenlogo } from '../../lib/logoablage';
import { ladeFirma, speichereFirma } from '../../lib/queries/einstellungen';
import { useUi } from '../../store/ui';
import { Ladeansicht, fehlerText, useLaden } from './Laden';
import { SetCard } from './SetRow';

interface FeldArt {
  placeholder?: string;
  hint?: string;
  full?: boolean;
  mono?: boolean;
  type?: 'text' | 'email' | 'tel' | 'url';
  autoComplete?: string;
}

const FELD_ART: Readonly<Record<FirmaFeld, FeldArt>> = {
  name: { placeholder: 'Mustermann Haus- & Gartenservice', full: true, autoComplete: 'organization' },
  inhaber: { placeholder: 'Max Mustermann', full: true, autoComplete: 'name' },
  strasse: { placeholder: 'Lindenweg 12', full: true, autoComplete: 'street-address' },
  plz: { placeholder: '12345', autoComplete: 'postal-code' },
  ort: { placeholder: 'Musterstadt', autoComplete: 'address-level2' },
  email: { placeholder: 'info@beispiel.de', type: 'email', autoComplete: 'email' },
  telefon: { placeholder: '0170 1234567', type: 'tel', autoComplete: 'tel' },
  web: { placeholder: 'www.beispiel.de', full: true, type: 'url', autoComplete: 'url' },
  steuernummer: { placeholder: '12/345/67890', mono: true, hint: 'vom Finanzamt' },
  ust_idnr: { placeholder: 'DE123456789', mono: true, hint: 'nur falls vorhanden' },
  ku_id: { mono: true, hint: 'Kleinunternehmer-Identifikationsnummer, nur falls vorhanden', full: true },
  bank: { placeholder: 'Musterbank', full: true },
  iban: { placeholder: 'DE89 3704 0044 0532 0130 00', mono: true },
  bic: { placeholder: 'COBADEFFXXX', mono: true },
  paypal: { placeholder: 'name@beispiel.de', type: 'email', full: true, hint: 'E-Mail-Adresse deines PayPal-Kontos' },
};

const GRUPPEN: readonly { titel: string; felder: readonly FirmaFeld[]; hinweis?: string }[] = [
  { titel: 'Firma & Anschrift', felder: ['name', 'inhaber', 'strasse', 'plz', 'ort'] },
  { titel: 'Kontakt', felder: ['email', 'telefon', 'web'] },
  {
    titel: 'Steuer',
    felder: ['steuernummer', 'ust_idnr', 'ku_id'],
    hinweis: 'Eine der drei Angaben genügt für Belege (§ 34a UStDV). Als Kleinunternehmer ist das meist die Steuernummer.',
  },
  {
    titel: 'Bankverbindung',
    felder: ['bank', 'iban', 'bic', 'paypal'],
    hinweis: 'Steht auf Rechnungen für die Überweisung und im GiroCode.',
  },
];

const anzeige = (f: FirmaDaten): FirmaDaten =>
  Object.fromEntries(FIRMA_FELDER.map((k) => [k, feldAnzeige(k, f[k])])) as FirmaDaten;

export default function Firma() {
  const { zustand, neuLaden, erneut } = useLaden(ladeFirma);
  if (zustand.status !== 'ok') return <Ladeansicht zustand={zustand} icon={Building2} was="Die Firmendaten" erneut={erneut} />;
  return <FirmaFormular gespeichert={zustand.daten} neuLaden={neuLaden} />;
}

function FirmaFormular({ gespeichert, neuLaden }: { gespeichert: FirmaDaten; neuLaden: () => Promise<void> }) {
  const toast = useUi((s) => s.toast);
  const [werte, setWerte] = useState<FirmaDaten>(() => anzeige(gespeichert));
  const [fehler, setFehler] = useState<Partial<Record<FirmaFeld, string>>>({});
  /* Gespeicherter Stand: als State für die Anzeige, als Ref für schnelle Folge-Änderungen (zwei Felder kurz nacheinander). */
  const [stand, setStand] = useState<FirmaDaten>(gespeichert);
  const standRef = useRef(gespeichert);

  useEffect(() => {
    standRef.current = gespeichert;
    setStand(gespeichert);
  }, [gespeichert]);

  const setFeldFehler = (feld: FirmaFeld, text: string | null) =>
    setFehler((f) => {
      const n = { ...f };
      if (text) n[feld] = text;
      else delete n[feld];
      return n;
    });

  const uebernehmen = async (feld: FirmaFeld) => {
    const r = feldUebernehmen(feld, werte[feld]);
    if ('fehler' in r) {
      setFeldFehler(feld, r.fehler);
      return;
    }
    setFeldFehler(feld, null);
    setWerte((w) => ({ ...w, [feld]: feldAnzeige(feld, r.wert) }));
    if (r.wert === standRef.current[feld]) return;
    const neu = { ...standRef.current, [feld]: r.wert };
    standRef.current = neu;
    try {
      await speichereFirma(neu);
      setStand(neu);
      toast(`${FIRMA_LABEL[feld]} gespeichert`);
    } catch (e) {
      toast(`Nicht gespeichert: ${fehlerText(e)}`, 'warn');
      await neuLaden();
    }
  };

  const onKey = (feld: FirmaFeld) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      e.preventDefault(); // nicht die Einstellungen verlassen
      setWerte((w) => ({ ...w, [feld]: feldAnzeige(feld, standRef.current[feld]) }));
      setFeldFehler(feld, null);
    }
  };

  const feldEl = (feld: FirmaFeld) => {
    const art = FELD_ART[feld];
    const id = `firma-${feld}`;
    const meldung = fehler[feld];
    return (
      <div key={feld} className={`field ${art.full ? 'full' : ''}`} data-setting={id}>
        <label htmlFor={id}>{FIRMA_LABEL[feld]}</label>
        <input
          id={id}
          className={`input ${art.mono ? 'mono' : ''} ${meldung ? 'invalid' : ''}`}
          type={art.type ?? 'text'}
          value={werte[feld]}
          placeholder={art.placeholder}
          autoComplete={art.autoComplete ?? 'off'}
          spellCheck={false}
          aria-invalid={meldung ? true : undefined}
          aria-describedby={meldung || art.hint ? `${id}-hint` : undefined}
          onChange={(e) => setWerte((w) => ({ ...w, [feld]: e.target.value }))}
          onBlur={() => void uebernehmen(feld)}
          onKeyDown={onKey(feld)}
        />
        {meldung ? (
          <p className="hint neg" id={`${id}-hint`} role="alert">
            {meldung}
          </p>
        ) : art.hint ? (
          <p className="hint" id={`${id}-hint`}>
            {art.hint}
          </p>
        ) : null}
      </div>
    );
  };

  const fehlt = fehlendePflichtangaben(stand);

  return (
    <>
      <SetCard title="Pflichtangaben für Belege" i={1}>
        {fehlt.length ? (
          <div className="set-note warn" data-setting="firma-pflichtangaben">
            <TriangleAlert />
            <span>
              <b>Für Rechnungen und Quittungen fehlt noch:</b> {fehlt.join(' · ')}. Diese Angaben müssen auf jedem Beleg stehen
              (§ 34a UStDV).
            </span>
          </div>
        ) : (
          <div className="set-note ok" data-setting="firma-pflichtangaben">
            <CircleCheck />
            <span>
              <b>Alles da.</b> Die Pflichtangaben für Rechnungen und Quittungen sind eingetragen (§ 34a UStDV).
            </span>
          </div>
        )}
        {!stand.iban ? <p className="hint">Ohne IBAN stehen auf Rechnungen keine Bankverbindung und kein GiroCode.</p> : null}
      </SetCard>

      {GRUPPEN.map((g, i) => (
        <SetCard key={g.titel} title={g.titel} i={i + 2}>
          <div className="form-grid">{g.felder.map(feldEl)}</div>
          {g.hinweis ? <p className="hint">{g.hinweis}</p> : null}
        </SetCard>
      ))}

      <SetCard title="Firmenlogo" i={GRUPPEN.length + 2}>
        <LogoFeld />
      </SetCard>
    </>
  );
}

/** Firmenlogo: Kachel (Klick = Dialog, Bild daraufziehen), Name, Hinweis, „Logo hochladen …“ und „Zurücksetzen“. */
function LogoFeld() {
  const name = useFirmenlogo((s) => s.name);
  const laeuft = useFirmenlogo((s) => s.laeuft);
  const ueber = useBelegZiehen((s) => s.ziehen && s.zone);
  const kachel = useRef<HTMLButtonElement>(null);

  // Nur Drops über der Kachel gehen ans Logo, alle anderen wie üblich (Erfassen-Schublade)
  useEffect(() => {
    setzeDropZone({ element: () => kachel.current, nimmt: logoAusDrop });
    return () => setzeDropZone(null);
  }, []);

  return (
    <div className="set-row" data-setting="firmenlogo">
      <div className="logo-feld">
        <button
          ref={kachel}
          type="button"
          className={`dropzone logo-dz${ueber ? ' over' : ''}`}
          onClick={() => void logoWaehlen()}
          disabled={laeuft}
          aria-busy={laeuft || undefined}
          title="Bild hierher ziehen oder klicken"
          aria-label="Logo hochladen"
        >
          <Firmenlogo name={name} />
        </button>
        <div className="logo-info">
          <b>{name ? 'Eigenes Logo' : 'Standard-Symbol'}</b>
          <small>PNG, JPG, SVG oder WebP – am besten quadratisch, mit weißem oder transparentem Hintergrund.</small>
          <div className="row wrap">
            <button type="button" className="btn subtle" onClick={() => void logoWaehlen()} disabled={laeuft}>
              <Upload />
              {name ? 'Anderes Logo …' : 'Logo hochladen …'}
            </button>
            {name ? (
              <button type="button" className="btn ghost" onClick={() => void logoZuruecksetzen()} disabled={laeuft}>
                <RotateCcw />
                Zurücksetzen
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <p className="hint">
        Erscheint oben links im Menü und im Kopf von Rechnungen und Angeboten. Auf die Quittung kommt es mit dem Baustein „Kopf
        mit Logo“ (Vorlagen). Bereits ausgestellte Belege behalten ihr bisheriges Aussehen.
      </p>
    </div>
  );
}
