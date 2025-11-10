import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import type { ProtoAsset, RuleAsset, AssetBundle } from '../domain/types.js';

export class AssetStore {
  private uploadsDir: string;

  constructor(uploadsDir = 'uploads') {
    this.uploadsDir = uploadsDir;
  }

  private ensureDir(path: string): void {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  private calculateChecksum(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  getCurrentBundleVersion(): string | null {
    const currentFile = join(this.uploadsDir, 'current.json');
    if (!existsSync(currentFile)) {
      return null;
    }
    try {
      const content = JSON.parse(readFileSync(currentFile, 'utf-8'));
      return content.version || null;
    } catch {
      return null;
    }
  }

  getActiveBundle(): AssetBundle | null {
    const version = this.getCurrentBundleVersion();
    if (!version) return null;

    const protosDir = join(this.uploadsDir, 'protos', version);
    const rulesDir = join(this.uploadsDir, 'rules', version);

    const proto_assets: ProtoAsset[] = [];
    const rule_assets: RuleAsset[] = [];

    if (existsSync(protosDir)) {
      const files = readdirSync(protosDir);
      for (const file of files) {
        const filePath = join(protosDir, file);
        if (statSync(filePath).isFile() && file.endsWith('.proto')) {
          const content = readFileSync(filePath, 'utf-8');
          proto_assets.push({
            filename: file,
            bundle_version: version,
            checksum_sha256: this.calculateChecksum(content),
            source_path: filePath,
            service_count: (content.match(/service\s+\w+/g) || []).length,
            updated_at: statSync(filePath).mtime.toISOString()
          });
        }
      }
    }

    if (existsSync(rulesDir)) {
      const files = readdirSync(rulesDir);
      for (const file of files) {
        const filePath = join(rulesDir, file);
        if (statSync(filePath).isFile() && (file.endsWith('.yaml') || file.endsWith('.yml'))) {
          const content = readFileSync(filePath, 'utf-8');
          rule_assets.push({
            filename: file,
            bundle_version: version,
            targets: [],
            checksum_sha256: this.calculateChecksum(content),
            updated_at: statSync(filePath).mtime.toISOString()
          });
        }
      }
    }

    return {
      bundle_version: version,
      created_by: 'system',
      activation_pointer: true,
      proto_assets,
      rule_assets
    };
  }

  storeProtoAsset(filename: string, content: string | Buffer, version: string): ProtoAsset {
    const versionDir = join(this.uploadsDir, 'protos', version);
    this.ensureDir(versionDir);

    const filePath = join(versionDir, filename);
    writeFileSync(filePath, content);

    const contentStr = typeof content === 'string' ? content : content.toString('utf-8');
    return {
      filename,
      bundle_version: version,
      checksum_sha256: this.calculateChecksum(content),
      source_path: filePath,
      service_count: (contentStr.match(/service\s+\w+/g) || []).length,
      updated_at: new Date().toISOString()
    };
  }

  storeRuleAsset(filename: string, content: string | Buffer, version: string): RuleAsset {
    const versionDir = join(this.uploadsDir, 'rules', version);
    this.ensureDir(versionDir);

    const filePath = join(versionDir, filename);
    writeFileSync(filePath, content);

    return {
      filename,
      bundle_version: version,
      targets: [],
      checksum_sha256: this.calculateChecksum(content),
      updated_at: new Date().toISOString()
    };
  }

  activateBundle(version: string, createdBy = 'system'): void {
    const currentFile = join(this.uploadsDir, 'current.json');
    const pointer = {
      version,
      created_by: createdBy,
      updated_at: new Date().toISOString()
    };
    writeFileSync(currentFile, JSON.stringify(pointer, null, 2));
  }

  listBundleVersions(): string[] {
    const protosDir = join(this.uploadsDir, 'protos');
    if (!existsSync(protosDir)) {
      return [];
    }
    return readdirSync(protosDir)
      .filter(name => statSync(join(protosDir, name)).isDirectory())
      .sort()
      .reverse();
  }

  getBundleChecksum(version: string): string {
    const protosDir = join(this.uploadsDir, 'protos', version);
    const rulesDir = join(this.uploadsDir, 'rules', version);
    
    const checksums: string[] = [];

    if (existsSync(protosDir)) {
      const files = readdirSync(protosDir).sort();
      for (const file of files) {
        const filePath = join(protosDir, file);
        if (statSync(filePath).isFile()) {
          const content = readFileSync(filePath);
          checksums.push(this.calculateChecksum(content));
        }
      }
    }

    if (existsSync(rulesDir)) {
      const files = readdirSync(rulesDir).sort();
      for (const file of files) {
        const filePath = join(rulesDir, file);
        if (statSync(filePath).isFile()) {
          const content = readFileSync(filePath);
          checksums.push(this.calculateChecksum(content));
        }
      }
    }

    return this.calculateChecksum(checksums.join(''));
  }
}

