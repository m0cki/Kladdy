/* main.tex aus den Bausteinen erzeugen (ANLEITUNG §7.0, §7.1; Aussehen wie §7.5/§7.6 und die HTML-Vorschau).
 *
 * - Präambel nach Format: A4 hochkant (Rechnung, Angebot) bzw. A5 quer (Quittung, Eigenbeleg), Ränder wie das
 *   Papierblatt der Vorschau (blatt.css). Nur Pakete aus TeX Live, die Tectonic selbst lädt: geometry, fontspec, babel,
 *   xcolor, graphicx, etoolbox, eso-pic. Schrift: Helvetica Neue (macOS), sonst TeX Gyre Heros aus TeX Live.
 * - main.tex enthält keine Daten des Belegs, nur Makros aus daten.tex (daten.ts). Texte aus den Baustein-Einstellungen
 *   (später in der Vorlagen-Seite editierbar) werden escaped, Platzhalter werden zu Makros ({kunde} ⇒ \KundeAnzeige{}).
 *   Kein roher LaTeX-Code vom Nutzer, nirgends.
 * - Was in der Vorschau leer bleibt (z. B. Betreff ohne Text), lässt auch das PDF weg: Bausteine, deren Text nur aus
 *   Platzhaltern besteht, stehen in \ifboolexpr{test {\ifdefempty{…}} and …}{}{…}.
 * - Abstände zwischen Bausteinen bilden die CSS-Regeln aus blatt.css nach (`abstandMm`).
 * - Der Rahmen (Baustein „rahmen“) liegt wie das Wasserzeichen hinter der Seite (eso-pic, Bildumgebung des Kernels),
 *   4 mm außerhalb des Satzspiegels (`RAHMEN_MM`, gleiche Werte wie .sh-rahmen in blatt.css).
 * - `bereiche` ordnet jede Zeile von main.tex ihrem Baustein zu, damit ein Kompilierfehler den Baustein nennen kann (§7.3).
 * Tests: latex.test.ts */
import { BAUSTEINE, istUmrandet, istUnten, sichtbare, type Aufgeloest, type Baustein, type BausteinTyp } from '../vorlagen/bausteine';
import { ARTEN, formatVon, zerlegen, type Belegart, type Blattformat, type PlatzhalterName } from '../vorlagen/dokument';
import { firmenZeilen } from '../vorlagen/firmenblock';
import { belegAkzent } from '../vorlagen/farbe';
import { qrGroesseMm } from '../girocode/girocode';
import { escapeStueck } from './escape';

const L = String.raw;

/** Platzhalter ⇒ Makro aus daten.tex. {nr} ⇒ \KNr (Nummer oder graues „Entwurf“). */
const MAKRO: Readonly<Record<PlatzhalterName, string>> = {
  kunde: 'KundeAnzeige',
  nr: 'KNr',
  art: 'Belegart',
  datum: 'Datum',
  leistungsdatum: 'Leistungsdatum',
  faellig: 'Faellig',
  summe: 'Gesamt',
  betrag_worte: 'BetragInWorten',
  betreff: 'Betreff',
  einleitung: 'Einleitung',
  schlusstext: 'Schlusstext',
  zahlungsziel: 'Zahlungsziel',
  firma: 'Firma',
  inhaber: 'FirmaInhaber',
  strasse: 'FirmaStrasse',
  plz: 'FirmaPLZ',
  ort: 'FirmaStadt',
  steuernummer: 'Steuernummer',
  telefon: 'FirmaTelefon',
  email: 'FirmaEmail',
  web: 'FirmaWeb',
  bank: 'Bank',
  iban: 'IBAN',
  bic: 'BIC',
};

/** Schriftgröße in pt mit Zeilenhöhe wie in der Vorschau (Standard 1,42). */
const zahl = (n: number) => String(Math.round(n * 100) / 100);
export const fs = (pt: number, zeile = 1.42): string => L`\fontsize{${zahl(pt)}}{${zahl(pt * zeile)}}\selectfont `;

/** Text aus einer Baustein-Einstellung ⇒ LaTeX. `leer`: Makros, die alle leer sein müssen, damit nichts gedruckt wird
 * (null = es steht immer etwas da, [] = der Text ist fest leer). */
export interface TexText {
  tex: string;
  leer: string[] | null;
}

export function textTex(text: string, einzeilig = false): TexText {
  const teile = zerlegen(text);
  let tex = '';
  let immer = false;
  const makros: string[] = [];
  for (const t of teile) {
    if (t.art === 'platzhalter') {
      tex += `\\${MAKRO[t.name]}{}`;
      if (t.name === 'nr') immer = true;
      else if (!makros.includes(MAKRO[t.name])) makros.push(MAKRO[t.name]);
      continue;
    }
    if (t.text.trim()) immer = true;
    if (einzeilig) {
      tex += escapeStueck(t.text);
      continue;
    }
    // Zeilenumbruch ⇒ neuer Absatz (parskip 0 = neue Zeile); eine Leerzeile ⇒ eine Zeile Abstand.
    // \par statt \\: ein leerer Platzhalter am Zeilenanfang oder -ende hinterlässt so keine leere Zeile.
    tex += t.text
      .replace(/\r\n?/g, '\n')
      .split(/(\n+)/)
      .map((s) => (s.startsWith('\n') ? L`\par ` + L`\vspace{\baselineskip}`.repeat(s.length - 1) : escapeStueck(s)))
      .join('');
  }
  return { tex, leer: immer ? null : makros };
}

/** Nur drucken, wenn nicht alle Makros leer sind. */
export function wennNichtLeer(leer: string[] | null, inhalt: string): string {
  if (!leer) return inhalt;
  if (!leer.length) return '';
  const test = leer.map((m) => 'test {\\ifdefempty{\\' + m + '}}').join(' and ');
  return L`\ifboolexpr{${test}}{}{%` + `\n${inhalt}%\n}`;
}

const zeilen = (...z: (string | false | null | undefined)[]): string => z.filter((x): x is string => !!x).join('\n');

/* ---------- Abstände wie blatt.css ---------- */

/**
 * Abstand vor einem Baustein in mm (Nachbau der CSS-Regeln `.blk + .blk` usw., spätere Regeln gewinnen).
 * `vorher` = vorheriger gedruckter Baustein (null = erster), `unten` = im unteren Bereich (Fußzeile).
 */
export function abstandMm(vorher: BausteinTyp | null, typ: BausteinTyp, unten = false, stil = ''): number {
  if (!unten && typ === 'unterschrift') return stil === 'eine' ? 6 : 10;
  if (!vorher) return typ === 'positionen' && !unten ? 6 : 0;
  if (vorher === 'quittung_felder' || vorher === 'eigenbeleg_felder') return 0;
  if (vorher === 'titel' && (typ === 'quittung_felder' || typ === 'eigenbeleg_felder')) return 3.5;
  if (vorher === 'summe') return 5;
  if (vorher === 'positionen' && typ === 'summe') return 0;
  if (vorher === 'betreff' && typ === 'text') return 4.5;
  if (vorher === 'titel' && typ === 'betreff') return 1.5;
  if (vorher === 'absenderzeile' && typ === 'anschrift_meta') return 2.5;
  if (vorher === 'abstand') return 0;
  return 3.5;
}

/* ---------- Bausteine ---------- */

interface Ctx {
  art: Belegart;
  a4: boolean;
  vorher: BausteinTyp | null;
}

type Schnipsel = TexText;
const fest = (tex: string): Schnipsel => ({ tex, leer: null });

const GROESSE_PT: Readonly<Record<string, number>> = { normal: 10, klein: 8.5, grau: 8, mini: 6.5 };
function textBlock(text: string, groesse: string): Schnipsel {
  const t = textTex(text);
  const grau = groesse === 'grau' || groesse === 'mini' ? L`\color{grau}` : '';
  return { tex: `{${fs(GROESSE_PT[groesse] ?? 10)}${grau}${t.tex}\\par}`, leer: t.leer };
}

/** Großbuchstaben wie `text-transform: uppercase` in der Vorschau (Makros werden dabei aufgelöst). */
const versal = (tex: string, an: boolean): string => (an ? L`\MakeUppercase{${tex}}` : tex);

/** Firmenkopf: eine Zeile pro Textzeile; eine Zeile, deren Platzhalter alle leer sind, fällt weg (firmenblock.ts). */
function firmenZeilenTex(text: string): string {
  return firmenZeilen(text)
    .map((z) => {
      const tex = textTex(z.text, true).tex + L`\par`;
      return z.platzhalter.length ? wennNichtLeer(z.platzhalter.map((p) => MAKRO[p]), tex) : tex;
    })
    .join('\n');
}

/** Feld-Raster der Quittung/des Eigenbelegs: drei Spalten 1,35 : 1 : 1 bzw. zwei gleiche, 8 mm Abstand. */
function raster(felder: string[]): string {
  const breiten =
    felder.length === 3
      ? [L`\dimexpr(\linewidth-16mm)*135/335\relax`, L`\dimexpr(\linewidth-16mm)*100/335\relax`, L`\dimexpr(\linewidth-16mm)*100/335\relax`]
      : felder.map(() => L`\dimexpr(\linewidth-8mm)/2\relax`);
  return (
    L`\noindent` +
    felder.map((f, i) => L`\begin{minipage}[t]{${breiten[i]}}` + f + L`\end{minipage}`).join(L`\hspace{8mm}%` + '\n') +
    L`\par`
  );
}

const BLOCK: Readonly<Record<BausteinTyp, (b: Aufgeloest, x: Ctx) => Schnipsel>> = {
  kopf(b, x) {
    const h = x.a4 ? 16 : 10;
    const claim = textTex(b.text('claim'), true);
    return fest(
      zeilen(
        L`\noindent\rule[-${h}mm]{0pt}{${h}mm}%`,
        L`\begin{minipage}[t]{\dimexpr\linewidth-68mm\relax}\vspace{0pt}\raggedright`,
        L`{${fs(15, 1.15)}\bfseries\color{akzent}\Firma\par}`,
        wennNichtLeer(claim.leer, L`\vspace{1mm}{${fs(8.5)}\color{grau}${claim.tex}\par}`),
        L`\end{minipage}\hfill`,
        L`\begin{minipage}[t]{60mm}\vspace{0pt}\raggedleft`,
        b.an('logo') && L`\ifdefempty{\LogoDatei}{}{\includegraphics[height=${h}mm,width=60mm,keepaspectratio]{\LogoDatei}}`,
        L`\end{minipage}\par`,
      ),
    );
  },
  firmenblock(b, x) {
    const name = textTex(b.text('name'), true);
    const untertitel = firmenZeilenTex(b.text('untertitel'));
    const kontakt = firmenZeilenTex(b.text('zeilen'));
    const logo = b.an('logo');
    const h = x.a4 ? 16 : 12;
    const inhalt = zeilen(
      wennNichtLeer(name.leer, L`{${fs(17, 1.15)}\bfseries ${versal(name.tex, b.an('versal'))}\par}`),
      untertitel && L`\vspace{1mm}{${fs(9, 1.4)}` + untertitel + '}',
      kontakt && L`\vspace{.6mm}{${fs(8.5, 1.4)}` + kontakt + '}',
    );
    return fest(
      zeilen(
        logo
          ? zeilen(
              L`\noindent\begin{minipage}[t]{\dimexpr\linewidth-68mm\relax}\vspace{0pt}\raggedright`,
              inhalt,
              L`\end{minipage}\hfill`,
              L`\begin{minipage}[t]{60mm}\vspace{0pt}\raggedleft`,
              L`\ifdefempty{\LogoDatei}{}{\includegraphics[height=${String(h)}mm,width=60mm,keepaspectratio]{\LogoDatei}}`,
              L`\end{minipage}\par`,
            )
          : L`{\raggedright ` + inhalt + '\n}',
        b.an('linie') && L`\vspace{2.5mm}{\color{haar}\hrule height .25mm}`,
      ),
    );
  },
  absenderzeile(b) {
    const t = textTex(b.text('text'), true);
    if (!b.an('linie')) return { tex: L`{${fs(7.5)}\color{grau}${t.tex}\par}`, leer: t.leer };
    // Unterstrichen wie im Fensterumschlag; zu lang ⇒ auf 85 mm verkleinert (Vorschau: abgeschnitten mit …)
    return {
      tex: zeilen(
        L`\sbox{\KBox}{${fs(7)}\color{grau}${t.tex}}%`,
        L`\ifdim\wd\KBox>85mm \sbox{\KBox}{\resizebox{85mm}{!}{\usebox{\KBox}}}\fi`,
        L`\noindent\vtop{\hbox{\usebox{\KBox}}\kern.8mm\hbox{\textcolor{haar}{\rule{\wd\KBox}{.2mm}}}}\par`,
      ),
      leer: t.leer,
    };
  },
  anschrift_meta(b, x) {
    const A = ARTEN[x.art];
    const leerTest = ['KundeAnzeige', 'KundeZusatz', 'KundeStrasse', 'KundeOrt'].map((m) => 'test {\\ifdefempty{\\' + m + '}}').join(' and ');
    const meta = [
      b.an('nr') && L`\KMeta{${A.nrLabel}}{\ifdefempty{\Nummer}{\textcolor{leer}{\itshape Entwurf}}{\textbf{\Nummer}}}`,
      b.an('datum') && L`\KMeta{Datum}{\Datum}`,
      b.an('leistung') && x.art !== 'angebot' && L`\ifdefempty{\Leistungsdatum}{}{\KMeta{\LeistungsdatumLabel}{\Leistungsdatum}}`,
      b.an('kundennr') && L`\ifdefempty{\Kundennummer}{}{\KMeta{Kunden-Nr.}{\Kundennummer}}`,
      b.an('faellig') && L`\ifdefempty{\Faellig}{}{\KMeta{${x.art === 'angebot' ? 'Gültig bis' : 'Fällig am'}}{\Faellig}}`,
    ];
    return fest(
      zeilen(
        x.a4 ? L`\noindent\rule[-34mm]{0pt}{34mm}%` : L`\noindent`,
        L`\begin{minipage}[t]{85mm}\vspace{0pt}\raggedright`,
        L`\ifboolexpr{${leerTest}}{\textcolor{leer}{\itshape Empfänger}\par}{\KZeile{\KundeAnzeige}\KZeile{\KundeZusatz}\KZeile{\KundeStrasse}\KZeile{\KundeOrt}}`,
        L`\end{minipage}\hfill`,
        L`\begin{minipage}[t]{64mm}\vspace{0pt}${fs(9)}`,
        ...meta,
        L`\end{minipage}\par`,
      ),
    );
  },
  titel(b, x) {
    const t = textTex(b.text('text'), true);
    const r = textTex(b.text('rechts'), true);
    const farbe = b.text('stil') === 'akzent' ? L`\color{akzent}` : '';
    const rechts = r.leer && !r.leer.length ? '' : wennNichtLeer(r.leer, L`\hfill{${fs(10.5)}\bfseries ${r.tex}}`);
    return fest(
      zeilen(
        L`\noindent{${fs(x.a4 ? 17 : 18, 1.2)}\bfseries${farbe} ${versal(t.tex, b.an('versal'))}}${rechts}\par`,
        b.an('linie') && L`\vspace{1.8mm}{\color{akzent}\hrule height .45mm}`,
      ),
    );
  },
  betreff(b) {
    const t = textTex(b.text('text'));
    return { tex: L`{\bfseries ${t.tex}\par}`, leer: t.leer };
  },
  text: (b) => textBlock(b.text('text'), b.text('groesse')),
  datenschutz: (b) => textBlock(b.text('text'), 'grau'),
  steuerhinweis: (b) => textBlock(b.text('text'), b.text('groesse')),
  gruss: (b) => textBlock(b.text('text'), 'normal'),
  positionen(b) {
    const pos = b.an('pos');
    const einheit = b.an('einheit');
    const ep = b.an('einzelpreis');
    const abzug = (pos ? 11 : 0) + 21 + (ep ? 25 : 0) + 25;
    const zelle = (inhalt: string[]) =>
      (pos ? L`\makebox[8mm][r]{${inhalt[0]}}\hspace{3mm}` : '') +
      L`${inhalt[1]}\hspace{3mm}\makebox[18mm][r]{${inhalt[2]}}` +
      (ep ? L`\hspace{3mm}\makebox[22mm][r]{${inhalt[3]}}` : '') +
      L`\hspace{3mm}\makebox[22mm][r]{${inhalt[4]}}`;
    return fest(
      zeilen(
        L`\setlength{\KPosB}{\dimexpr\linewidth-${abzug}mm\relax}%`,
        L`\renewcommand{\Position}[6]{%`,
        L`  \ifnum\value{KPos}>0\relax{\color{haar}\hrule height .15mm}\fi\stepcounter{KPos}%`,
        L`  \vspace{1.9mm}\noindent ` +
          zelle([L`\textcolor{grau}{#1}`, L`\parbox[t]{\KPosB}{\raggedright\strut #2\strut}`, einheit ? L`#3\ifblank{#4}{}{~#4}` : '#3', '#5', '#6']) +
          L`\par\vspace{1.9mm}}%`,
        L`{${fs(9.5)}%`,
        L`{\color{ink}\hrule height .5mm}\vspace{1.6mm}%`,
        L`{${fs(8)}\color{grau}\noindent\strut ` + zelle(['Pos.', L`\makebox[\KPosB][l]{Beschreibung}`, 'Menge', 'Einzelpreis', 'Gesamt']) + L`\par}%`,
        L`\vspace{1.6mm}{\color{ink}\hrule height .25mm}%`,
        L`\setcounter{KPos}{0}%`,
        L`\ifnum\AnzahlPositionen=0\relax\vspace{1.9mm}\noindent\textcolor{leer}{\itshape Noch keine Positionen}\par\vspace{1.9mm}\else\Positionen\fi`,
        L`{\color{ink}\hrule height .25mm}\par}`,
      ),
    );
  },
  summe(b, x) {
    const t = textTex(b.text('label'), true);
    return fest(
      zeilen(
        x.vorher !== 'positionen' && L`{\color{ink}\hrule height .25mm}`,
        L`\vspace{2.2mm}\noindent\strut{\bfseries ${t.tex}}\hfill{${fs(11)}\bfseries\color{akzent}\Gesamt}\par`,
        L`\vspace{2.2mm}{\color{ink}\hrule height .5mm}`,
      ),
    );
  },
  betrag_worte(b) {
    const t = textTex(b.text('label'), true);
    const label = t.leer && !t.leer.length ? '' : wennNichtLeer(t.leer, L`\textcolor{grau}{${t.tex}:} `);
    return fest(L`{${fs(9.5)}\itshape ${label}\BetragInWorten\par}`);
  },
  zahlung(b, x) {
    const t = textTex(b.text('text'));
    const hinweis = wennNichtLeer(t.leer, L`{${t.tex}\par}`);
    // Grauer Kasten wie .blk-pay.box: links die Bankverbindung, rechts (falls da) der GiroCode, senkrecht mittig
    const kasten = (inhalt: string) =>
      zeilen(
        L`\vspace{3mm}\noindent{\setlength{\fboxsep}{3.5mm}\colorbox{box}{\begin{minipage}{\dimexpr\linewidth-2\fboxsep\relax}%`,
        inhalt,
        L`\end{minipage}}}\par`,
      );
    const bank = (breite: string) =>
      zeilen(
        L`\begin{minipage}[c]{${breite}}${fs(8.5)}\renewcommand{\arraystretch}{1.12}%`,
        L`{${fs(9)}\bfseries Bankverbindung\par}\vspace{1.2mm}%`,
        L`\begin{tabular}{@{}l@{\hspace{5mm}}l@{}}`,
        L`\textcolor{grau}{Empfänger} & \Firma\\`,
        L`\textcolor{grau}{IBAN} & \IBAN\\`,
        L`\textcolor{grau}{BIC} & \BIC\ifdefempty{\Bank}{}{ · \Bank}\\`,
        L`\textcolor{grau}{Betrag} & \textbf{\Gesamt}\\`,
        L`\textcolor{grau}{Verwendungszweck} & \ifdefempty{\Nummer}{\textcolor{leer}{\itshape Rechnungsnummer}}{\Nummer}\\`,
        L`\end{tabular}\end{minipage}%`,
      );
    // GiroCode wie .blk-qr: Code (girocode.png) mit 2 mm weißem Rand, darunter die Bildunterschrift. Nur auf Rechnungen
    // und nur, wenn \GiroCode gesetzt ist (gültige Daten) – Fehler stehen im Formular, nie auf dem Blatt.
    const mm = qrGroesseMm(b.text('qrgroesse'));
    const qr =
      L`\begin{minipage}[c]{${zahl(mm + 4)}mm}\centering{\setlength{\fboxsep}{2mm}\colorbox{white}{\includegraphics[width=${zahl(mm)}mm]{\GiroCode}}}\par` +
      L`\vspace{1.2mm}{${fs(6.5, 1.3)}\color{grau}Mit der Banking-App\\scannen und bezahlen\par}\end{minipage}%`;
    const mitQr = b.an('qr') && x.art === 'rechnung';
    let zahlung: string | false = false;
    if (b.an('bank')) {
      const nurBank = kasten(bank(L`\linewidth`));
      const mitCode = kasten(zeilen(bank(L`\dimexpr\linewidth-${zahl(mm + 10)}mm\relax`), L`\hspace{6mm}%`, qr));
      zahlung = mitQr ? zeilen(L`\ifdefempty{\GiroCode}{%`, nurBank + '%', '}{%', mitCode + '%', '}') : nurBank;
    } else if (mitQr) {
      // ohne Bankverbindung kein Kasten, der Code steht rechts (Vorschau: .blk-pay-sp schiebt ihn nach rechts)
      zahlung = zeilen(L`\ifdefempty{\GiroCode}{}{\vspace{3mm}\noindent\hfill` + qr, L`\par}`);
    }
    // Schon bei Ausstellung bezahlt: kein Zahlungsaufruf, keine Bankverbindung, kein GiroCode (Prototyp `quittiert`)
    return fest(L`\ifdefempty{\Quittiert}{%` + '\n' + zeilen(hinweis, zahlung) + L`%` + '\n' + L`}{{\Quittiert\par}}`);
  },
  quittung_felder(b) {
    const von = textTex(b.text('von'), true).tex;
    const fuer = textTex(b.text('fuer'), true).tex;
    const fuerWert = L`\ifnum\AnzahlPositionen>1\relax\ifdefempty{\Betreff}{}{\Betreff\par}{${fs(9)}\let\Position\KPositionMini\vspace{1mm}\Positionen}\else\QuittungFuer\fi`;
    if (b.text('stil') === 'formular') {
      // „Bezeichnung: Wert“ wie ein Quittungsblock; Zahlungsart als Ankreuzfelder, die gedruckte mit Kreuz
      const halb = L`\dimexpr(\linewidth-8mm)/2\relax`;
      const kreuze = L`\KAnkreuz{bar}{Bar}\hspace{5mm}\KAnkreuz{bank}{Überweisung}\hspace{5mm}\KAnkreuz{paypal}{PayPal}`;
      return fest(
        zeilen(
          L`\noindent\begin{minipage}[t]{${halb}}\KForm{Datum}{\Datum}\end{minipage}\hfill\begin{minipage}[t]{${halb}}\KForm{Nr.}{\KNr}\end{minipage}\par`,
          L`{\color{haar}\hrule height .25mm}\vspace{3mm}`,
          L`\KForm{${von}}{\KundeAnzeige\ifdefempty{\KundeAdresseEinzeilig}{}{, \KundeAdresseEinzeilig}}`,
          L`\KForm{${fuer}}{${fuerWert}}`,
          b.an('zahlungsart') && L`\KForm{Zahlungsart}{${kreuze}}`,
          L`\vspace{1mm}{${fs(13, 1.3)}\noindent\textbf{Gesamtbetrag:}\ \textbf{\Gesamt}\par}\vspace{1mm}`,
          b.an('worte') && L`{${fs(9)}\noindent\textcolor{grau}{in Worten:} \BetragInWorten\par}\vspace{1mm}`,
        ),
      );
    }
    const felder = [L`\KFeld{Betrag}{{${fs(15, 1.3)}\bfseries\Gesamt}}`, L`\KFeld{Datum}{\Datum}`];
    if (b.an('zahlungsart')) felder.push(L`\KFeld{Zahlungsart}{\Zahlungsart}`);
    return fest(
      zeilen(
        raster(felder),
        b.an('worte') && L`\KFeld{Betrag in Worten}{\BetragInWorten}`,
        L`\KFeld{${von}}{\KundeAnzeige\ifdefempty{\KundeAdresseEinzeilig}{}{, \KundeAdresseEinzeilig}}`,
        L`\KFeld{${fuer}}{${fuerWert}}`,
      ),
    );
  },
  eigenbeleg_felder(b) {
    const u = textTex(b.text('untertitel'), true);
    return fest(
      zeilen(
        wennNichtLeer(u.leer, L`\vspace{-1mm}{${fs(8)}\color{grau}${u.tex}\par}\vspace{3mm}`),
        raster([L`\KFeld{Betrag}{{${fs(15, 1.3)}\bfseries\Gesamt}}`, L`\KFeld{Datum der Zahlung}{\Datum}`, L`\KFeld{Zahlungsart}{\Zahlungsart}`]),
        b.an('worte') && L`\KFeld{Betrag in Worten}{\BetragInWorten}`,
        raster([
          L`\KFeld{Zahlungsempfänger}{\ifdefempty{\KundeName}{\textcolor{leer}{\itshape fehlt}}{\KundeName\ifdefempty{\KundeAdresseEinzeilig}{}{\par\vspace{.4mm}{${fs(8.5)}\KundeAdresseEinzeilig\par}}}}`,
          L`\KFeld{Grund für den Eigenbeleg}{\EigenbelegGrund}`,
        ]),
        L`\KFeld{Gegenstand / Zweck der Ausgabe}{\ifdefempty{\Betreff}{\textcolor{leer}{\itshape fehlt}}{\Betreff}}`,
        L`\ifdefempty{\GebuchtAls}{}{{${fs(8)}\color{grau}Gebucht als \GebuchtAls\par}}`,
      ),
    );
  },
  unterschrift(b) {
    const links = textTex(b.text('links'), true).tex;
    const rechts = textTex(b.text('rechts'), true).tex;
    // eine Linie über die ganze Breite, die Beschriftung darüber (Quittungsblock)
    if (b.text('stil') === 'eine') return fest(L`{${fs(9)}\bfseries ${rechts}\strut\par}\vspace{11mm}{\color{ink}\hrule height .25mm}`);
    const vor = b.an('vorbelegen') ? L`\ifdefempty{\FirmaStadt}{}{\FirmaStadt, }\UnterschriftDatum` : '';
    const spalte = (oben: string, unten: string) =>
      L`\begin{minipage}[b]{\dimexpr(\linewidth-14mm)/2\relax}{${fs(9.5)}\hspace*{1mm}${oben}\strut\par}` +
      L`\vspace{1mm}{\color{ink}\hrule height .25mm}\vspace{1mm}{${fs(7.5)}\color{grau}${unten}\strut\par}\end{minipage}`;
    // \hfill statt \hspace{14mm}: zwei gerundete Halbe sind sonst 1sp zu breit, und TeX bricht die zweite Spalte um
    return fest(L`\vspace{2mm}\noindent` + spalte(vor, links) + L`\hfill%` + '\n' + spalte('', rechts) + L`\par`);
  },
  trennlinie(b) {
    const art = b.text('farbe');
    const [farbe, mm] = art === 'akzent' ? ['akzent', '.45'] : art === 'schwarz' ? ['ink', '.3'] : ['haar', '.2'];
    return fest(L`{\color{${farbe}}\hrule height ${mm}mm}`);
  },
  abstand(b) {
    const mm = { klein: 4, mittel: 8, gross: 14 }[b.text('groesse')] ?? 8;
    return fest(L`\vspace{${String(mm)}mm}`);
  },
  // der Rahmen wird nicht im Fluss gesetzt, sondern in mainTex hinter die Seite gelegt (rahmenTex)
  rahmen: () => ({ tex: '', leer: [] }),
  fusszeile(b) {
    const spalten = [
      b.an('adresse') && L`\textcolor{ink}{\bfseries\Firma}\par\KZeile{\FirmaInhaber}\KZeile{\FirmaStrasse}\KZeile{\FirmaOrt}`,
      b.an('kontakt') && L`\KZeileVor{Tel. }{\FirmaTelefon}\KZeile{\FirmaEmail}\KZeile{\FirmaWeb}\KZeileVor{Steuernr. }{\Steuernummer}`,
      b.an('bank') && L`\KZeile{\Bank}\KZeileVor{IBAN }{\IBAN}\KZeileVor{BIC }{\BIC}`,
    ].filter((s): s is string => !!s);
    if (!spalten.length) return { tex: '', leer: [] };
    const n = spalten.length;
    const breite = L`\dimexpr(\linewidth-${String((n - 1) * 6)}mm)/${String(n)}\relax`;
    return fest(
      zeilen(
        L`{${fs(7, 1.45)}\color{grau}{\color{haar}\hrule height .2mm}\vspace{2.4mm}\noindent`,
        spalten.map((s) => L`\begin{minipage}[t]{${breite}}\raggedright ${s}\end{minipage}`).join(L`\hspace{6mm}%` + '\n'),
        L`\par}`,
      ),
    );
  },
};

/* ---------- Rahmen ---------- */

/** Abstand des Rahmens vom Papierrand in mm: 4 mm außerhalb des Satzspiegels (Ränder aus der Präambel bzw. .sheet). */
export const RAHMEN_MM: Readonly<Record<Blattformat, { oben: number; rechts: number; unten: number; links: number; breite: number; hoehe: number }>> = {
  a4: { oben: 14, rechts: 16, unten: 8, links: 18, breite: 210, hoehe: 297 },
  a5q: { oben: 7, rechts: 10, unten: 6, links: 10, breite: 210, hoehe: 148 },
};
const STRICH_MM = 2;
const LUECKE_MM = 1.5;
const RAHMEN_DICKE = 0.25;

/** Gestrichelte Strecke: Anzahl Striche und Schritt so, dass sie genau an beiden Enden mit einem Strich aufhört. */
export function striche(laengeMm: number): { n: number; schritt: number } {
  const n = Math.max(2, Math.round((laengeMm + LUECKE_MM) / (STRICH_MM + LUECKE_MM)));
  return { n, schritt: (laengeMm - STRICH_MM) / (n - 1) };
}

/** Rahmen hinter jeder Seite (eso-pic): vier Linien, gestrichelt aus kurzen Regeln oder durchgezogen. */
export function rahmenTex(format: Blattformat, linie: string): string {
  const r = RAHMEN_MM[format];
  const x0 = r.links;
  const y0 = r.unten;
  const w = r.breite - r.links - r.rechts;
  const h = r.hoehe - r.oben - r.unten;
  const d = zahl(RAHMEN_DICKE);
  const u = (mm: number) => L`\LenToUnit{${zahl(mm)}mm}`;
  let tex: string;
  if (linie === 'durchgezogen') {
    tex =
      L`\put(${u(x0)},${u(y0)}){\rule{${zahl(w)}mm}{${d}mm}}` +
      L`\put(${u(x0)},${u(y0 + h - RAHMEN_DICKE)}){\rule{${zahl(w)}mm}{${d}mm}}` +
      L`\put(${u(x0)},${u(y0)}){\rule{${d}mm}{${zahl(h)}mm}}` +
      L`\put(${u(x0 + w - RAHMEN_DICKE)},${u(y0)}){\rule{${d}mm}{${zahl(h)}mm}}`;
  } else {
    const wa = striche(w);
    const ha = striche(h);
    const waag = (y: number) => L`\multiput(${u(x0)},${u(y)})(${u(wa.schritt)},0){${String(wa.n)}}{\rule{${zahl(STRICH_MM)}mm}{${d}mm}}`;
    const senk = (x: number) => L`\multiput(${u(x)},${u(y0)})(0,${u(ha.schritt)}){${String(ha.n)}}{\rule{${d}mm}{${zahl(STRICH_MM)}mm}}`;
    tex = waag(y0) + waag(y0 + h - RAHMEN_DICKE) + senk(x0) + senk(x0 + w - RAHMEN_DICKE);
  }
  return L`\AddToShipoutPictureBG{\AtPageLowerLeft{\color{marke}` + tex + '}}';
}

/* ---------- Präambel ---------- */

const FARBEN: readonly (readonly [string, string])[] = [
  ['ink', '16181D'],
  ['grau', '6B7280'],
  ['haar', 'D5D8DE'],
  ['leer', '9CA3AF'],
  ['box', 'F3F4F6'],
  ['marke', 'A3A8B1'],
  // Wasserzeichen: die halbtransparenten Farben der Vorschau auf weißem Papier (deckend, liegt hinter dem Text)
  ['wm', 'F2F2F3'],
  ['wmrand', 'F3F3F4'],
  ['wmstorno', 'FAE3E3'],
  ['wmstornorand', 'FBE7E7'],
];

function praeambel(art: Belegart, akzentHex: string): string {
  const a4 = formatVon(art) === 'a4';
  const wm = a4 ? { pt: 92, rand: 2.4 } : { pt: 58, rand: 1.6 };
  return zeilen(
    `% Kladdy – ${ARTEN[art].label} (automatisch aus Bausteinen erzeugt – nicht bearbeiten)`,
    L`\documentclass[10pt]{article}`,
    a4
      ? L`\usepackage[a4paper, top=18mm, bottom=12mm, left=22mm, right=20mm]{geometry}`
      : L`\usepackage[a5paper, landscape, top=11mm, bottom=10mm, left=14mm, right=14mm]{geometry}`,
    L`\usepackage{fontspec}`,
    // Schnitte ausdrücklich: ohne Angabe nimmt fontspec aus HelveticaNeue.ttc für Fett den fett-kursiven Schnitt
    L`\IfFontExistsTF{Helvetica Neue}{\setmainfont{Helvetica Neue}[UprightFont=*, BoldFont=* Bold, ItalicFont=* Italic, BoldItalicFont=* Bold Italic]}{\setmainfont{texgyreheros}[Extension=.otf, UprightFont=*-regular, BoldFont=*-bold, ItalicFont=*-italic, BoldItalicFont=*-bolditalic]}`,
    L`\usepackage[ngerman]{babel}`,
    L`\usepackage{xcolor, graphicx, etoolbox, eso-pic}`,
    L`\definecolor{akzent}{HTML}{${belegAkzent(akzentHex)}}`,
    ...FARBEN.map(([n, h]) => L`\definecolor{${n}}{HTML}{${h}}`),
    L`\setlength{\parindent}{0pt}`,
    L`\setlength{\parskip}{0pt}`,
    L`\setlength{\emergencystretch}{3em}`,
    L`\pagestyle{empty}`,
    '',
    L`\input{daten.tex}`,
    '',
    '% Hilfsbefehle der Bausteine',
    L`\newcounter{KPos}`,
    L`\newlength{\KPosB}`,
    L`\newsavebox{\KBox}`,
    L`\providecommand{\Position}[6]{}`,
    L`\newcommand{\KNr}{\ifdefempty{\Nummer}{\textcolor{leer}{\itshape Entwurf}}{\Nummer}}`,
    L`\newcommand{\KZeile}[1]{\ifdefempty{#1}{}{#1\par}}`,
    L`\newcommand{\KZeileVor}[2]{\ifdefempty{#2}{}{#1#2\par}}`,
    L`\newcommand{\KMeta}[2]{\noindent\strut\textcolor{grau}{#1}\hfill #2\par\vspace{1.1mm}}`,
    L`\newcommand{\KFeld}[2]{{${fs(7.5)}\color{grau}#1\par}\vspace{.6mm}{${fs(11, 1.3)}#2\par}\vspace{3mm}}`,
    L`\newcommand{\KForm}[2]{{${fs(10.5, 1.35)}\noindent\textbf{#1:}\ #2\par}\vspace{2mm}}`,
    // Ankreuzfeld 3 mm, angekreuzt mit einem Kreuz (nicht nur Farbe); gezeichnet, keine Sonderzeichen aus der Schrift
    L`\newcommand{\KKaestchen}[1]{\raisebox{-.35mm}{\setlength{\unitlength}{1mm}\begin{picture}(3,3)\put(0,0){\rule{3mm}{.25mm}}\put(0,2.75){\rule{3mm}{.25mm}}\put(0,0){\rule{.25mm}{3mm}}\put(2.75,0){\rule{.25mm}{3mm}}\ifnum#1=1 \put(1.5,1.5){\makebox(0,0){\rotatebox{45}{\rule[-.15mm]{2.7mm}{.3mm}}}}\put(1.5,1.5){\makebox(0,0){\rotatebox{-45}{\rule[-.15mm]{2.7mm}{.3mm}}}}\fi\end{picture}}}`,
    L`\newcommand{\KAnkreuz}[2]{\mbox{\ifdefstring{\ZahlungswegKurz}{#1}{\KKaestchen{1}}{\KKaestchen{0}}\hspace{1.5mm}#2}}`,
    L`\newcommand{\KPositionMini}[6]{\noindent\makebox[20mm][l]{\textcolor{grau}{#3\ifblank{#4}{}{~#4}~×}}\hspace{2.5mm}\parbox[t]{\dimexpr\linewidth-47.5mm\relax}{\raggedright #2}\hfill\makebox[22mm][r]{#6}\par}`,
    L`\newcommand{\KWasserzeichen}[3]{\AddToShipoutPictureBG{\AtPageCenter{\makebox(0,0){\rotatebox{33}{\setlength{\fboxrule}{${String(wm.rand)}mm}\setlength{\fboxsep}{2mm}\textcolor{#3}{\fbox{\hspace{7mm}\textcolor{#2}{\fontsize{${String(wm.pt)}}{${String(wm.pt)}}\selectfont\bfseries\addfontfeature{LetterSpace=10}#1}\hspace{7mm}}}}}}}}`,
  );
}

/* ---------- Zusammensetzen ---------- */

export interface TexBereich {
  /** erste und letzte Zeile in main.tex (ab 1) */
  von: number;
  bis: number;
  /** Index des Bausteins in der Vorlage */
  index: number;
  typ: BausteinTyp;
  name: string;
}

export interface MainTex {
  tex: string;
  bereiche: TexBereich[];
}

/** main.tex für eine Belegart aus ihren Bausteinen. `akzent` = Akzentfarbe der App ('#rrggbb'). */
export function mainTex(art: Belegart, bausteine: readonly Baustein[], akzent: string): MainTex {
  const a4 = formatVon(art) === 'a4';
  const teile: { text: string; index?: number; typ?: BausteinTyp }[] = [];
  const add = (text: string, index?: number, typ?: BausteinTyp) => teile.push({ text, index, typ });

  add(praeambel(art, akzent));
  add('');
  add(L`\begin{document}`);
  add(L`\raggedright\color{ink}` + fs(10));
  add(L`\ifdefempty{\Storniert}{\ifdefempty{\Nummer}{\KWasserzeichen{ENTWURF}{wm}{wmrand}}{}}{\KWasserzeichen{STORNIERT}{wmstorno}{wmstornorand}}`);
  if (a4) {
    // Falz- und Lochmarken am linken Rand der ersten Seite (wie die Vorschau)
    const marke = (mm: string, breite: number) => L`\put(0,\LenToUnit{-${mm}mm}){\textcolor{marke}{\rule{${String(breite)}mm}{.2mm}}}`;
    add(L`\AddToShipoutPictureBG*{\AtPageUpperLeft{` + marke('105', 5) + marke('210', 5) + marke('148.5', 8) + '}}');
  }

  const alle = sichtbare(bausteine);
  // Rahmen: hinter jede Seite, unabhängig von der Stelle in der Liste
  for (const x of alle.filter((y) => istUmrandet(y.b))) add(`% Baustein ${x.index + 1}: ${BAUSTEINE[x.b.typ].name}\n` + rahmenTex(formatVon(art), x.b.text('linie')), x.index, x.b.typ);
  const liste = alle.filter((y) => !istUmrandet(y.b));
  const block = (x: (typeof liste)[number], vorher: BausteinTyp | null, unten: boolean): boolean => {
    const s = BLOCK[x.b.typ](x.b, { art, a4, vorher });
    if (!s.tex || (s.leer && !s.leer.length)) return false;
    const mm = abstandMm(vorher, x.b.typ, unten, x.b.text('stil')) + (unten && vorher ? 4 : 0);
    const abstand = mm ? L`\vspace{${zahl(mm)}mm}` + '\n' : '';
    add(`% Baustein ${x.index + 1}: ${BAUSTEINE[x.b.typ].name}\n` + wennNichtLeer(s.leer, abstand + s.tex), x.index, x.b.typ);
    return true;
  };

  let vorher: BausteinTyp | null = null;
  for (const x of liste.filter((y) => !istUnten(y.b))) if (block(x, vorher, false)) vorher = x.b.typ;
  const unten = liste.filter((y) => istUnten(y.b));
  if (unten.length) {
    // Unterer Bereich: am Seitenende verankert (Vorschau: .sh-unten), mindestens 6 mm Abstand zum Inhalt
    add(L`\par\vspace{6mm plus 1fill}`);
    let v: BausteinTyp | null = null;
    for (const x of unten) if (block(x, v, true)) v = x.b.typ;
  }
  add(L`\end{document}`);

  // Zeilen zählen und Bereiche festhalten
  const bereiche: TexBereich[] = [];
  let zeile = 1;
  const out: string[] = [];
  for (const t of teile) {
    const n = t.text.split('\n').length;
    if (t.index != null && t.typ) bereiche.push({ von: zeile, bis: zeile + n - 1, index: t.index, typ: t.typ, name: BAUSTEINE[t.typ].name });
    out.push(t.text);
    zeile += n;
  }
  return { tex: out.join('\n') + '\n', bereiche };
}

/** Baustein zu einer Zeile in main.tex (für Fehlermeldungen), sonst null. */
export const bereichZuZeile = (m: MainTex, zeile: number): TexBereich | null => m.bereiche.find((b) => zeile >= b.von && zeile <= b.bis) ?? null;
