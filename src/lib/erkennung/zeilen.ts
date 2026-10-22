/* Belegerkennung – Textstücke einer PDF-Seite zu Zeilen bündeln (Port von zeilenAus aus referenz/prototyp/js/beleg.js).
 * pdf.js liefert je Seite Textstücke mit Lage (`transform` = [a, b, c, d, x, y], y nach oben) und Breite. Stücke mit fast
 * gleicher Grundlinie bilden eine Zeile (von oben nach unten, links nach rechts). Große Lücken = Spaltenwechsel ⇒ zwei
 * Leerzeichen (daran erkennen die Regeln Beschriftung und Wert), kleine Lücken ⇒ ein Leerzeichen. pdf.js trennt bei
 * breiten Leerzeichen (Kassenbons in Courier: 0,6 em) schon zwischen Wörtern – deshalb gilt erst eine Lücke ab 0,8 em als
 * Spaltenwechsel (der Prototyp las ganze Textbefehle und nahm 0,5 em). Doppelt gedruckte Stücke (Fettdruck-Simulation)
 * zählen einmal, gedrehter Text kommt ans Ende. Rein, Tests: zeilen.test.ts */

/** Was die Regeln von einem pdf.js-Textstück brauchen (Auszug aus TextItem). */
export interface Textstueck {
  str: string;
  /** [a, b, c, d, x, y] im Seitenraum */
  transform: readonly number[];
  /** Breite im Seitenraum */
  width: number;
  /** Höhe (≈ Schriftgröße) im Seitenraum */
  height: number;
}

/** Lücke (in Schriftgrößen), ab der ein Spaltenwechsel angenommen wird. */
const SPALTE = 0.8;

interface Lauf {
  t: string;
  x0: number;
  x1: number;
  y: number;
  h: number;
  /** Reihenfolge im Inhaltsstrom */
  n: number;
}

export function zeilenAus(stuecke: readonly Textstueck[]): string[] {
  const gerade: Lauf[] = [];
  const quer: Lauf[] = [];
  stuecke.forEach((s, n) => {
    if (!s.str || !s.str.trim()) return;
    const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = s.transform;
    if (![a, b, c, d, x, y].every(Number.isFinite)) return;
    const h = s.height > 0 ? s.height : Math.hypot(c, d) || 10;
    const lauf = { t: s.str, x0: x, x1: x + Math.max(0, s.width || 0), y, h, n };
    // gedreht (Randvermerk) oder gespiegelt ⇒ nicht in die Zeilen mischen
    if (Math.abs(b) > 0.1 * Math.abs(a) || a <= 0) quer.push(lauf);
    else gerade.push(lauf);
  });
  gerade.sort((p, q) => q.y - p.y || p.x0 - q.x0);
  const zeilen: { y: number; h: number; laeufe: Lauf[] }[] = [];
  for (const r of gerade) {
    const z = zeilen[zeilen.length - 1];
    if (z && Math.abs(z.y - r.y) <= Math.max(1, 0.5 * Math.min(z.h, r.h))) z.laeufe.push(r);
    else zeilen.push({ y: r.y, h: r.h, laeufe: [r] });
  }
  const out = zeilen.map((z) => {
    z.laeufe.sort((p, q) => p.x0 - q.x0 || p.n - q.n);
    let s = '';
    let letzter: Lauf | null = null;
    let ende = -Infinity;
    for (const r of z.laeufe) {
      if (letzter) {
        if (r.t === letzter.t && Math.abs(r.x0 - letzter.x0) < 1) continue; // Doppeldruck (Fett-Simulation)
        const luecke = r.x0 - ende;
        const em = Math.max(letzter.h, r.h);
        if (luecke > em * SPALTE) s = `${s.replace(/\s+$/, '')}  `;
        else if (luecke > em * 0.12 && !/\s$/.test(s) && !/^\s/.test(r.t)) s += ' ';
      }
      s += r.t;
      letzter = r;
      ende = Math.max(ende, r.x1);
    }
    return s.trim();
  });
  quer.sort((p, q) => p.n - q.n).forEach((r) => out.push(r.t.trim()));
  return out.filter(Boolean);
}
