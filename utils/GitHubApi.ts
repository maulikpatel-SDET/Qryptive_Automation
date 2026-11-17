import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import sodium from 'libsodium-wrappers';
import { Logger } from './Logger';
import { sleep } from './WaitUtils';

const API = 'https://api.github.com';

/** Folders/files from the zip that are never pushed. */
const SKIP_NAMES = new Set(['.git', '__MACOSX', '.DS_Store', 'node_modules']);

export interface WorkflowRun {
  id: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | ...
  html_url: string;
}

/**
 * Small GitHub REST client used by the repo-scan tests.
 * Everything that happens on github.com (create repo, push code, add secret,
 * commit workflow, delete repo) is done through the API: logging in to the
 * GitHub website from automation is blocked by 2FA / device verification.
 *
 * Token needs: classic PAT with scopes `repo`, `workflow`, `delete_repo`
 * (fine-grained: Administration, Contents, Secrets, Workflows, Actions = read/write).
 */
export class GitHubApi {
  constructor(
    private readonly token: string,
    readonly owner: string,
  ) {}

  // ---------- Low-level request ----------

  private async request<T = any>(method: string, url: string, body?: unknown, okStatuses = [200, 201, 204]): Promise<T> {
    const response = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'qryptive-automation',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!okStatuses.includes(response.status)) {
      const text = await response.text();
      throw new Error(`GitHub ${method} ${url} failed: ${response.status} ${text.slice(0, 300)}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  // ---------- Repository ----------

  /** Create a repo under the owner (user account or organization). Returns the default branch. */
  async createRepo(name: string, isPrivate: boolean): Promise<string> {
    const me = await this.request<{ login: string }>('GET', '/user');
    const isUser = me.login.toLowerCase() === this.owner.toLowerCase();
    const url = isUser ? '/user/repos' : `/orgs/${this.owner}/repos`;

    // auto_init creates a first commit (README) - the Git Data API cannot push to an empty repo.
    const repo = await this.request<{ default_branch: string }>('POST', url, {
      name,
      private: isPrivate,
      auto_init: true,
      description: 'Temporary repo created by Qryptive automation (repo scan test)',
    });
    Logger.info(`GitHub repo created: ${this.owner}/${name} (branch ${repo.default_branch})`);
    return repo.default_branch;
  }

  async repoExists(name: string): Promise<boolean> {
    const response = await fetch(`${API}/repos/${this.owner}/${name}`, {
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': 'qryptive-automation' },
    });
    return response.status === 200;
  }

  async deleteRepo(name: string): Promise<void> {
    await this.request('DELETE', `/repos/${this.owner}/${name}`, undefined, [204, 404]);
    Logger.info(`GitHub repo deleted: ${this.owner}/${name}`);
  }

  // ---------- Push code from a zip ----------

  /**
   * Unzip `zipPath` and push all of its files to `branch` in ONE commit.
   * If the zip has ONE top-level folder (e.g. qx-coverage-suite/ next to a push_repo.sh),
   * the files inside that folder become the repo root - like pushing that folder by hand.
   */
  async pushZip(repo: string, branch: string, zipPath: string, message: string): Promise<string> {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qx-scan-'));
    try {
      execFileSync('unzip', ['-q', '-o', zipPath, '-d', workDir]);
      let root = workDir;
      const top = fs.readdirSync(workDir).filter((n) => !SKIP_NAMES.has(n));
      const topDirs = top.filter((n) => fs.statSync(path.join(workDir, n)).isDirectory());
      if (topDirs.length === 1) {
        root = path.join(workDir, topDirs[0]);
        const ignored = top.filter((n) => n !== topDirs[0]);
        Logger.info(`Using ${topDirs[0]}/ as repo root${ignored.length ? ` (not pushed: ${ignored.join(', ')})` : ''}`);
      }

      const files = listFiles(root);
      if (files.length === 0) throw new Error(`Zip ${zipPath} contains no files`);
      Logger.info(`Pushing ${files.length} files from ${path.basename(zipPath)} to ${this.owner}/${repo}`);

      const tree = [];
      for (const rel of files) {
        const blob = await this.request<{ sha: string }>('POST', `/repos/${this.owner}/${repo}/git/blobs`, {
          content: fs.readFileSync(path.join(root, rel)).toString('base64'),
          encoding: 'base64',
        });
        tree.push({ path: rel.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
      }
      return await this.commitTree(repo, branch, tree, message);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** Add or update one file (e.g. the workflow YAML). Returns the new commit SHA. */
  async putFile(repo: string, branch: string, filePath: string, content: string, message: string): Promise<string> {
    const blob = await this.request<{ sha: string }>('POST', `/repos/${this.owner}/${repo}/git/blobs`, {
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    });
    const sha = await this.commitTree(repo, branch, [{ path: filePath, mode: '100644', type: 'blob', sha: blob.sha }], message);
    Logger.info(`Committed ${filePath} to ${this.owner}/${repo}@${branch} (${sha.slice(0, 7)})`);
    return sha;
  }

  private async commitTree(repo: string, branch: string, tree: object[], message: string): Promise<string> {
    const base = `/repos/${this.owner}/${repo}/git`;
    const ref = await this.request<{ object: { sha: string } }>('GET', `${base}/ref/heads/${branch}`);
    const parent = await this.request<{ tree: { sha: string } }>('GET', `${base}/commits/${ref.object.sha}`);
    const newTree = await this.request<{ sha: string }>('POST', `${base}/trees`, { base_tree: parent.tree.sha, tree });
    const commit = await this.request<{ sha: string }>('POST', `${base}/commits`, {
      message,
      tree: newTree.sha,
      parents: [ref.object.sha],
    });
    await this.request('PATCH', `${base}/refs/heads/${branch}`, { sha: commit.sha });
    return commit.sha;
  }

  // ---------- Secrets ----------

  /** Add (or replace) an Actions secret in the repo. The value is encrypted with the repo's public key. */
  async setSecret(repo: string, name: string, value: string): Promise<void> {
    await sodium.ready;
    const key = await this.request<{ key: string; key_id: string }>(
      'GET',
      `/repos/${this.owner}/${repo}/actions/secrets/public-key`,
    );
    const encrypted = sodium.crypto_box_seal(
      sodium.from_string(value),
      sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL),
    );
    await this.request('PUT', `/repos/${this.owner}/${repo}/actions/secrets/${name}`, {
      encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
      key_id: key.key_id,
    });
    Logger.info(`Secret ${name} added to ${this.owner}/${repo}`); // the value is never logged
  }

  async secretExists(repo: string, name: string): Promise<boolean> {
    const response = await fetch(`${API}/repos/${this.owner}/${repo}/actions/secrets/${name}`, {
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': 'qryptive-automation' },
    });
    return response.status === 200;
  }

  // ---------- Actions ----------

  /** Wait until the workflow run started by `commitSha` finishes. Returns the finished run. */
  async waitForWorkflowRun(repo: string, commitSha: string, timeoutMs: number): Promise<WorkflowRun> {
    const endTime = Date.now() + timeoutMs;
    let lastStatus = 'not started';
    while (Date.now() < endTime) {
      const data = await this.request<{ workflow_runs: WorkflowRun[] }>(
        'GET',
        `/repos/${this.owner}/${repo}/actions/runs?head_sha=${commitSha}&per_page=5`,
      );
      const run = data.workflow_runs[0];
      if (run) {
        if (run.status !== lastStatus) Logger.info(`Workflow run ${run.id}: ${run.status}`);
        lastStatus = run.status;
        if (run.status === 'completed') return run;
      }
      await sleep(15_000);
    }
    throw new Error(`Workflow run for ${commitSha.slice(0, 7)} did not finish in ${timeoutMs / 60_000} min (last: ${lastStatus})`);
  }
}

/** All files under `dir` (relative paths), skipping .git, __MACOSX, ... */
function listFiles(dir: string, prefix = ''): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(dir, rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}
