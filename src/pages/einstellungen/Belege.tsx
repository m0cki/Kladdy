/* Einstellungen › Belege (§6.10): „Beleg bei Einnahmen“ (Quittung oder Rechnung – Vorauswahl in der Erfassen-Schublade
 * und für vorbereitete Belege bei Terminen), Zahlungsziel neuer Rechnungen und Gültigkeit neuer Angebote.
 * Gespeichert in einstellungen['belege'] über lib/queries/einstellungen.ts (jede Änderung ins Protokoll). */
import { useEffect, useState } from 'react';
import { FileText, Receipt } from 'lucide-react';
import {
  BELEG_EINSTELLUNGEN_STANDARD,
  ladeBelegEinstellungen,
  speichereBelegEinstellungen,
  type BelegEinstellungen,
} from '../../lib/queries/einstellungen';
import { useUi } from '../../store/ui';
import { Seg } from '../../components/ui/Seg';
import { Ladeansicht, fehlerText, useLaden } from './Laden';
import { SetCard, SetRow } from './SetRow';

export default function Belege() {
  const { zustand, neuLaden, erneut } = useLaden(ladeBelegEinstellungen);
  if (zustand.status !== 'ok') return <Ladeansicht zustand={zustand} icon={FileText} was="Die Beleg-Einstellungen" erneut={erneut} />;
  return <Formular daten={zustand.daten} neuLaden={neuLaden} />;
}

function TageFeld({ id, wert, onSpeichern }: { id: string; wert: number; onSpeichern: (n: number) => void }) {
  const [text, setText] = useState(String(wert));
  useEffect(() => setText(String(wert)), [wert]);
  const ungueltig = !/^\d{1,3}$/.test(text.trim()) || Number(text) > 365;
  return (
    <div className="input-wrap set-tage">
      <input
        id={id}
        className={`input num ${ungueltig ? 'invalid' : ''}`}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!ungueltig && Number(text) !== wert) onSpeichern(Number(text));
          else if (ungueltig) setText(String(wert));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="suffix">Tage</span>
    </div>
  );
}

function Formular({ daten, neuLaden }: { daten: BelegEinstellungen; neuLaden: () => Promise<void> }) {
  const showToast = useUi((s) => s.showToast);
  const speichern = async (neu: BelegEinstellungen) => {
    try {
      if (await speichereBelegEinstellungen(neu)) showToast({ text: 'Gespeichert (im Protokoll)', icon: 'check' });
      await neuLaden();
    } catch (e) {
      showToast({ text: `Speichern ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    }
  };
  return (
    <SetCard title="Belege">
      <SetRow id="beleg-bei-einnahmen" label="Beleg bei Einnahmen" value={daten.beleg_art === 'rechnung' ? 'Rechnung' : 'Quittung'}>
        <Seg
          ariaLabel="Beleg bei Einnahmen"
          value={daten.beleg_art}
          onChange={(v) => void speichern({ ...daten, beleg_art: v })}
          options={[
            {
              value: 'quittung',
              label: (
                <>
                  <Receipt />
                  Quittung
                </>
              ),
            },
            {
              value: 'rechnung',
              label: (
                <>
                  <FileText />
                  Rechnung
                </>
              ),
            },
          ]}
        />
        <p className="hint">
          Vorauswahl beim Erfassen einer Einnahme und für vorbereitete Belege bei Terminen. Die Quittung enthält zugleich alle
          Rechnungsangaben (§ 34a UStDV); eine Rechnung braucht man, wenn der Kunde später zahlt, eine Firma beauftragt oder die
          Arbeitskosten absetzen will (§ 35a EStG).
        </p>
      </SetRow>
      <SetRow id="zahlungsziel" label="Zahlungsziel neuer Rechnungen" value={`${daten.zahlungsziel_tage} Tage`}>
        <TageFeld id="set-zahlungsziel" wert={daten.zahlungsziel_tage} onSpeichern={(n) => void speichern({ ...daten, zahlungsziel_tage: n })} />
        <p className="hint">Fälligkeit = Rechnungsdatum + Zahlungsziel. In der Maske je Rechnung änderbar. Standard {BELEG_EINSTELLUNGEN_STANDARD.zahlungsziel_tage} Tage.</p>
      </SetRow>
      <SetRow id="angebot-gueltig" label="Gültigkeit neuer Angebote" value={`${daten.angebot_tage} Tage`}>
        <TageFeld id="set-angebot-tage" wert={daten.angebot_tage} onSpeichern={(n) => void speichern({ ...daten, angebot_tage: n })} />
        <p className="hint">„Gültig bis“ auf dem Angebot. Standard {BELEG_EINSTELLUNGEN_STANDARD.angebot_tage} Tage.</p>
      </SetRow>
    </SetCard>
  );
}
