import type { AssetStore } from '../../infrastructure/assetStore.js';
import { ASSET_AUDIT_EVENTS } from '../constants.js';

export interface RefreshResult {
  success: boolean;
  bundle_version: string;
  checksums: {
    proto_count: number;
    rule_count: number;
  };
  errors?: string[];
}

export class RefreshAssetsUseCase {
  constructor(
    private assetStore: AssetStore,
    private logger: (event: string, data: unknown) => void
  ) {}

  async execute(): Promise<RefreshResult> {
    const version = this.assetStore.getCurrentBundleVersion();
    
    if (!version) {
      return {
        success: false,
        bundle_version: 'none',
        checksums: { proto_count: 0, rule_count: 0 },
        errors: ['No active bundle found']
      };
    }

    try {
      const bundle = this.assetStore.getActiveBundle();
      
      if (!bundle) {
        return {
          success: false,
          bundle_version: version,
          checksums: { proto_count: 0, rule_count: 0 },
          errors: ['Failed to load active bundle']
        };
      }

      this.logger(ASSET_AUDIT_EVENTS.CACHE_REFRESHED, {
        bundle_version: version,
        proto_count: bundle.proto_assets.length,
        rule_count: bundle.rule_assets.length,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        bundle_version: version,
        checksums: {
          proto_count: bundle.proto_assets.length,
          rule_count: bundle.rule_assets.length
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        bundle_version: version,
        checksums: { proto_count: 0, rule_count: 0 },
        errors: [errorMsg]
      };
    }
  }
}

