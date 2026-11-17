import fs from 'fs';

/** Split one CSV line into cells (supports "quoted, values" and "" inside quotes). */
function parseLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** Read a CSV file with a header row -> one object per row, keyed by the header names. */
export function readCsv(filePath: string): Record<string, string>[] {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));
  });
}

/** Turn rows into CSV text (for report attachments). */
export function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return '';
  const header = Object.keys(rows[0]);
  const escape = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [header.join(','), ...rows.map((r) => header.map((h) => escape(r[h] ?? '')).join(','))].join('\n') + '\n';
}
