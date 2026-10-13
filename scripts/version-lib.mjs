// Versionsnummer an allen Stellen gleich halten (CLAUDE.md, §3.2).
// Reine Funktionen ohne Dateizugriff – getestet in version-lib.test.mjs, benutzt von scripts/version.mjs.

/** Die Dateien, in denen die Version steht (relativ zum Repository). */
export const VERSION_FILES = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  tauriConf: 'src-tauri/tauri.conf.json',
  cargoToml: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
};

export const CRATE_NAME = 'kladdy';
export const BUMPS = ['patch', 'minor', 'major'];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "1.2.3" → [1, 2, 3]. Wirft bei allem, was keine schlichte SemVer-Version ist. */
export function parseVersion(v) {
  const m = SEMVER.exec(String(v).trim());
  if (!m) throw new Error(`Keine gültige Version (erwartet X.Y.Z): "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Version nach SemVer erhöhen: patch 1.2.3 → 1.2.4, minor → 1.3.0, major → 2.0.0. */
export function bumpVersion(v, bump) {
  const [major, minor, patch] = parseVersion(v);
  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unbekannte Erhöhung "${bump}" (erlaubt: ${BUMPS.join(', ')})`);
  }
}

const json = (obj) => JSON.stringify(obj, null, 2) + '\n';

/* ---------- Lesen ---------- */

export function readJsonVersion(text) {
  return JSON.parse(text).version;
}

export function readPackageLockVersions(text) {
  const lock = JSON.parse(text);
  return [lock.version, lock.packages?.['']?.version];
}

/** Version aus dem [package]-Abschnitt von Cargo.toml. */
export function readCargoTomlVersion(text) {
  const section = packageSection(text);
  const m = /^version\s*=\s*"([^"]*)"/m.exec(section.body);
  return m ? m[1] : undefined;
}

/** Version des Pakets `name` in Cargo.lock. */
export function readCargoLockVersion(text, name = CRATE_NAME) {
  const m = lockEntry(name).exec(text);
  return m ? m[2] : undefined;
}

/* ---------- Schreiben (Formatierung bleibt erhalten) ---------- */

export function writeJsonVersion(text, version) {
  const obj = JSON.parse(text);
  obj.version = version;
  return json(obj);
}

export function writePackageLockVersion(text, version) {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  return json(lock);
}

export function writeCargoTomlVersion(text, version) {
  const section = packageSection(text);
  const re = /^(version\s*=\s*")([^"]*)(")/m;
  if (!re.test(section.body)) throw new Error('Cargo.toml: keine version im [package]-Abschnitt');
  const body = section.body.replace(re, `$1${version}$3`);
  return text.slice(0, section.start) + body + text.slice(section.end);
}

export function writeCargoLockVersion(text, version, name = CRATE_NAME) {
  const re = lockEntry(name);
  if (!re.test(text)) throw new Error(`Cargo.lock: kein Eintrag für "${name}"`);
  return text.replace(re, `$1${version}$3`);
}

/* ---------- Vergleichen ---------- */

/** Alle gefundenen Versionen; `ok` nur, wenn alle vorhanden und gleich sind. */
export function compareVersions(entries) {
  const values = Object.values(entries);
  const ok = values.length > 0 && values.every((v) => typeof v === 'string' && v === values[0]);
  return { ok, version: ok ? values[0] : undefined, entries };
}

/* ---------- intern ---------- */

function packageSection(text) {
  const head = /^\[package\]\s*$/m.exec(text);
  if (!head) throw new Error('Cargo.toml: kein [package]-Abschnitt');
  const start = head.index + head[0].length;
  const next = /^\[/m.exec(text.slice(start));
  const end = next ? start + next.index : text.length;
  return { start, end, body: text.slice(start, end) };
}

function lockEntry(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${esc}"\\r?\\nversion = ")([^"]*)(")`);
}
