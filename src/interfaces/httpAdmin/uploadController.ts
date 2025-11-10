import { Request, Response } from 'express';
import multer from 'multer';
import { AssetStore } from '../../infrastructure/assetStore.js';
import { RefreshAssetsUseCase } from '../../domain/usecases/refreshAssets.js';
import { ASSET_AUDIT_EVENTS } from '../../domain/constants.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createUploadController(
  assetStore: AssetStore,
  logger: (event: string, data: unknown) => void
) {
  const refreshUseCase = new RefreshAssetsUseCase(assetStore, logger);

  const uploadProto = [
    upload.single('file'),
    async (req: any, res: any) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'Missing file field in upload' });
        }

        const filename = req.file.originalname;
        if (!filename.endsWith('.proto')) {
          return res.status(400).json({ error: 'File must have .proto extension' });
        }

        const content = req.file.buffer.toString('utf-8');
        if (!content.includes('syntax') && !content.includes('package')) {
          return res.status(400).json({ error: 'Invalid proto file format' });
        }

        const version = new Date().toISOString().replace(/[:.]/g, '-');
        const asset = assetStore.storeProtoAsset(filename, content, version);

        const currentVersion = assetStore.getCurrentBundleVersion();
        const currentChecksum = currentVersion ? assetStore.getBundleChecksum(currentVersion) : null;
        const newChecksum = assetStore.getBundleChecksum(version);

        if (currentChecksum === newChecksum) {
          return res.status(409).json({
            error: 'Bundle checksum matches active version',
            bundle_version: currentVersion,
            checksum: currentChecksum
          });
        }

        assetStore.activateBundle(version, req.headers['x-user-id'] as string || 'anonymous');

        logger(ASSET_AUDIT_EVENTS.UPLOAD_REPLACED, {
          type: 'proto',
          filename,
          bundle_version: version,
          checksum: asset.checksum_sha256,
          actor: req.headers['x-user-id'] || 'anonymous',
          timestamp: new Date().toISOString()
        });

        await refreshUseCase.execute();

        res.status(202).json({
          bundle_version: version,
          checksum: asset.checksum_sha256,
          filename
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: `Upload failed: ${errorMsg}` });
      }
    }
  ];

  const uploadRule = [
    upload.single('file'),
    async (req: any, res: any) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'Missing file field in upload' });
        }

        const filename = req.file.originalname;
        if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
          return res.status(400).json({ error: 'File must have .yaml or .yml extension' });
        }

        const content = req.file.buffer.toString('utf-8');
        
        try {
          const yaml = await import('js-yaml');
          yaml.load(content);
        } catch {
          return res.status(400).json({ error: 'Invalid YAML format' });
        }

        const version = new Date().toISOString().replace(/[:.]/g, '-');
        const asset = assetStore.storeRuleAsset(filename, content, version);

        const currentVersion = assetStore.getCurrentBundleVersion();
        const currentChecksum = currentVersion ? assetStore.getBundleChecksum(currentVersion) : null;
        const newChecksum = assetStore.getBundleChecksum(version);

        if (currentChecksum === newChecksum) {
          return res.status(409).json({
            error: 'Bundle checksum matches active version',
            bundle_version: currentVersion,
            checksum: currentChecksum
          });
        }

        assetStore.activateBundle(version, req.headers['x-user-id'] as string || 'anonymous');

        logger(ASSET_AUDIT_EVENTS.UPLOAD_REPLACED, {
          type: 'rule',
          filename,
          bundle_version: version,
          checksum: asset.checksum_sha256,
          actor: req.headers['x-user-id'] || 'anonymous',
          timestamp: new Date().toISOString()
        });

        await refreshUseCase.execute();

        res.status(202).json({
          bundle_version: version,
          checksum: asset.checksum_sha256,
          filename
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: `Upload failed: ${errorMsg}` });
      }
    }
  ];

  const refreshAssets = async (_req: any, res: any) => {
    try {
      const result = await refreshUseCase.execute();
      
      if (!result.success) {
        return res.status(500).json({
          status: 'failed',
          errors: result.errors
        });
      }

      res.status(200).json({
        status: 'reloaded',
        bundle_version: result.bundle_version,
        checksums: result.checksums
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Refresh failed: ${errorMsg}` });
    }
  };

  return {
    uploadProto,
    uploadRule,
    refreshAssets
  };
}

