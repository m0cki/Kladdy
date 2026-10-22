import { describe, expect, it } from 'vitest';
import { betragLatex, escapeLatex } from './escape';

describe('escapeLatex', () => {
  it('maskiert die Sonderzeichen aus §7.1', () => {
    expect(escapeLatex('Müller & Söhne 100%')).toBe('Müller \\& Söhne 100\\%');
    expect(escapeLatex('$ # _ { }')).toBe('\\$ \\# \\_ \\{ \\}');
    expect(escapeLatex('a\\b')).toBe('a\\textbackslash{}b');
    expect(escapeLatex('~ ^')).toBe('\\textasciitilde{} \\textasciicircum{}');
  });

  it('maskiert den Backslash zuerst (keine doppelte Maskierung)', () => {
    expect(escapeLatex('\\&')).toBe('\\textbackslash{}\\&');
    expect(escapeLatex('\\textbf{x}')).toBe('\\textbackslash{}textbf\\{x\\}');
    expect(escapeLatex('\\input{/etc/passwd}')).toBe('\\textbackslash{}input\\{/etc/passwd\\}');
  });

  it('entschärft das babel-Kürzel " und trennt TeX-Ligaturen', () => {
    expect(escapeLatex('Firma "Gartenzwerg"')).toBe('Firma \\textquotedbl{}Gartenzwerg\\textquotedbl{}');
    expect(escapeLatex('a--b')).toBe('a-{}-b');
    expect(escapeLatex('a---b')).toBe('a-{}-{}-b');
    expect(escapeLatex(',,x<<y>>')).toBe(',{},x<{}<y>{}>');
    expect(escapeLatex('Peter\'s')).toBe("Peter's");
    expect(escapeLatex('Haus-Nr. 3')).toBe('Haus-Nr. 3');
  });

  it('macht aus Zeilenumbrüchen \\\\ (Adressen) und schützt vor folgendem [', () => {
    expect(escapeLatex('z. Hd. Frau Kaiser\nSeeufer 5\n12390 Seehausen')).toBe('z. Hd. Frau Kaiser\\\\{}Seeufer 5\\\\{}12390 Seehausen');
    expect(escapeLatex('a\r\n[b]')).toBe('a\\\\{}[b]');
    expect(escapeLatex('\n\n a \n\n')).toBe(' a');
    expect(escapeLatex('a\nb', { umbruch: 'newline' })).toBe('a\\newline{}b');
    expect(escapeLatex('a\nb', { umbruch: 'einzeilig' })).toBe('a b');
  });

  it('entfernt Steuerzeichen, Tabulatoren werden Leerzeichen', () => {
    expect(escapeLatex('a\u0000b\u0007c\td')).toBe('abc d');
    expect(escapeLatex(null)).toBe('');
    expect(escapeLatex(undefined)).toBe('');
  });

  it('lässt Umlaute, €, § und andere Unicode-Zeichen stehen', () => {
    expect(escapeLatex('Grünschnitt · § 19 UStG · 5 € · ½')).toBe('Grünschnitt · § 19 UStG · 5 € · ½');
  });

  it('hinterlässt nie ein unmaskiertes Sonderzeichen', () => {
    const alle = 'x\\&%$#_{}~^"y';
    const out = escapeLatex(alle);
    // Nach Entfernen aller erlaubten Befehle bleibt kein Sonderzeichen übrig
    const rest = out
      .replace(/\\textbackslash\{\}|\\textasciitilde\{\}|\\textasciicircum\{\}|\\textquotedbl\{\}/g, '')
      .replace(/\\[&%$#_{}]/g, '');
    expect(rest).toBe('xy');
  });
});

describe('betragLatex', () => {
  it('formatiert Cent als 1.234,50\\,€', () => {
    expect(betragLatex(123450)).toBe('1.234,50\\,€');
    expect(betragLatex(0)).toBe('0,00\\,€');
    expect(betragLatex(-300)).toBe('−3,00\\,€');
  });
});
