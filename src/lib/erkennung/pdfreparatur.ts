/* Belegerkennung – Rettungsweg für PDFs, deren Objekte in Objekt-Streams liegen, die Querverweistabelle sie aber nicht
 * kennt (klassische Tabelle führt sie als „frei“, ein Querverweis-Stream fehlt). pdf.js hält sich an die Tabelle, findet
 * dann z. B. die Schrift nicht und liefert Steuerzeichen statt Text (so bei referenz/beispiel-belege/Rechnung_Telekom.pdf;
 * der Prototyp las solche Dateien, weil sein Leser die Objekte selbst sucht).
 * `verdaechtig` erkennt solchen Text, `objektstroemeAnhaengen` hängt die Objekte aus den Objekt-Streams als
 * inkrementelle Aktualisierung (neue Objekte + Querverweise + Trailer mit /Prev) an eine Kopie an – das Original bleibt
 * unberührt, nur pdf.js liest die Kopie ein zweites Mal. Rein bis auf das Entpacken (DecompressionStream),
 * Tests: pdfreparatur.test.ts */

const STEUERZEICHEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Sieht der gelesene Text nach einer nicht ladbaren Schrift aus (viele Steuerzeichen)? */
export function verdaechtig(zeilen: readonly string[]): boolean {
  const text = zeilen.join('');
  const n = (text.match(STEUERZEICHEN) ?? []).length;
  return n >= 5 && n >= text.replace(/\s/g, '').length * 0.02;
}

/** Bytes ⇒ Zeichen 1:1 (Latin-1), damit Positionen und Binärinhalte erhalten bleiben. */
function latin1(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
}

/** FlateDecode (zlib) über die Plattform. */
async function entpacken(roh: Uint8Array): Promise<Uint8Array> {
  const strom = new Blob([new Uint8Array(roh)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

/** Rettung nur für Belege bis 10 MB (die Datei liegt dafür einmal als Text im Speicher). */
const MAX_BYTES = 10 * 1024 * 1024;

/** Kopie der PDF mit den Objekten aus Objekt-Streams als normale Objekte; null, wenn es nichts anzuhängen gibt. */
export async function objektstroemeAnhaengen(daten: Uint8Array, inflate: (roh: Uint8Array) => Promise<Uint8Array> = entpacken): Promise<Uint8Array | null> {
  if (daten.length > MAX_BYTES) return null;
  const s = latin1(daten);
  const vorhanden = new Set([...s.matchAll(/(?:^|[\s>])(\d+)\s+\d+\s+obj\b/g)].map((m) => Number(m[1])));
  const neu = new Map<number, string>();
  const objekt = /(\d+)\s+\d+\s+obj\s*<</g;
  let m: RegExpExecArray | null;
  while ((m = objekt.exec(s))) {
    // nur Stream-Objekte: „stream“ kommt vor dem nächsten „endobj“
    const ab = m.index + m[0].length;
    const st = s.indexOf('stream', ab);
    const ende = s.indexOf('endobj', ab);
    if (st < 0 || (ende >= 0 && ende < st)) continue;
    const dict = s.slice(ab, st);
    if (!/\/Type\s*\/ObjStm\b/.test(dict) || /\/DecodeParms|\/Encrypt/.test(dict)) continue;
    const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0);
    // Länge direkt oder als Verweis „/Length 9 0 R“ auf ein Objekt mit der Zahl
    const verweis = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
    const laenge = Number(
      verweis
        ? (new RegExp(`(?:^|\\s)${verweis[1]}\\s+${verweis[2]}\\s+obj\\s*(\\d+)\\s*endobj`).exec(s)?.[1] ?? 0)
        : (/\/Length\s+(\d+)/.exec(dict)?.[1] ?? 0),
    );
    if (!n || !first || !laenge) continue;
    let start = st + 'stream'.length;
    if (s[start] === '\r') start++;
    if (s[start] === '\n') start++;
    objekt.lastIndex = start + laenge;
    const filter = /\/Filter\s*\/(\w+)/.exec(dict)?.[1];
    if (filter && filter !== 'FlateDecode') continue;
    let inhalt: string;
    try {
      const roh = daten.subarray(start, start + laenge);
      inhalt = latin1(filter ? await inflate(roh) : roh);
    } catch {
      continue;
    }
    const kopf = inhalt.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n && 2 * i + 1 < kopf.length; i++) {
      const nr = kopf[2 * i];
      const von = first + kopf[2 * i + 1];
      const bis = i + 1 < n && 2 * i + 3 < kopf.length ? first + kopf[2 * i + 3] : inhalt.length;
      if (Number.isInteger(nr) && nr > 0 && !vorhanden.has(nr) && bis > von) neu.set(nr, inhalt.slice(von, bis).trim());
    }
  }
  const root = [...s.matchAll(/\/Root\s+(\d+\s+\d+\s+R)/g)].pop()?.[1];
  const prev = [...s.matchAll(/startxref\s+(\d+)/g)].pop()?.[1];
  if (!neu.size || !root || !prev) return null;
  const size = Math.max(0, ...[...s.matchAll(/\/Size\s+(\d+)/g)].map((x) => Number(x[1])), ...[...neu.keys()].map((k) => k + 1));
  let anhang = '\n';
  const lagen: [number, number][] = [];
  for (const [nr, inhalt] of neu) {
    lagen.push([nr, daten.length + anhang.length]);
    anhang += `${nr} 0 obj\n${inhalt}\nendobj\n`;
  }
  const xref = daten.length + anhang.length;
  anhang += `xref\n${lagen.map(([nr, o]) => `${nr} 1\n${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  anhang += `trailer\n<< /Size ${size} /Root ${root} /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`;
  const out = new Uint8Array(daten.length + anhang.length);
  out.set(daten);
  for (let i = 0; i < anhang.length; i++) out[daten.length + i] = anhang.charCodeAt(i) & 0xff;
  return out;
}
