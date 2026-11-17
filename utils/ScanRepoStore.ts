import fs from 'fs';
import path from 'path';
import { Logger } from './Logger';

/**
 * Remembers which GitHub repo the last scan test created, so other spec files
 * (e.g. tests/sources/repositories-last-scan.spec.ts) check the same repo.
 *
 * Written by:  tests/sources/github-repo-scan.spec.ts (after the repo is scanned)
 * Read by:     tests/sources/repositories-last-scan.spec.ts
 * File:        test-data/last-scanned-repo.json (local only, not committed)
 */
const STORE_FILE = path.join(__dirname, '..', 'test-data', 'last-scanned-repo.json');

export interface ScannedRepo {
  fullName: string; // e.g. "maulikpatel-SDET/qx-scan-e2e-20261117081621"
  scannedAt: string; // ISO date
}

export class ScanRepoStore {
  static save(fullName: string): void {
    const data: ScannedRepo = { fullName, scannedAt: new Date().toISOString() };
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2) + '\n');
    Logger.info(`Saved last scanned repo: ${fullName}`);
  }

  /** The last scanned repo, or null if no scan test has run on this machine yet. */
  static load(): ScannedRepo | null {
    if (!fs.existsSync(STORE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as ScannedRepo;
  }
}
