/* Kleiner Text-Editor mit Formatierung für Texte der Bausteine (ANLEITUNG §7.0 „Formatierung“): fett, kursiv,
 * unterstrichen und Platzhalter als Chips. Gespeichert wird Markup (<b>, <i>, <u>; lib/vorlagen/formatierung.ts).
 * - Im Blatt der Vorlagen-Seite (Blatt.tsx, `leiste="schwebend"`): ersetzt den angeklickten Text an derselben Stelle,
 *   die Leiste schwebt darüber (Portal, damit sie nicht mitskaliert oder abgeschnitten wird). Esc, Klick daneben und bei
 *   einzeiligen Feldern Enter beenden das Bearbeiten.
 * - In der Einstellungskarte (`leiste="fest"`): Leiste über dem Feld.
 * - contenteditable ohne React-Kinder: Der DOM wird nur neu aufgebaut, wenn der Wert von außen kommt oder der Editor
 *   selbst formatiert, löscht oder einfügt – beim Tippen nie, damit die Schreibmarke nicht springt. Jede Eingabe wird
 *   gelesen (lib/vorlagen/editordom.ts), in die feste Form gebracht und gemeldet.
 * - Eigene Bearbeitungsschritte: F/K/U (⌘B/⌘I/⌘U), Löschen (Chips als Ganzes), Umbruch, Einsetzen (nur Text),
 *   Rückgängig/Wiederholen (⌘Z/⌘⇧Z und Menü „Widerrufen“). Diese Tasten gehen nicht an die Seite weiter, ⌘K/⌘N schon.
 * Stile: styles/vorlagen.css (.fe-*) */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type HTMLAttributes, type KeyboardEvent, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { domStelle, istKanonisch, lesen, type Knoten } from '../../lib/vorlagen/editordom';
import {
  OHNE_STIL,
  bereichErsetzen,
  formatieren,
  hatStil,
  laenge,
  parsen,
  serialisieren,
  stilBei,
  textLaeufe,
  zeichenLoeschen,
  type Eigenschaft,
  type Lauf,
  type Stil,
} from '../../lib/vorlagen/formatierung';
import type { PlatzhalterName } from '../../lib/vorlagen/dokument';

export interface FormatEditorHandle {
  /** Platzhalter an der Schreibmarke (sonst am Ende) einfügen */
  platzhalter(name: PlatzhalterName): void;
  fokus(): void;
}

export interface FormatEditorProps {
  wert: string;
  onChange: (wert: string) => void;
  /** Enter = neue Zeile (sonst beendet Enter im Blatt das Bearbeiten) */
  mehrzeilig: boolean;
  leiste: 'schwebend' | 'fest';
  /** Esc, Klick daneben, Enter (einzeilig) */
  onEnde?: () => void;
  autoFokus?: boolean;
  /** Klickpunkt, an dem die Schreibmarke beim Öffnen landen soll */
  klick?: { x: number; y: number } | null;
  als?: 'span' | 'div';
  id?: string;
  label: string;
  labelledBy?: string;
  className?: string;
  /** Text, wenn leer */
  leerText?: string;
  ref?: Ref<FormatEditorHandle>;
}

const KNOEPFE: readonly { eig: Eigenschaft; zeichen: string; titel: string; klasse: string }[] = [
  { eig: 'fett', zeichen: 'F', titel: 'Fett · ⌘B', klasse: 'fe-f' },
  { eig: 'kursiv', zeichen: 'K', titel: 'Kursiv · ⌘I', klasse: 'fe-k' },
  { eig: 'unterstrichen', zeichen: 'U', titel: 'Unterstrichen · ⌘U', klasse: 'fe-u' },
];
const TASTE: Readonly<Record<string, Eigenschaft>> = { b: 'fett', i: 'kursiv', u: 'unterstrichen' };
const FORMAT_EINGABE: Readonly<Record<string, Eigenschaft>> = { formatBold: 'fett', formatItalic: 'kursiv', formatUnderline: 'unterstrichen' };
/** Tippen innerhalb dieser Zeit ist ein Schritt für „Rückgängig“ */
const TIPP_SCHRITT_MS = 1000;
const MAX_SCHRITTE = 200;

type Schritt = { markup: string; a: number; b: number };
type Auswahl = { a: number; b: number; laeufe: Lauf[]; umgewandelt: boolean };

const alsKnoten = (n: Node): Knoten => n as unknown as Knoten;
const alsNode = (k: Knoten): Node => k as unknown as Node;

/** DOM aus Läufen: b › i › u, Umbrüche als <br>, Platzhalter als nicht bearbeitbare Chips. */
function knotenAus(laeufe: readonly Lauf[]): Node[] {
  const out: Node[] = [];
  laeufe.forEach((l, i) => {
    const inhalt: Node[] = [];
    if (l.art === 'platzhalter') {
      const chip = document.createElement('span');
      chip.className = 'fe-chip';
      chip.contentEditable = 'false';
      chip.setAttribute('data-ph', l.name);
      chip.textContent = `{${l.name}}`;
      inhalt.push(chip);
    } else {
      l.text.split('\n').forEach((teil, j) => {
        if (j > 0) inhalt.push(document.createElement('br'));
        if (teil) inhalt.push(document.createTextNode(teil));
      });
    }
    let knoten = inhalt;
    for (const [an, tag] of [
      [l.unterstrichen, 'u'],
      [l.kursiv, 'i'],
      [l.fett, 'b'],
    ] as const) {
      if (!an || !knoten.length) continue;
      const el = document.createElement(tag);
      el.append(...knoten);
      knoten = [el];
    }
    out.push(...knoten);
    // Hinter einem Chip am Zeilenende braucht WebKit einen Textknoten für die Schreibmarke
    const naechster = laeufe[i + 1];
    if (l.art === 'platzhalter' && (!naechster || (naechster.art === 'text' && naechster.text.startsWith('\n')))) out.push(document.createTextNode('​'));
  });
  const letzter = laeufe[laeufe.length - 1];
  // ein Umbruch am Ende braucht ein zweites <br>, sonst ist die leere Zeile nicht zu sehen
  if (letzter?.art === 'text' && letzter.text.endsWith('\n')) out.push(document.createElement('br'));
  return out;
}

export function FormatEditor({
  wert,
  onChange,
  mehrzeilig,
  leiste,
  onEnde,
  autoFokus = false,
  klick = null,
  als = 'span',
  id,
  label,
  labelledBy,
  className = '',
  leerText = 'Text eingeben …',
  ref,
}: FormatEditorProps) {
  const el = useRef<HTMLElement>(null);
  const leisteRef = useRef<HTMLDivElement>(null);
  /** Wert, den der DOM gerade zeigt (zuletzt gemeldet oder von außen gesetzt) */
  const letzter = useRef<string | null>(null);
  const melde = useRef(onChange);
  const beende = useRef(onEnde);
  useEffect(() => {
    melde.current = onChange;
    beende.current = onEnde;
  });
  /** Formatierung für das nächste getippte Zeichen (F/K/U ohne Markierung) */
  const vorgemerkt = useRef<{ stil: Stil; stelle: number } | null>(null);
  const verlauf = useRef<{ liste: Schritt[]; i: number; zeit: number; art: string }>({ liste: [], i: 0, zeit: 0, art: '' });
  const letzteAuswahl = useRef<{ a: number; b: number } | null>(null);
  const [aktiv, setAktiv] = useState<Stil>(OHNE_STIL);
  const [fokus, setFokus] = useState(false);
  const [lage, setLage] = useState<{ top: number; left: number } | null>(null);

  const einzeilig = (markup: string) => (mehrzeilig ? markup : markup.replace(/\n/g, ' '));

  const aufbauen = (laeufe: readonly Lauf[]) => {
    el.current?.replaceChildren(...knotenAus(laeufe));
  };

  const auswahl = (): Auswahl | null => {
    const root = el.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
    const g = lesen(alsKnoten(root), [
      { knoten: alsKnoten(r.startContainer), offset: r.startOffset },
      { knoten: alsKnoten(r.endContainer), offset: r.endOffset },
    ]);
    const n = laenge(g.laeufe);
    const a = g.stellen[0] ?? n;
    const b = g.stellen[1] ?? n;
    return { a: Math.min(a, b), b: Math.max(a, b), laeufe: g.laeufe, umgewandelt: g.umgewandelt };
  };

  /** Auswahl oder (ohne Fokus) die zuletzt bekannte bzw. das Ende */
  const auswahlOderZuletzt = (): Auswahl | null => {
    const s = auswahl();
    if (s) return s;
    const root = el.current;
    if (!root) return null;
    const g = lesen(alsKnoten(root));
    const n = laenge(g.laeufe);
    const z = letzteAuswahl.current;
    return { a: Math.min(z?.a ?? n, n), b: Math.min(z?.b ?? n, n), laeufe: g.laeufe, umgewandelt: g.umgewandelt };
  };

  const setzeAuswahl = (a: number, b: number) => {
    const root = el.current;
    const sel = window.getSelection();
    if (!root || !sel) return;
    const s = domStelle(alsKnoten(root), a);
    const e = domStelle(alsKnoten(root), b);
    const range = document.createRange();
    range.setStart(alsNode(s.knoten), s.offset);
    range.setEnd(alsNode(e.knoten), e.offset);
    sel.removeAllRanges();
    sel.addRange(range);
    letzteAuswahl.current = { a, b };
  };

  const position = () => {
    const root = el.current;
    if (leiste !== 'schwebend' || !root) return;
    const r = root.getBoundingClientRect();
    const h = leisteRef.current?.offsetHeight ?? 34;
    const w = leisteRef.current?.offsetWidth ?? 110;
    let top = r.top - h - 8;
    if (top < 4) top = r.bottom + 8;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
    setLage((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  };

  /** Neuer Stand: in den Verlauf (Tippen zusammengefasst) und melden, wenn er sich geändert hat. */
  const merken = (markup: string, a: number, b: number, art: string) => {
    const v = verlauf.current;
    const jetzt = Date.now();
    if (markup !== v.liste[v.i]?.markup) {
      if (art === 'tippen' && v.art === 'tippen' && jetzt - v.zeit < TIPP_SCHRITT_MS && v.i > 0) v.liste[v.i] = { markup, a, b };
      else {
        v.liste = [...v.liste.slice(0, v.i + 1), { markup, a, b }].slice(-MAX_SCHRITTE);
        v.i = v.liste.length - 1;
      }
      v.zeit = jetzt;
      v.art = art;
    }
    letzteAuswahl.current = { a, b };
    if (markup !== letzter.current) {
      letzter.current = markup;
      melde.current(markup);
    }
    position();
  };

  /** Ergebnis eines eigenen Bearbeitungsschritts: DOM neu, Auswahl setzen, melden. */
  const anwenden = (laeufe: readonly Lauf[], a: number, b: number, art: string) => {
    const markup = einzeilig(serialisieren(laeufe));
    aufbauen(parsen(markup));
    el.current?.focus({ preventScroll: true });
    setzeAuswahl(a, b);
    merken(markup, a, b, art);
  };

  const schrittZeigen = (s: Schritt) => {
    aufbauen(parsen(s.markup));
    setzeAuswahl(s.a, s.b);
    verlauf.current.art = 'verlauf';
    if (s.markup !== letzter.current) {
      letzter.current = s.markup;
      melde.current(s.markup);
    }
  };
  const rueckgaengig = () => {
    const v = verlauf.current;
    if (v.i <= 0) return;
    v.i--;
    schrittZeigen(v.liste[v.i]);
  };
  const wiederholen = () => {
    const v = verlauf.current;
    if (v.i >= v.liste.length - 1) return;
    v.i++;
    schrittZeigen(v.liste[v.i]);
  };

  const stand = () => {
    const s = auswahl();
    if (!s) return;
    letzteAuswahl.current = { a: s.a, b: s.b };
    const v = vorgemerkt.current;
    if (v && !(s.a === s.b && s.a === v.stelle)) vorgemerkt.current = null;
    const st = vorgemerkt.current?.stil ?? {
      fett: hatStil(s.laeufe, s.a, s.b, 'fett'),
      kursiv: hatStil(s.laeufe, s.a, s.b, 'kursiv'),
      unterstrichen: hatStil(s.laeufe, s.a, s.b, 'unterstrichen'),
    };
    setAktiv((p) => (p.fett === st.fett && p.kursiv === st.kursiv && p.unterstrichen === st.unterstrichen ? p : st));
  };

  const umschalten = (eig: Eigenschaft) => {
    const s = auswahl();
    if (!s) {
      el.current?.focus();
      return;
    }
    if (s.a === s.b) {
      // ohne Markierung: gilt für das, was als Nächstes getippt wird
      const basis = vorgemerkt.current?.stelle === s.a ? vorgemerkt.current.stil : stilBei(s.laeufe, s.a);
      const st = { ...basis, [eig]: !basis[eig] };
      vorgemerkt.current = { stil: st, stelle: s.a };
      setAktiv(st);
      return;
    }
    anwenden(formatieren(s.laeufe, s.a, s.b, eig, !hatStil(s.laeufe, s.a, s.b, eig)), s.a, s.b, 'format');
  };

  /** Text (oder Läufe) an der Auswahl einfügen */
  const einsetzen = (s: Auswahl, neu: Lauf[], art: string) => {
    const n = laenge(neu);
    anwenden(bereichErsetzen(s.laeufe, s.a, s.b, neu), s.a + n, s.a + n, art);
  };
  const stilHier = (s: Auswahl): Stil => (vorgemerkt.current?.stelle === s.a ? vorgemerkt.current.stil : stilBei(s.laeufe, s.a));

  useImperativeHandle(ref, () => ({
    platzhalter(name) {
      const s = auswahlOderZuletzt();
      if (!s) return;
      einsetzen(s, [{ art: 'platzhalter', name, ...stilHier(s) }], 'einfuegen');
    },
    fokus() {
      el.current?.focus();
    },
  }));

  // Wert von außen (erster Aufbau, anderer Baustein, Zurücksetzen, Rückgängig der Seite): DOM neu, Verlauf neu.
  // Eigene Meldungen kommen als derselbe Wert zurück und bauen nichts neu (Schreibmarke bleibt).
  useLayoutEffect(() => {
    if (wert === letzter.current) return;
    letzter.current = wert;
    const laeufe = parsen(wert);
    aufbauen(laeufe);
    const n = laenge(laeufe);
    verlauf.current = { liste: [{ markup: wert, a: n, b: n }], i: 0, zeit: 0, art: '' };
    vorgemerkt.current = null;
    letzteAuswahl.current = null;
  }, [wert]);

  // Öffnen im Blatt: Fokus und Schreibmarke an der angeklickten Stelle (sonst am Ende)
  useLayoutEffect(() => {
    const root = el.current;
    if (!autoFokus || !root) return;
    root.focus({ preventScroll: true });
    const sel = window.getSelection();
    const r = klick && typeof document.caretRangeFromPoint === 'function' ? document.caretRangeFromPoint(klick.x, klick.y) : null;
    if (r && sel && root.contains(r.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      const n = laenge(lesen(alsKnoten(root)).laeufe);
      setzeAuswahl(n, n);
    }
    // nur beim Öffnen
  }, []);

  // Eingaben, die der Editor selbst ausführt (beforeinput gibt es in React nicht mit inputType)
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const vorEingabe = (e: InputEvent) => {
      const t = e.inputType;
      if (t === 'historyUndo' || t === 'historyRedo') {
        e.preventDefault();
        if (t === 'historyUndo') rueckgaengig();
        else wiederholen();
        return;
      }
      if (FORMAT_EINGABE[t]) {
        e.preventDefault();
        umschalten(FORMAT_EINGABE[t]);
        return;
      }
      if (t === 'insertFromDrop') {
        e.preventDefault();
        return;
      }
      if (e.isComposing) return;
      const s = auswahl();
      if (!s) return;
      if (t === 'insertParagraph' || t === 'insertLineBreak') {
        e.preventDefault();
        if (mehrzeilig) einsetzen(s, [{ art: 'text', text: '\n', ...OHNE_STIL }], 'umbruch');
        else beende.current?.();
        return;
      }
      if (t === 'deleteContentBackward' || t === 'deleteContentForward') {
        e.preventDefault();
        if (s.a !== s.b) anwenden(bereichErsetzen(s.laeufe, s.a, s.b, []), s.a, s.a, 'loeschen');
        else {
          const r = zeichenLoeschen(s.laeufe, s.a, t === 'deleteContentBackward' ? -1 : 1);
          anwenden(r.laeufe, r.stelle, r.stelle, 'tippen');
        }
        return;
      }
      if (t === 'insertText' && e.data && vorgemerkt.current && s.a === s.b && vorgemerkt.current.stelle === s.a) {
        e.preventDefault();
        const st = vorgemerkt.current.stil;
        vorgemerkt.current = null;
        einsetzen(s, textLaeufe(einzeilig(e.data), st), 'tippen');
      }
    };
    root.addEventListener('beforeinput', vorEingabe);
    return () => root.removeEventListener('beforeinput', vorEingabe);
  });

  // Leiste: Zustand an der Schreibmarke, Lage beim Blättern
  useEffect(() => {
    if (!fokus) return;
    const auswahlNeu = () => stand();
    const neuLegen = () => position();
    document.addEventListener('selectionchange', auswahlNeu);
    window.addEventListener('scroll', neuLegen, true);
    window.addEventListener('resize', neuLegen);
    position();
    stand();
    return () => {
      document.removeEventListener('selectionchange', auswahlNeu);
      window.removeEventListener('scroll', neuLegen, true);
      window.removeEventListener('resize', neuLegen);
    };
  });

  const eingabe = (e: FormEvent<HTMLElement>) => {
    if ((e.nativeEvent as InputEvent).isComposing) return;
    const root = el.current;
    const s = auswahl();
    if (!root || !s) return;
    const roh = serialisieren(s.laeufe);
    const markup = einzeilig(roh);
    // getippter {name} wird zum Chip, fremde Elemente (z. B. WebKit-Stil-spans) verschwinden
    if (s.umgewandelt || markup !== roh || !istKanonisch(alsKnoten(root))) {
      aufbauen(parsen(markup));
      setzeAuswahl(s.a, s.b);
    }
    merken(markup, s.a, s.b, 'tippen');
  };

  const taste = (e: KeyboardEvent<HTMLElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && TASTE[k]) {
      e.preventDefault();
      e.stopPropagation();
      umschalten(TASTE[k]);
      return;
    }
    if (mod && !e.altKey && k === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) wiederholen();
      else rueckgaengig();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (beende.current) beende.current();
      else el.current?.blur();
      return;
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      if (!mehrzeilig) {
        beende.current?.();
        return;
      }
      const s = auswahl();
      if (s) einsetzen(s, [{ art: 'text', text: '\n', ...OHNE_STIL }], 'umbruch');
    }
  };

  const einfuegen = (e: ClipboardEvent<HTMLElement>) => {
    e.preventDefault();
    const s = auswahl();
    if (!s) return;
    // nur Text: Formatierung, Bilder und HTML aus der Zwischenablage bleiben draußen
    let text = e.clipboardData
      .getData('text/plain')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f​﻿]/g, '');
    if (!mehrzeilig) text = text.replace(/\s*\n\s*/g, ' ');
    if (!text) return;
    einsetzen(s, textLaeufe(text, stilHier(s)), 'einfuegen');
  };

  const knopfLeiste = (
    <div
      ref={leisteRef}
      className={`fe-leiste ${leiste}`}
      role="toolbar"
      aria-label={`Formatierung: ${label}`}
      style={leiste === 'schwebend' ? (lage ? { top: lage.top, left: lage.left } : { visibility: 'hidden' }) : undefined}
      // Klicks auf die Leiste nehmen dem Text nie den Fokus
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {KNOEPFE.map((k) => (
        <button
          key={k.eig}
          type="button"
          className={`fe-btn ${k.klasse}${aktiv[k.eig] ? ' on' : ''}`}
          title={k.titel}
          aria-label={k.titel}
          aria-pressed={aktiv[k.eig]}
          tabIndex={-1}
          onClick={() => umschalten(k.eig)}
        >
          {k.zeichen}
        </button>
      ))}
    </div>
  );

  const eigenschaften: HTMLAttributes<HTMLElement> & { 'data-leer': string } = {
    id,
    className: `fe-eingabe ${mehrzeilig ? 'mehrzeilig' : 'einzeilig'} ${className}`.trim(),
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: 'textbox',
    'aria-multiline': mehrzeilig,
    'aria-label': labelledBy ? undefined : label,
    'aria-labelledby': labelledBy,
    'data-leer': leerText,
    spellCheck: false,
    onInput: eingabe,
    onKeyDown: taste,
    onPaste: einfuegen,
    onDrop: (e) => e.preventDefault(),
    onFocus: () => setFokus(true),
    onBlur: () => {
      // Fensterwechsel beendet nichts
      if (!document.hasFocus()) return;
      setFokus(false);
      beende.current?.();
    },
    // Klick ins Feld wählt im Blatt nicht noch einmal (der Baustein ist schon gewählt)
    onClick: (e) => e.stopPropagation(),
  };
  const feld =
    als === 'div' ? (
      <div ref={el as RefObject<HTMLDivElement | null>} {...eigenschaften} />
    ) : (
      <span ref={el as RefObject<HTMLSpanElement | null>} {...eigenschaften} />
    );

  if (leiste === 'fest') {
    return (
      <div className="fe-feld">
        {knopfLeiste}
        {feld}
      </div>
    );
  }
  return (
    <>
      {feld}
      {fokus && createPortal(knopfLeiste, document.body)}
    </>
  );
}
