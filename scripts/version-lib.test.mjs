import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  compareVersions,
  parseVersion,
  readCargoLockVersion,
  readCargoTomlVersion,
  readPackageLockVersions,
  writeCargoLockVersion,
  writeCargoTomlVersion,
  writeJsonVersion,
  writePackageLockVersion,
} from './version-lib.mjs';

describe('bumpVersion', () => {
  it('erhöht patch, minor und major nach SemVer', () => {
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(bumpVersion('0.1.9', 'patch')).toBe('0.1.10');
    expect(bumpVersion('0.1.7', 'minor')).toBe('0.2.0');
    expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0');
  });
  it('lehnt unbekannte Erhöhungen und kaputte Versionen ab', () => {
    expect(() => bumpVersion('1.0.0', 'mega')).toThrow();
    expect(() => bumpVersion('1.0', 'patch')).toThrow();
    expect(() => bumpVersion('v1.0.0', 'patch')).toThrow();
    expect(() => bumpVersion('1.0.0-beta.1', 'patch')).toThrow();
    expect(() => parseVersion('01.0.0')).toThrow();
  });
});

const cargoToml = `[package]
name = "kladdy"
version = "0.1.0"
edition = "2024"

[dependencies]
serde = { version = "1", features = ["derive"] }
other = { version = "0.1.0" }
`;

const cargoLock = `version = 4

[[package]]
name = "kl"
version = "0.1.0"

[[package]]
name = "kladdy"
version = "0.1.0"
dependencies = [
 "serde",
]

[[package]]
name = "kladdy-extra"
version = "0.1.0"
`;

describe('Cargo-Dateien', () => {
  it('ändert nur die Paketversion in Cargo.toml', () => {
    const out = writeCargoTomlVersion(cargoToml, '0.2.0');
    expect(readCargoTomlVersion(out)).toBe('0.2.0');
    expect(out).toContain('other = { version = "0.1.0" }');
    expect(out).toContain('serde = { version = "1"');
  });
  it('ändert nur den Eintrag „kladdy“ in Cargo.lock', () => {
    const out = writeCargoLockVersion(cargoLock, '1.0.0');
    expect(readCargoLockVersion(out)).toBe('1.0.0');
    expect(readCargoLockVersion(out, 'kl')).toBe('0.1.0');
    expect(readCargoLockVersion(out, 'kladdy-extra')).toBe('0.1.0');
    expect(out.startsWith('version = 4')).toBe(true);
  });
});

describe('JSON-Dateien', () => {
  it('setzt beide Versionsfelder in package-lock.json', () => {
    const lock = JSON.stringify({ name: 'kladdy', version: '0.1.0', packages: { '': { version: '0.1.0' }, 'node_modules/x': { version: '0.1.0' } } });
    const out = writePackageLockVersion(lock, '0.1.1');
    expect(readPackageLockVersions(out)).toEqual(['0.1.1', '0.1.1']);
    expect(JSON.parse(out).packages['node_modules/x'].version).toBe('0.1.0');
  });
  it('schreibt mit zwei Leerzeichen und Zeilenumbruch am Ende', () => {
    expect(writeJsonVersion('{"name":"a","version":"1.0.0"}', '1.0.1')).toBe('{\n  "name": "a",\n  "version": "1.0.1"\n}\n');
  });
});

describe('compareVersions', () => {
  it('erkennt Gleichstand und Abweichungen', () => {
    expect(compareVersions({ a: '1.0.0', b: '1.0.0' })).toMatchObject({ ok: true, version: '1.0.0' });
    expect(compareVersions({ a: '1.0.0', b: '1.0.1' }).ok).toBe(false);
    expect(compareVersions({ a: '1.0.0', b: undefined }).ok).toBe(false);
  });
});
