import { readCsv } from './CsvUtils';

/** Safe / vulnerable / unknown - the 3 buckets every Qryptive status label falls into. */
export type StatusBucket = 'vulnerable' | 'safe' | 'unknown';
export type FindingType = 'Crypto' | 'Dependency' | 'Asset';

/**
 * One row of test-data/scan-repo.expected-findings.csv
 * Status "not-expected" = Qryptive should NOT report this (a false positive).
 * Known Issue (optional) = a known Qryptive problem with this row: reported, but does not fail the test.
 */
export interface ExpectedFinding {
  type: FindingType;
  category: string;
  algorithm: string;
  status: StatusBucket | 'not-expected';
  file: string;
  line: number | null; // null = dependency (no line)
  acceptLines: number[]; // e.g. a statement over 2 lines
  note: string;
  knownIssue: string;
}

/** One finding as shown on the Qryptive scan results page. */
export interface ActualFinding {
  type: FindingType;
  category: string;
  algorithm: string;
  statusLabel: string; // e.g. "Quantum Vulnerable"
  status: StatusBucket;
  file: string;
  line: number | null;
  tags: string[]; // e.g. ["Forgeable", "Code"]
}

export type ComparisonResult =
  | 'OK'
  | 'MISSING'
  | 'WRONG LINE'
  | 'WRONG STATUS'
  | 'WRONG CATEGORY'
  | 'FALSE POSITIVE'
  | 'EXTRA (not expected)';

export interface ComparisonRow {
  result: ComparisonResult;
  type: FindingType;
  algorithm: string;
  file: string;
  expectedLine: string;
  actualLine: string;
  expectedStatus: string;
  actualStatus: string;
  expectedCategory: string;
  actualCategory: string;
  tags: string;
  note: string;
  knownIssue: string;
  /** the actual finding, when one was matched */
  actual?: ActualFinding;
}

/** Qryptive status label -> bucket. */
export function toStatusBucket(label: string): StatusBucket {
  const l = label.toLowerCase();
  if (l.includes('vulnerable') || l.includes('broken') || l.includes('exposure')) return 'vulnerable';
  if (l.includes('safe') || l.includes('hybrid') || l.includes('secure')) return 'safe';
  return 'unknown';
}

/** Names Qryptive uses for the same algorithm family. */
const ALIASES: Record<string, string> = { ECC: 'EC', ECDSA: 'EC', EC: 'EC' };
const family = (alg: string) => ALIASES[alg.toUpperCase()] ?? alg.toUpperCase();

export function loadExpectedFindings(csvPath: string): ExpectedFinding[] {
  return readCsv(csvPath).map((r) => ({
    type: r['Type'] as FindingType,
    category: r['Category'],
    algorithm: r['Algorithm'],
    status: r['Status'].toLowerCase() as ExpectedFinding['status'],
    file: r['File'],
    line: r['Line'] ? Number(r['Line']) : null,
    acceptLines: r['Also Accept Lines'] ? r['Also Accept Lines'].split(';').map(Number) : [],
    note: r['Note'] ?? '',
    knownIssue: r['Known Issue'] ?? '',
  }));
}

/**
 * Compare expected vs actual findings. Each actual finding can match only one expected row.
 *   OK             - same algorithm, file and line; status and category also right
 *   WRONG STATUS   - found at the right place, but safe/vulnerable is different
 *   WRONG CATEGORY - found at the right place, but listed under another category
 *   WRONG LINE     - algorithm found in the file, but on another line
 *   MISSING        - not found at all
 *   FALSE POSITIVE - a "not-expected" row that Qryptive still reports
 *   EXTRA          - Qryptive shows it, but it is not in the expected list at all
 */
export function compareFindings(expected: ExpectedFinding[], actual: ActualFinding[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const unused = [...actual];
  const take = (pred: (a: ActualFinding) => boolean) => {
    const i = unused.findIndex(pred);
    return i === -1 ? undefined : unused.splice(i, 1)[0];
  };
  const sameAlg = (e: ExpectedFinding, a: ActualFinding) =>
    a.file === e.file && family(a.algorithm) === family(e.algorithm);
  const lineOk = (e: ExpectedFinding, a: ActualFinding) =>
    e.line === null || a.line === e.line || (a.line !== null && e.acceptLines.includes(a.line));

  const row = (result: ComparisonResult, e: ExpectedFinding | undefined, a: ActualFinding | undefined): ComparisonRow => ({
    result,
    type: (e ?? a)!.type,
    algorithm: e?.algorithm ?? a!.algorithm,
    file: e?.file ?? a!.file,
    expectedLine: e ? String(e.line ?? '-') + (e.acceptLines.length ? ` (or ${e.acceptLines.join('/')})` : '') : '',
    actualLine: a ? String(a.line ?? '-') : '',
    expectedStatus: e?.status ?? '',
    actualStatus: a ? `${a.status} (${a.statusLabel})` : '',
    expectedCategory: e?.category ?? '',
    actualCategory: a?.category ?? '',
    tags: a?.tags.join(' ') ?? '',
    note: e?.note ?? '',
    knownIssue: e?.knownIssue ?? '',
    actual: a,
  });

  // 1. rows that must NOT be reported (false positives)
  for (const e of expected.filter((x) => x.status === 'not-expected')) {
    const a = take((x) => sameAlg(e, x) && lineOk(e, x));
    rows.push(row(a ? 'FALSE POSITIVE' : 'OK', e, a));
  }
  // 2. exact place first (so duplicates on other lines do not steal a match)
  const pending: ExpectedFinding[] = [];
  for (const e of expected.filter((x) => x.status !== 'not-expected')) {
    const a = take((x) => sameAlg(e, x) && lineOk(e, x));
    if (!a) {
      pending.push(e);
      continue;
    }
    if (a.status !== e.status) rows.push(row('WRONG STATUS', e, a));
    else if (a.category !== e.category) rows.push(row('WRONG CATEGORY', e, a));
    else rows.push(row('OK', e, a));
  }
  // 3. same algorithm + file on a different line, otherwise missing
  for (const e of pending) {
    const a = take((x) => sameAlg(e, x));
    rows.push(row(a ? 'WRONG LINE' : 'MISSING', e, a));
  }
  // 4. whatever is left was not expected at all
  for (const a of unused) rows.push(row('EXTRA (not expected)', undefined, a));
  return rows;
}

/** One readable line for a row, e.g. "MISSING  RSA at java/.../StaticImportSigner.java:8". */
export function describeRow(r: ComparisonRow): string {
  const where = `${r.file}:${r.expectedLine || r.actualLine}`;
  const why = r.knownIssue ? ` [known issue: ${r.knownIssue}]` : r.note ? ` (${r.note})` : '';
  switch (r.result) {
    case 'OK':
      return `OK             ${r.algorithm} at ${where}`;
    case 'MISSING':
      return `MISSING        ${r.algorithm} at ${where}${why}`;
    case 'WRONG LINE':
      return `WRONG LINE     ${r.algorithm} in ${r.file}: expected line ${r.expectedLine}, shown on line ${r.actualLine}${why}`;
    case 'WRONG STATUS':
      return `WRONG STATUS   ${r.algorithm} at ${where}: expected ${r.expectedStatus}, shown ${r.actualStatus}${why}`;
    case 'WRONG CATEGORY':
      return `WRONG CATEGORY ${r.algorithm} at ${where}: expected "${r.expectedCategory}", shown "${r.actualCategory}"${why}`;
    case 'FALSE POSITIVE':
      return `FALSE POSITIVE ${r.algorithm} at ${r.file}:${r.actualLine} should not be reported${why}`;
    default:
      return `EXTRA          ${r.algorithm} at ${r.file}:${r.actualLine} (${r.actualStatus}, ${r.actualCategory}) - not in the expected list`;
  }
}

/**
 * Split the comparison into:
 *   failures     - new problems (fail the test)
 *   knownIssues  - problems already listed in the Known Issue column (reported only)
 *   fixedIssues  - rows with a Known Issue that now pass (remove the note from the CSV)
 */
export function summarize(rows: ComparisonRow[], results: ComparisonResult[]) {
  const relevant = rows.filter((r) => results.includes(r.result) || (r.result === 'OK' && r.knownIssue));
  return {
    failures: relevant.filter((r) => r.result !== 'OK' && !r.knownIssue).map(describeRow),
    knownIssues: relevant.filter((r) => r.result !== 'OK' && r.knownIssue).map(describeRow),
    fixedIssues: relevant
      .filter((r) => r.result === 'OK' && r.knownIssue)
      .map((r) => `${r.algorithm} at ${r.file}:${r.expectedLine} now works - remove its Known Issue note`),
  };
}

/** Comparison rows -> plain objects for the CSV report attachment. */
export function toReportRows(rows: ComparisonRow[]): Record<string, string>[] {
  return rows.map(({ actual: _actual, ...r }) => ({
    Result: r.result + (r.result !== 'OK' && r.knownIssue ? ' (known issue)' : ''),
    Type: r.type,
    Algorithm: r.algorithm,
    File: r.file,
    'Expected Line': r.expectedLine,
    'Actual Line': r.actualLine,
    'Expected Status': r.expectedStatus,
    'Actual Status': r.actualStatus,
    'Expected Category': r.expectedCategory,
    'Actual Category': r.actualCategory,
    Tags: r.tags,
    'Known Issue': r.knownIssue,
    Note: r.note,
  }));
}

/**
 * What Qryptive SHOULD show today, per row: the expected status, except for rows with a
 * Known Issue, where Qryptive's current behaviour is accepted (missing = not shown).
 * Used to work out the expected totals (summary numbers, Files tab counts).
 */
export function acceptedFindings(rows: ComparisonRow[]): { type: FindingType; category: string; file: string; status: StatusBucket }[] {
  const out: { type: FindingType; category: string; file: string; status: StatusBucket }[] = [];
  for (const r of rows) {
    if (r.result === 'EXTRA (not expected)') continue; // a real failure - reported by the findings checks
    if (r.knownIssue && r.result !== 'OK') {
      if (r.actual) out.push({ type: r.type, category: r.actual.category, file: r.file, status: r.actual.status });
    } else if (r.expectedStatus && r.expectedStatus !== 'not-expected') {
      out.push({ type: r.type, category: r.expectedCategory, file: r.file, status: r.expectedStatus as StatusBucket });
    }
  }
  return out;
}

/** Expected Files tab: file -> number of vulnerable / safe / unknown findings. */
export function expectedFileCounts(rows: ComparisonRow[]): Map<string, Record<StatusBucket, number>> {
  const files = new Map<string, Record<StatusBucket, number>>();
  for (const f of acceptedFindings(rows)) {
    const counts = files.get(f.file) ?? { vulnerable: 0, safe: 0, unknown: 0 };
    counts[f.status]++;
    files.set(f.file, counts);
  }
  return files;
}

/**
 * If every file Qryptive shows is inside one extra top folder that the expected
 * paths do not have (e.g. "qx-coverage-suite/python/..." vs "python/..."), return
 * that folder ("qx-coverage-suite/") so it can be removed before comparing.
 */
export function detectExtraRootFolder(actualFiles: string[], expectedFiles: string[]): string {
  const firstFolders = new Set(actualFiles.map((f) => (f.includes('/') ? f.split('/')[0] : '')));
  if (firstFolders.size !== 1) return '';
  const folder = [...firstFolders][0];
  if (!folder || expectedFiles.some((f) => f.startsWith(folder + '/'))) return '';
  return folder + '/';
}
