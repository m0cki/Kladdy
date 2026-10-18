/* Betrag in Worten (ANLEITUNG §6.6 Quittung, §7.4 Makro \BetragInWorten, §7.6), wie im Prototyp
 * (pages/belege.js → wortBetrag): 0 … 999.999.999 Euro, „ein Euro“, „einhunderteins Euro“, „eintausend“, „eine Million“.
 * Nur Ganzzahlen (Cent), kein Float. Tests: zahl-in-worten.test.ts */
import { formatBetrag, pruefeCent } from '../money';

const EINS = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn',
  'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const ZEHNER = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

const unter100 = (n: number): string => (n < 20 ? EINS[n] : (n % 10 ? EINS[n % 10] + 'und' : '') + ZEHNER[Math.floor(n / 10)]);
const unter1000 = (n: number): string => (n >= 100 ? EINS[Math.floor(n / 100)] + 'hundert' : '') + unter100(n % 100);

/** Größter Betrag in Worten (darüber gibt `betragInWorten` die Ziffern zurück). */
export const MAX_EURO_IN_WORTEN = 999_999_999;

/**
 * Ganze Zahl 0 … 999.999.999 in Worten. `vorNomen`: „ein“ statt „eins“ für genau 1 (ein Euro, ein Cent);
 * sonst endet eine 1 als „eins“ (einhunderteins, eintausendeins).
 */
export function zahlInWorten(n: number, vorNomen = false): string {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_EURO_IN_WORTEN) throw new RangeError(`zahlInWorten: ${n} liegt außerhalb 0 … 999.999.999`);
  if (n === 0) return 'null';
  const mio = Math.floor(n / 1e6);
  const tsd = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const teile: string[] = [];
  if (mio) teile.push(mio === 1 ? 'eine Million' : unter1000(mio).replace(/ein$/, 'eine') + ' Millionen');
  let s = (tsd ? unter1000(tsd) + 'tausend' : '') + unter1000(rest);
  if (rest % 100 === 1 && !(vorNomen && n === 1)) s = s.replace(/ein$/, 'eins');
  if (s) teile.push(s);
  return teile.join(' ');
}

/** Cent ⇒ „einhundertdreiundfünfzig Euro und fünfzig Cent“. Das Vorzeichen zählt nicht (Beträge auf Belegen). */
export function betragInWorten(cent: number): string {
  pruefeCent(cent);
  const betrag = Math.abs(cent);
  const euro = Math.floor(betrag / 100);
  const c = betrag % 100;
  if (euro > MAX_EURO_IN_WORTEN) return formatBetrag(betrag);
  if (!euro && c) return `${zahlInWorten(c, true)} Cent`;
  return `${zahlInWorten(euro, true)} Euro${c ? ` und ${zahlInWorten(c, true)} Cent` : ''}`;
}
