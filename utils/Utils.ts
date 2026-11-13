import fs from 'fs';

/**
 * Read a value from .env (or the terminal environment).
 * Throws a clear error if it is missing.
 */
export function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing. Please add it to your .env file.`);
  }
  return value;
}

/**
 * Ask a question in the terminal and return the typed answer.
 * Returns '' when there is no terminal (for example in CI).
 */
export function askQuestion(question: string): string {
  if (!process.stdin.isTTY) {
    return '';
  }
  process.stdout.write(question);
  const buffer = Buffer.alloc(1024);
  try {
    const bytes = fs.readSync(process.stdin.fd, buffer, 0, buffer.length, null);
    return buffer.toString('utf8', 0, bytes).trim();
  } catch {
    return '';
  }
}
