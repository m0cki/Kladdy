import { describe, expect, it } from 'vitest';
import type { Baustein } from '../vorlagen/bausteine';
import { BEISPIEL_FIRMA, testbeleg } from '../vorlagen/beispiel';
import { BELEGARTEN, type BelegDokument } from '../vorlagen/dokument';
import { standardVorlage } from '../vorlagen/standard';
import { MAKRO_NAMEN, datenTex, makroWerte, positionenTex } from './daten';
import { KompilierFehler, fehlerZeilen } from './kompilieren';
import { abstandMm, bereichZuZeile, mainTex, textTex } from './vorlage';

const rechnung = (): BelegDokument => testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18');
const quittung = (): BelegDokument => testbeleg('quittung', BEISPIEL_FIRMA, 'klein', '2026-10-18');

/** Geschweifte Klammern ausgeglichen? (escaped \{ \} und Kommentare zählen nicht) */
function klammernOk(tex: string): boolean {
  let tiefe = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < tex.length && tex[i] !== '\n') i++;
      continue;
    }
    if (c === '{') tiefe++;
    if (c === '}' && --tiefe < 0) return false;
  }
  return tiefe === 0;
}

/** Inhalt eines Makros aus daten.tex (einzeilige Definitionen). */
const makro = (daten: string, name: string) => new RegExp(`^\\\\newcommand\\{\\\\${name}\\}\\{(.*)\\}$`, 'm').exec(daten)?.[1];

describe('daten.tex', () => {
  it('Kunde „Müller & Söhne 100%“ escaped', () => {
    const d = datenTex(rechnung());
    expect(makro(d, 'KundeName')).toBe(String.raw`Müller \& Söhne 100\%`);
    expect(makro(d, 'KundeAnzeige')).toBe(String.raw`Müller \& Söhne 100\%`);
    expect(makro(d, 'Betreff')).toBe(String.raw`Gartenpflege \& Heckenschnitt (100\% erledigt)`);
    expect(makro(d, 'Firma')).toBe(String.raw`Mustermann Haus- \& Gartenservice`);
  });

  it('jedes Makro genau einmal definiert, Klammern ausgeglichen', () => {
    for (const doc of [rechnung(), quittung()]) {
      const d = datenTex(doc);
      for (const n of MAKRO_NAMEN) expect(d.split(`\\newcommand{\\${n}}`).length - 1, n).toBe(1);
      expect(klammernOk(d)).toBe(true);
    }
  });

  it('Positionen als \\Position-Folge, Beträge mit \\,€', () => {
    const p = positionenTex(rechnung()).split('\n');
    expect(p).toHaveLength(3);
    expect(p[0]).toBe(String.raw`  \Position{1}{Heckenschnitt \& Rasenpflege}{3}{Std.}{45,00\,€}{135,00\,€}%`);
    expect(p[1]).toContain(String.raw`Grünschnitt-Entsorgung\newline{}(Anhänger\_1, inkl. Fahrt)`);
    expect(p[2]).toBe(
      String.raw`  \Position{3}{Dünger \textquotedbl{}Bio\textquotedbl{} \#5 – 50 \% Rabatt \{Aktion\} \textasciitilde{} \textasciicircum{} \textbackslash{} \$}{2,5}{kg}{3,99\,€}{9,98\,€}%`,
    );
    expect(makro(datenTex(rechnung()), 'Gesamt')).toBe(String.raw`162,98\,€`);
    expect(makro(datenTex(rechnung()), 'AnzahlPositionen')).toBe('3');
  });

  it('große Beträge mit Tausenderpunkt', () => {
    const d = { ...rechnung(), positionen: [{ beschreibung: 'X', menge: 1, einheit: '', einzelpreis_cent: 123450 }] };
    expect(makroWerte(d).Gesamt).toBe(String.raw`1.234,50\,€`);
  });

  it('LaTeX-Befehle in Nutzerwerten werden zu Text', () => {
    const boese = String.raw`\input{/etc/passwd}\write18{rm -rf ~}`;
    const d = { ...rechnung(), firma: { ...BEISPIEL_FIRMA, name: boese }, betreff: `Zeile 1\n${boese}` };
    const t = datenTex(d);
    expect(makro(t, 'Firma')).toBe(String.raw`\textbackslash{}input\{/etc/passwd\}\textbackslash{}write18\{rm -rf \textasciitilde{}\}`);
    expect(t).not.toMatch(/\\input\{\/etc/);
    expect(t).not.toMatch(/\\write18/);
    expect(klammernOk(t)).toBe(true);
  });

  it('fehlende Werte sind leere Makros, Entwurf ohne Nummer', () => {
    const t = datenTex({ ...quittung(), kunde: null });
    expect(makro(t, 'Nummer')).toBe('');
    expect(makro(t, 'KundeName')).toBe('');
    expect(makro(t, 'KundeAnzeige')).toBe('Barverkauf');
    expect(makro(t, 'Zahlungsart')).toBe('Bar');
    expect(makro(t, 'LogoDatei')).toBe('');
    expect(makro(t, 'Storniert')).toBe('');
    expect(makro(datenTex({ ...quittung(), storniert: true, nummer: 'QU-2026-0001' }), 'Storniert')).toBe('1');
  });

  it('§ 19-Hinweis nur für Kleinunternehmer, Zahlungshinweis nur bei offener Rechnung', () => {
    expect(makroWerte(rechnung()).Steuerhinweis).toContain('§ 19 UStG');
    expect(makroWerte({ ...rechnung(), ust_modus: 'regel' }).Steuerhinweis).toBe('');
    expect(makroWerte(rechnung()).Zahlungshinweis).toContain('01.11.2026');
    expect(makroWerte(quittung()).Zahlungshinweis).toBe('');
    const quittiert = { ...rechnung(), quittiert: { am: '2026-10-18', zahlungsweg: 'bar' as const } };
    expect(makroWerte(quittiert).Zahlungshinweis).toBe('');
    expect(makroWerte(quittiert).Quittiert).not.toBe('');
  });

  it('keine Positionen ⇒ leeres \\Positionen', () => {
    expect(datenTex({ ...rechnung(), positionen: [] })).toContain('\\newcommand{\\Positionen}{}');
  });
});

describe('main.tex', () => {
  const pakete = (tex: string) => [...tex.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)].flatMap((m) => m[1].split(/,\s*/));

  it('A4 für Rechnung/Angebot, A5 quer für Quittung/Eigenbeleg', () => {
    for (const art of BELEGARTEN) {
      const { tex } = mainTex(art, standardVorlage(art), '#6366f1');
      const a4 = art === 'rechnung' || art === 'angebot';
      expect(tex.includes('a4paper'), art).toBe(a4);
      expect(tex.includes('a5paper, landscape'), art).toBe(!a4);
      // Falz- und Lochmarken nur auf A4
      expect(tex.includes('148.5mm'), art).toBe(a4);
    }
  });

  it('Aufbau: Präambel, daten.tex, ein Dokument, Klammern ausgeglichen', () => {
    for (const art of BELEGARTEN) {
      const { tex } = mainTex(art, standardVorlage(art), '#6366f1');
      expect(tex.startsWith('% Kladdy')).toBe(true);
      expect(tex.match(/\\documentclass/g)).toHaveLength(1);
      expect(tex.match(/\\input\{daten\.tex\}/g)).toHaveLength(1);
      expect(tex.indexOf('\\input{daten.tex}')).toBeLessThan(tex.indexOf('\\begin{document}'));
      expect(tex.match(/\\begin\{document\}/g)).toHaveLength(1);
      expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
      expect(klammernOk(tex), art).toBe(true);
      // Leerzeilen im Dokument würden Absätze erzeugen
      expect(tex.slice(tex.indexOf('\\begin{document}'))).not.toMatch(/\n\s*\n/);
    }
  });

  it('nur Standardpakete, kein Shell-Escape', () => {
    const { tex } = mainTex('rechnung', standardVorlage('rechnung'), '#6366f1');
    expect(pakete(tex).sort()).toEqual(['babel', 'eso-pic', 'etoolbox', 'fontspec', 'geometry', 'graphicx', 'xcolor']);
    expect(tex).not.toMatch(/\\write18|\\directlua|\\immediate|\\openout|\\ShellEscape/);
  });

  it('enthält keine Belegdaten (die stehen in daten.tex)', () => {
    const { tex } = mainTex('rechnung', standardVorlage('rechnung'), '#6366f1');
    for (const s of ['Müller', 'Mustermann', '162,98', 'K-0042', 'Heckenschnitt']) expect(tex).not.toContain(s);
    expect(tex).toContain('\\KundeAnzeige');
    expect(tex).toContain('\\Positionen');
    expect(tex).toContain('\\Gesamt');
  });

  it('Akzentfarbe als HTML-Farbe', () => {
    expect(mainTex('quittung', standardVorlage('quittung'), '#6366f1').tex).toMatch(/\\definecolor\{akzent\}\{HTML\}\{[0-9A-F]{6}\}/);
  });

  it('Texte aus Bausteinen escaped, Platzhalter ⇒ Makros', () => {
    const v: Baustein[] = [{ typ: 'titel', text: 'Rechnung & Co 50% {nr} {foo} \\input{x}' }];
    const { tex } = mainTex('rechnung', v, '#6366f1');
    expect(tex).toContain(String.raw`Rechnung \& Co 50\% \KNr{} \{foo\} \textbackslash{}input\{x\}`);
    expect(tex).not.toContain('\\input{x}');
  });

  it('Umbrüche in Freitexten werden Absätze', () => {
    expect(textTex('Guten Tag,\n{einleitung}').tex).toBe(String.raw`Guten Tag,\par \Einleitung{}`);
    expect(textTex('A\n\nB').tex).toBe(String.raw`A\par \vspace{\baselineskip}B`);
    expect(textTex('A\nB', true).tex).toBe('A B');
  });

  it('nur Platzhalter ⇒ bedingt gedruckt; fester Text ⇒ immer', () => {
    expect(textTex('{schlusstext}').leer).toEqual(['Schlusstext']);
    expect(textTex('Hallo {kunde}').leer).toBeNull();
    expect(textTex('{art} {nr}').leer).toBeNull(); // „Entwurf“ steht immer da
    expect(textTex('').leer).toEqual([]);
    const { tex } = mainTex('rechnung', [{ typ: 'text', text: '{schlusstext}' }], '#6366f1');
    expect(tex).toContain(String.raw`\ifboolexpr{test {\ifdefempty{\Schlusstext}}}{}{%`);
  });

  it('ausgeblendete und leere Bausteine fehlen', () => {
    const { tex } = mainTex(
      'rechnung',
      [{ typ: 'betreff', aus: true }, { typ: 'text', text: '' }, { typ: 'gruss' }],
      '#6366f1',
    );
    expect(tex).not.toContain('Baustein 1');
    expect(tex).not.toContain('Baustein 2');
    expect(tex).toContain('% Baustein 3: Grußformel');
  });

  it('Fußzeile am Blattende', () => {
    const { tex } = mainTex('rechnung', standardVorlage('rechnung'), '#6366f1');
    const fill = tex.indexOf('\\vspace{6mm plus 1fill}');
    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThan(tex.indexOf('Fußzeile'));
    expect(tex.indexOf('Grußformel')).toBeLessThan(fill);
  });

  it('Bereiche ordnen Zeilen den Bausteinen zu', () => {
    const m = mainTex('rechnung', standardVorlage('rechnung'), '#6366f1');
    const zeilen = m.tex.split('\n');
    const pos = zeilen.findIndex((z) => z.startsWith('\\renewcommand{\\Position}')) + 1;
    expect(bereichZuZeile(m, pos)).toMatchObject({ typ: 'positionen', index: 8, name: 'Positionen' });
    expect(bereichZuZeile(m, 1)).toBeNull();
    for (const b of m.bereiche) expect(zeilen[b.von - 1]).toMatch(/^% Baustein \d+: /);
  });

  it('Abstände wie in der Vorschau', () => {
    expect(abstandMm(null, 'titel')).toBe(0);
    expect(abstandMm(null, 'positionen')).toBe(6);
    expect(abstandMm('titel', 'betreff')).toBe(1.5);
    expect(abstandMm('betreff', 'text')).toBe(4.5);
    expect(abstandMm('positionen', 'summe')).toBe(0);
    expect(abstandMm('summe', 'steuerhinweis')).toBe(5);
    expect(abstandMm('quittung_felder', 'steuerhinweis')).toBe(0);
    expect(abstandMm('titel', 'quittung_felder')).toBe(3.5);
    expect(abstandMm('text', 'unterschrift')).toBe(10);
    expect(abstandMm(null, 'unterschrift', true)).toBe(0);
    expect(abstandMm('text', 'positionen')).toBe(3.5);
  });
});

describe('Kompilierfehler lesbar', () => {
  it('Zeile in main.tex ⇒ Baustein, daten.tex ⇒ Datei', () => {
    const m = mainTex('rechnung', standardVorlage('rechnung'), '#6366f1');
    const zeile = m.bereiche.find((b) => b.typ === 'summe')!.von + 1;
    const f = new KompilierFehler({
      meldung: 'Kompilieren fehlgeschlagen',
      abgebrochen: false,
      log: '',
      fehler: [
        { datei: 'main.tex', zeile, meldung: 'Undefined control sequence', kontext: null },
        { datei: 'daten.tex', zeile: 3, meldung: 'Missing $ inserted', kontext: null },
        { datei: null, zeile: null, meldung: 'Font nicht gefunden', kontext: null },
      ],
    });
    expect(fehlerZeilen(f, m)).toEqual([
      `Baustein „Gesamtbetrag“ (main.tex Zeile ${zeile}): Undefined control sequence`,
      'daten.tex Zeile 3: Missing $ inserted',
      'main.tex: Font nicht gefunden',
    ]);
    expect(f).toBeInstanceOf(Error);
    expect(f.message).toBe('Kompilieren fehlgeschlagen');
  });
});
