import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(__dirname, '..', 'logs', 'execution.log');

/** Simple logger: prints to the console and saves to logs/execution.log */
export class Logger {
  static info(message: string): void {
    Logger.write('INFO', message);
  }

  static error(message: string): void {
    Logger.write('ERROR', message);
  }

  private static write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
  }
}
