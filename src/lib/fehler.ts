/* Fehler aus Datenbank/Tauri (Error oder String, Rust-Commands melden deutschen Text) als Anzeige-Text. */
export const fehlerText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Unbekannter Fehler');
