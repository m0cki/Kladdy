import { describe, expect, it } from 'vitest';
import type { Baustein } from '../vorlagen/bausteine';
import { BEISPIEL_FIRMA, testbeleg } from '../vorlagen/beispiel';
import { BELEGARTEN, type BelegDokument } from '../vorlagen/dokument';
import { standardVorlage } from '../vorlagen/standard';
import { MAKRO_NAMEN, datenTex, makroWerte, positionenTex } from './daten';
import { KompilierFehler, belegAssets, belegTex, fehlerZeilen } from './kompilieren';
import { RAHMEN_MM, abstandMm, bereichZuZeile, formatTex, mainTex, rahmenTex, striche, textTex } from './vorlage';
import { OHNE_STIL } from '../vorlagen/formatierung';

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

  it('\\GiroCode nur bei offener Rechnung mit gültigen EPC-Daten', () => {
    expect(makro(datenTex(rechnung()), 'GiroCode')).toBe('girocode.png');
    expect(makro(datenTex(quittung()), 'GiroCode')).toBe('');
    expect(makroWerte({ ...rechnung(), quittiert: { am: '2026-10-18', zahlungsweg: 'bar' } }).GiroCode).toBe('');
    expect(makroWerte({ ...rechnung(), firma: { ...BEISPIEL_FIRMA, iban: 'DE89370400440532013001' } }).GiroCode).toBe('');
    expect(makroWerte({ ...rechnung(), positionen: [] }).GiroCode).toBe('');
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
    expect(pakete(tex).sort()).toEqual(['babel', 'eso-pic', 'etoolbox', 'fontspec', 'geometry', 'graphicx', 'ulem', 'xcolor']);
    // ulem nur mit normalem: \emph bleibt kursiv
    expect(tex).toContain(String.raw`\usepackage[normalem]{ulem}`);
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

  it('GiroCode im Baustein „Zahlung“: nur mit \\GiroCode, Größe aus qrgroesse, ohne Bankkasten rechts', () => {
    const tex = (bausteine: Baustein[], art: 'rechnung' | 'angebot' = 'rechnung') => mainTex(art, bausteine, '#6366f1').tex;
    const std = tex(standardVorlage('rechnung'));
    expect(std).toContain(String.raw`\ifdefempty{\GiroCode}{%`);
    expect(std).toContain(String.raw`\includegraphics[width=28mm]{\GiroCode}`);
    // Bankverbindung + 6 mm Abstand + Code mit 2 × 2 mm Rand = volle Breite
    expect(std).toContain(String.raw`\begin{minipage}[c]{\dimexpr\linewidth-38mm\relax}`);
    expect(std).toContain(String.raw`\begin{minipage}[c]{32mm}\centering`);
    expect(std).toContain(String.raw`Mit der Banking-App\\scannen und bezahlen`);
    expect(std).not.toContain('girocode.png'); // Dateiname nur in daten.tex
    const gross = tex([{ typ: 'zahlung', qrgroesse: '34' }]);
    expect(gross).toContain(String.raw`\includegraphics[width=34mm]{\GiroCode}`);
    expect(gross).toContain(String.raw`\begin{minipage}[c]{38mm}\centering`);
    const boese = tex([{ typ: 'zahlung', qrgroesse: '28mm]{/etc/passwd}' }]);
    expect(boese).toContain(String.raw`\includegraphics[width=28mm]{\GiroCode}`);
    expect(boese).not.toContain('passwd');
    const ohneQr = tex([{ typ: 'zahlung', qr: false }]);
    expect(ohneQr).not.toContain(String.raw`\GiroCode`);
    expect(ohneQr).toContain('Bankverbindung');
    expect(tex([{ typ: 'zahlung' }], 'angebot')).not.toContain(String.raw`\GiroCode`);
    const ohneBank = tex([{ typ: 'zahlung', bank: false }]);
    expect(ohneBank).toContain(String.raw`\ifdefempty{\GiroCode}{}{\vspace{3mm}\noindent\hfill\begin{minipage}[c]{32mm}`);
    expect(ohneBank).not.toContain('Bankverbindung');
    for (const t of [std, gross, ohneQr, ohneBank]) {
      expect(klammernOk(t)).toBe(true);
      expect(t.slice(t.indexOf('\\begin{document}'))).not.toMatch(/\n\s*\n/);
    }
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

describe('Design „Formular“ und neue Bausteine', () => {
  const formular = () => mainTex('quittung', standardVorlage('quittung', 'formular'), '#6366f1').tex;

  it('Aufbau wie jede Vorlage: Klammern ausgeglichen, keine Leerzeilen, keine Daten, nur Standardpakete', () => {
    const tex = formular();
    expect(klammernOk(tex)).toBe(true);
    expect(tex.slice(tex.indexOf('\\begin{document}'))).not.toMatch(/\n\s*\n/);
    for (const x of ['Mustermann', 'Müller', 'Rasenmähen']) expect(tex).not.toContain(x);
    expect(tex).not.toMatch(/\\write18|\\directlua|\\immediate|\\openout|\\ShellEscape/);
  });

  it('Rahmen gestrichelt hinter dem Blatt, vor dem ersten Baustein; durchgezogen als vier Linien', () => {
    const tex = formular();
    expect(tex).toContain(String.raw`\AddToShipoutPictureBG{\AtPageLowerLeft{\color{marke}\multiput(`);
    expect(tex.indexOf('AddToShipoutPictureBG{\\AtPageLowerLeft{\\color{marke}')).toBeLessThan(tex.indexOf('\\begin{document}') + 400);
    expect(rahmenTex('a5q', 'gestrichelt').match(/\\multiput/g)).toHaveLength(4);
    const voll = rahmenTex('a4', 'durchgezogen');
    expect(voll.match(/\\put\(/g)).toHaveLength(4);
    expect(voll).not.toContain('multiput');
    // der Rahmen ist kein Baustein im Fluss: kein Abstand, kein Bereich mit Inhalt
    const m = mainTex('quittung', [{ typ: 'rahmen' }], '#6366f1');
    expect(m.tex).toContain('AddToShipoutPictureBG{\\AtPageLowerLeft');
  });

  it('Striche enden an beiden Ecken', () => {
    for (const l of [100, 180, 134.5, 3]) {
      const { n, schritt } = striche(l);
      expect(n).toBeGreaterThanOrEqual(2);
      expect((n - 1) * schritt + 2).toBeCloseTo(l, 6);
    }
    const r = RAHMEN_MM.a5q;
    expect(r.breite - r.links - r.rechts).toBe(190);
  });

  it('Firmenkopf: Name fett in Versalien, Zeilen nur mit Wert (\\ifdefempty), Trennlinie', () => {
    const tex = formular();
    expect(tex).toContain(String.raw`\bfseries \MakeUppercase{\Firma{}}\par}`);
    expect(tex).toContain(String.raw`\ifboolexpr{test {\ifdefempty{\FirmaInhaber}}}{}{%`);
    expect(tex).toContain(String.raw`\ifboolexpr{test {\ifdefempty{\Steuernummer}}}{}{%`);
    expect(tex).toContain(String.raw`\ifboolexpr{test {\ifdefempty{\FirmaStrasse}} and test {\ifdefempty{\FirmaPLZ}} and test {\ifdefempty{\FirmaStadt}}}{}{%`);
    expect(tex).toContain(String.raw`{\color{haar}\hrule height .25mm}`);
    // feste Texte im Firmenkopf escaped
    const eigen = mainTex('quittung', [{ typ: 'firmenblock', name: 'A & B 100%', untertitel: 'Fahrzeugpflege_{inhaber}', versal: false }], '#6366f1').tex;
    expect(eigen).toContain(String.raw`\bfseries A \& B 100\%\par}`);
    expect(eigen).toContain(String.raw`Fahrzeugpflege\_\FirmaInhaber{}\par`);
  });

  it('Titel in Versalien, Felder als „Label: Wert“, Zahlungsart zum Ankreuzen, eine Unterschriftslinie', () => {
    const tex = formular();
    expect(tex).toContain(String.raw`\MakeUppercase{\Belegart{}}`);
    expect(tex).toContain(String.raw`\KForm{Datum}{\Datum}`);
    expect(tex).toContain(String.raw`\KForm{Nr.}{\KNr}`);
    expect(tex).toContain(String.raw`\KForm{Erhalten von}{`);
    expect(tex).toContain(String.raw`\KForm{Für}{`);
    expect(tex).toContain(String.raw`\KAnkreuz{bar}{Bar}\hspace{5mm}\KAnkreuz{bank}{Überweisung}\hspace{5mm}\KAnkreuz{paypal}{PayPal}`);
    expect(tex).toContain('Gesamtbetrag:');
    expect(tex).not.toContain('Betrag in Worten');
    expect(tex).toContain(String.raw`\bfseries Unterschrift:\strut\par}`);
    expect(tex).not.toContain('Ort, Datum');
    // § 19-Hinweis sehr klein und grau
    expect(tex).toContain(String.raw`\fontsize{6.5}`);
    // Klassisch bleibt bei Kacheln und zwei Linien
    const klassisch = mainTex('quittung', standardVorlage('quittung'), '#6366f1').tex;
    expect(klassisch).not.toContain('\\KForm{');
    expect(klassisch).not.toContain('AddToShipoutPictureBG{\\AtPageLowerLeft{\\color{marke}\\multiput');
    expect(klassisch).toContain('Ort, Datum');
  });

  it('daten.tex: Firma „Müller & Söhne 100%“ escaped, Zahlungsweg als Schlüssel (quittiert vor gewählt)', () => {
    const firma = { ...BEISPIEL_FIRMA, name: 'Müller & Söhne 100%', inhaber: 'Max_Mustermann' };
    const q = { ...testbeleg('quittung', firma, 'klein', '2026-10-18'), zahlungsweg: 'bar' as const };
    const d = datenTex(q);
    expect(makro(d, 'Firma')).toBe(String.raw`Müller \& Söhne 100\%`);
    expect(makro(d, 'FirmaInhaber')).toBe(String.raw`Max\_Mustermann`);
    expect(makro(d, 'ZahlungswegKurz')).toBe('bar');
    expect(makro(datenTex({ ...q, zahlungsweg: 'bar', quittiert: { am: '2026-10-18', zahlungsweg: 'paypal' } }), 'ZahlungswegKurz')).toBe('paypal');
    expect(makro(datenTex({ ...q, zahlungsweg: null }), 'ZahlungswegKurz')).toBe('');
    // main.tex bleibt ohne Daten
    expect(mainTex('quittung', standardVorlage('quittung', 'formular'), '#6366f1').tex).not.toContain('Söhne');
  });

  it('Abstände: eine Unterschriftslinie 6 mm, zwei 10 mm', () => {
    expect(abstandMm('text', 'unterschrift', false, 'eine')).toBe(6);
    expect(abstandMm('text', 'unterschrift', false, 'zwei')).toBe(10);
  });
});

describe('Bilder für den Satz', () => {
  it('girocode.png genau dann, wenn main.tex den GiroCode einbindet', () => {
    const r = belegAssets(rechnung(), standardVorlage('rechnung'));
    expect(r.map((a) => a.name)).toEqual(['girocode.png']);
    expect(Array.from(r[0].daten.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(belegAssets(quittung(), standardVorlage('quittung'))).toEqual([]);
    expect(belegAssets(rechnung(), [{ typ: 'zahlung', qr: false }])).toEqual([]);
    expect(belegAssets(rechnung(), [{ typ: 'zahlung', aus: true }])).toEqual([]);
    expect(belegAssets({ ...rechnung(), firma: { ...BEISPIEL_FIRMA, iban: '' } }, standardVorlage('rechnung'))).toEqual([]);
    expect(belegAssets({ ...rechnung(), quittiert: { am: '2026-10-18', zahlungsweg: 'bank' } }, standardVorlage('rechnung'))).toEqual([]);
  });

  it('belegTex liefert die Bilder mit', () => {
    const t = belegTex(rechnung(), standardVorlage('rechnung'), '#6366f1');
    expect(t.assets.map((a) => a.name)).toEqual(['girocode.png']);
    expect(makro(t.daten, 'GiroCode')).toBe('girocode.png');
    expect(t.main.tex).toContain(String.raw`{\GiroCode}`);
    expect(belegTex(quittung(), standardVorlage('quittung'), '#6366f1').assets).toEqual([]);
  });

  it('Firmenlogo: LogoDatei = logo.png und die Bytes nur mit Logo, Bytes und sichtbarem Kopf mit Logo', () => {
    const logo = `logo-${'ab'.repeat(32)}.png`;
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const mit = { ...rechnung(), logo };
    expect(makroWerte(mit).LogoDatei).toBe('logo.png');
    const t = belegTex(mit, standardVorlage('rechnung'), '#6366f1', bytes);
    expect(makro(t.daten, 'LogoDatei')).toBe('logo.png');
    expect(t.assets.map((a) => a.name)).toEqual(['girocode.png', 'logo.png']);
    expect(t.assets[1].daten).toBe(bytes);
    expect(t.main.tex).toContain(String.raw`\ifdefempty{\LogoDatei}{}{\includegraphics[height=16mm,width=60mm,keepaspectratio]{\LogoDatei}}`);
    // Bytes fehlen (Datei nicht lesbar, Browser): kein \LogoDatei, also nie eine fehlende Datei im Satz
    const ohneBytes = belegTex(mit, standardVorlage('rechnung'), '#6366f1');
    expect(makro(ohneBytes.daten, 'LogoDatei')).toBe('');
    expect(ohneBytes.assets.map((a) => a.name)).toEqual(['girocode.png']);
    // kein Logo am Beleg: Bytes werden nicht mitgeschickt
    expect(belegTex(rechnung(), standardVorlage('rechnung'), '#6366f1', bytes).assets.map((a) => a.name)).toEqual(['girocode.png']);
    // Kopf ohne Logo, ausgeblendet oder gar nicht in der Vorlage (Standard-Quittung)
    expect(belegAssets(mit, [{ typ: 'kopf', logo: false }], bytes)).toEqual([]);
    expect(belegAssets(mit, [{ typ: 'kopf', aus: true }], bytes)).toEqual([]);
    expect(belegAssets({ ...quittung(), logo }, standardVorlage('quittung'), bytes)).toEqual([]);
    expect(belegAssets({ ...quittung(), logo }, [{ typ: 'kopf' }, ...standardVorlage('quittung')], bytes).map((a) => a.name)).toEqual(['logo.png']);
    // A5 quer: 10 mm hoch
    expect(belegTex({ ...quittung(), logo }, [{ typ: 'kopf' }], '#6366f1', bytes).main.tex).toContain('height=10mm,width=60mm');
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

describe('Formatierung im PDF (<b>, <i>, <u>)', () => {
  it('fett, kursiv, unterstrichen ⇒ \\textbf, \\textit, \\uline (innen)', () => {
    expect(textTex('a <b>fett</b> <i>kursiv</i> <u>unter</u>', true).tex).toBe(String.raw`a \textbf{fett} \textit{kursiv} \uline{unter}`);
    expect(textTex('<b><i><u>alles</u></i></b>', true).tex).toBe(String.raw`\textbf{\textit{\uline{alles}}}`);
    expect(textTex('<u>x<b>y</b></u>', true).tex).toBe(String.raw`\uline{x}\textbf{\uline{y}}`);
    expect(formatTex('', { ...OHNE_STIL, fett: true })).toBe('');
  });

  it('Sonderzeichen im formatierten Text werden escaped, Platzhalter bleiben Makros', () => {
    expect(textTex('<b>50 % & {kunde}</b>', true).tex).toBe(String.raw`\textbf{50 \% \& }\textbf{\KundeAnzeige{}}`);
    expect(textTex('<u>Dünger "Bio" #5 -- {x}</u>', true).tex).toBe(String.raw`\uline{Dünger \textquotedbl{}Bio\textquotedbl{} \#5 -{}- \{x\}}`);
    // unausgeglichene Tags sind Text
    expect(textTex('a <b> b', true).tex).toBe('a <b> b');
  });

  it('Werte mit <b> oder & sind nie Markup (stehen in daten.tex, escaped)', () => {
    const doc = { ...rechnung(), kunde: { ...rechnung().kunde!, name: '<b>Müller</b> & Co' } };
    const vorlage = standardVorlage('rechnung').map((b) => (b.typ === 'text' ? { ...b, text: 'Hallo <i>{kunde}</i>' } : b));
    const { main, daten } = belegTex(doc, vorlage, '#6366f1');
    expect(makro(daten, 'KundeName')).toBe(String.raw`<b>Müller</b> \& Co`);
    expect(main.tex).toContain(String.raw`Hallo \textit{\KundeAnzeige{}}`);
    expect(main.tex).not.toContain('Müller');
    expect(klammernOk(main.tex)).toBe(true);
  });

  it('Umbrüche: \\par steht außerhalb der Formatierung', () => {
    expect(textTex('<b>Zeile 1\nZeile 2</b>').tex).toBe(String.raw`\textbf{Zeile 1}\par \textbf{Zeile 2}`);
    expect(textTex('<u>a\n\nb</u>').tex).toBe(String.raw`\uline{a}\par \vspace{\baselineskip}\uline{b}`);
  });

  it('leer-Prüfung zählt Tags nicht als Text', () => {
    expect(textTex('<b>{schlusstext}</b>').leer).toEqual(['Schlusstext']);
    expect(textTex('<b></b>').leer).toEqual([]);
  });

  it('Firmenkopf: Formatierung über mehrere Zeilen wird je Zeile geschlossen, leere Zeilen fallen weiter weg', () => {
    const v = standardVorlage('quittung', 'formular').map((b) => (b.typ === 'firmenblock' ? { ...b, zeilen: '<b>{strasse}\nTel. {telefon}</b>' } : b));
    const { tex } = mainTex('quittung', v, '#6366f1');
    expect(tex).toContain(String.raw`\textbf{\FirmaStrasse{}}\par`);
    expect(tex).toContain(String.raw`\ifboolexpr{test {\ifdefempty{\FirmaTelefon}}}{}{%` + '\n' + String.raw`\textbf{Tel. }\textbf{\FirmaTelefon{}}\par`);
    expect(klammernOk(tex)).toBe(true);
  });

  it('alle Text-Einstellungen formatiert: main.tex bleibt ausgeglichen', () => {
    for (const art of BELEGARTEN) {
      const v = standardVorlage(art).map((b) => {
        const neu: Baustein = { ...b };
        for (const [k, w] of Object.entries(b)) if (typeof w === 'string' && k !== 'typ' && w.includes('{')) neu[k] = `<b><i><u>${w}</u></i></b>`;
        return neu;
      });
      expect(klammernOk(mainTex(art, v, '#6366f1').tex), art).toBe(true);
    }
  });
});
