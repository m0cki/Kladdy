/* Daten für „Beleg zum Ertrag“ in der Erfassen-Schublade (§6.4): alles, was die Beleg-Maske zum Ausstellen braucht
 * (Firma, Kunden mit Anschrift, Nummernkreise, Kennwerte, Vorlagen von Quittung und Rechnung, Einstellungen › Belege)
 * plus die offenen Rechnungen zum Zuordnen. Nur lesen; ausgestellt wird über beleg_ausstellen bzw. beleg_bezahlt. */
import type { ErtragKontext, ErtragsArt } from '../ertrag';
import type { BelegZeile } from '../rechnungen';
import { ladeBelegEinstellungen, ladeFirma, ladeUstModus } from './einstellungen';
import { ladeFirmenlogo } from './firmenlogo';
import { ladeNummernkreise } from './nummernkreise';
import { ladeKundenAnschrift, ladeOffeneRechnungen } from './rechnungen';
import { ladeKennwerte } from './steuer';
import { ladeVorlagenFuerArt } from './vorlagen';

export interface ErtragStamm extends Omit<ErtragKontext, 'heute'> {
  /** Einstellung „Beleg bei Einnahmen“ */
  belegArt: ErtragsArt;
  offene: BelegZeile[];
}

export async function ladeErtragStamm(): Promise<ErtragStamm> {
  const [kunden, firma, ustModus, kreise, kennwerte, einstellungen, quittung, rechnung, offene, logo] = await Promise.all([
    ladeKundenAnschrift(),
    ladeFirma(),
    ladeUstModus(),
    ladeNummernkreise(),
    ladeKennwerte(),
    ladeBelegEinstellungen(),
    ladeVorlagenFuerArt('quittung'),
    ladeVorlagenFuerArt('rechnung'),
    ladeOffeneRechnungen(),
    ladeFirmenlogo(),
  ]);
  return {
    kunden,
    firma,
    ustModus,
    logo,
    kreise,
    kennwerte,
    vorlagen: { quittung, rechnung },
    zahlungszielTage: einstellungen.zahlungsziel_tage,
    belegArt: einstellungen.beleg_art,
    offene,
  };
}
