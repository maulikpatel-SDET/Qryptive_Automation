import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { askQuestion } from './Utils';

/** Settings of one environment (one block in environment.yaml). */
export interface EnvConfig {
  name: string;
  baseUrl: string;
  loginPath: string;
  dashboardPath: string;
}

const ENVIRONMENTS = ['qa', 'staging', 'production'];

/**
 * Find out which environment to use:
 * 1. ENV from the terminal (ENV=qa npx playwright test)
 * 2. otherwise ask in the console
 * 3. if nothing is typed (or no console), use "qa"
 */
export function getEnvironmentName(): string {
  let env = process.env.ENV;

  if (!env) {
    env = askQuestion('Select environment (qa / staging / production) [qa]: ') || 'qa';
  }

  env = env.toLowerCase();
  if (!ENVIRONMENTS.includes(env)) {
    throw new Error(`Unknown environment "${env}". Use: ${ENVIRONMENTS.join(', ')}`);
  }

  // Save the choice so Playwright workers use the same environment (and don't ask again).
  process.env.ENV = env;
  return env;
}

/** Read environment.yaml and return the settings of the selected environment. */
export function getConfig(): EnvConfig {
  const filePath = path.join(__dirname, '..', 'config', 'environment.yaml');
  const allEnvironments = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  return allEnvironments[getEnvironmentName()];
}
