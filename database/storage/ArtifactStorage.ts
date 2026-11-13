import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT, getArtifactDir } from '../db.config';
import type { ArtifactFile, StoredArtifact } from '../types';

/**
 * Stores artifact files on the local filesystem:
 *   artifacts/<run uuid>/<test case>/attempt-<n>/<file>
 *
 * Only the path + metadata go to PostgreSQL. To use S3 / Azure later, create another class
 * with the same `save()` method and return storageType 'S3' / 'AZURE'.
 */
export class ArtifactStorage {
  constructor(private readonly rootDir: string = getArtifactDir()) {}

  save(folder: string, file: ArtifactFile): StoredArtifact | null {
    const targetDir = path.join(this.rootDir, folder);
    const target = path.join(targetDir, file.fileName);
    fs.mkdirSync(targetDir, { recursive: true });

    if (file.sourcePath) {
      if (!fs.existsSync(file.sourcePath)) return null;
      fs.copyFileSync(file.sourcePath, target);
    } else if (file.content !== undefined) {
      fs.writeFileSync(target, file.content);
    } else {
      return null;
    }

    const data = fs.readFileSync(target);
    return {
      type: file.type,
      fileName: file.fileName,
      filePath: path.relative(PROJECT_ROOT, target),
      storageType: 'LOCAL',
      contentType: file.contentType,
      sizeBytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };
  }
}
