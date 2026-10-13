#!/usr/bin/env node
// Versionsnummer lesen, prüfen und erhöhen – ohne zusätzliche Abhängigkeiten.
//   node scripts/version.mjs get            → aktuelle Version (aus package.json)
//   node scripts/version.mjs check          → Fehler, wenn die Versionen auseinanderlaufen
//   node scripts/version.mjs bump <patch|minor|major>
//   node scripts/version.mjs set <X.Y.Z>    → schreibt überall dieselbe Version, gibt sie aus
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUMPS,
  VERSION_FILES as F,
  bumpVersion,
  compareVersions,
  parseVersion,
  readCargoLockVersion,
  readCargoTomlVersion,
  readJsonVersion,
  readPackageLockVersions,
  writeCargoLockVersion,
  writeCargoTomlVersion,
  writeJsonVersion,
  writePackageLockVersion,
} from './version-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const write = (f, text) => writeFileSync(join(root, f), text);

function collect() {
  const [lock, lockRoot] = readPackageLockVersions(read(F.packageLock));
  return {
    [F.packageJson]: readJsonVersion(read(F.packageJson)),
    [`${F.packageLock} (version)`]: lock,
    [`${F.packageLock} (packages[""])`]: lockRoot,
    [F.tauriConf]: readJsonVersion(read(F.tauriConf)),
    [F.cargoToml]: readCargoTomlVersion(read(F.cargoToml)),
    [F.cargoLock]: readCargoLockVersion(read(F.cargoLock)),
  };
}

function setAll(version) {
  parseVersion(version);
  write(F.packageJson, writeJsonVersion(read(F.packageJson), version));
  write(F.packageLock, writePackageLockVersion(read(F.packageLock), version));
  write(F.tauriConf, writeJsonVersion(read(F.tauriConf), version));
  write(F.cargoToml, writeCargoTomlVersion(read(F.cargoToml), version));
  write(F.cargoLock, writeCargoLockVersion(read(F.cargoLock), version));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'get':
    console.log(readJsonVersion(read(F.packageJson)));
    break;
  case 'check': {
    const res = compareVersions(collect());
    if (!res.ok) {
      const lines = Object.entries(res.entries).map(([f, v]) => `  ${f}: ${v ?? '(fehlt)'}`);
      fail(`Versionen stimmen nicht überein:\n${lines.join('\n')}\nBeheben mit: node scripts/version.mjs set X.Y.Z`);
    }
    console.log(`Version ${res.version} ist überall gleich.`);
    break;
  }
  case 'bump': {
    if (!BUMPS.includes(arg)) fail(`Aufruf: node scripts/version.mjs bump <${BUMPS.join('|')}>`);
    const res = compareVersions(collect());
    if (!res.ok) fail('Versionen stimmen schon vorher nicht überein – erst „npm run version:check“ beheben.');
    const next = bumpVersion(res.version, arg);
    setAll(next);
    console.log(next);
    break;
  }
  case 'set':
    if (!arg) fail('Aufruf: node scripts/version.mjs set X.Y.Z');
    setAll(arg);
    console.log(arg);
    break;
  default:
    fail('Aufruf: node scripts/version.mjs <get|check|bump|set> [...]');
}
