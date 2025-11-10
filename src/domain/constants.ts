export const ASSET_AUDIT_EVENTS = {
  UPLOAD_REPLACED: 'asset.upload.replaced',
  BUNDLE_ACTIVATED: 'asset.bundle.activated',
  BUNDLE_VALIDATED: 'asset.bundle.validated',
  CACHE_REFRESHED: 'asset.cache.refreshed',
} as const;

export const GRPCURL_AUDIT_EVENTS = {
  RUN_PASS: 'docker.grpcurl.pass',
  RUN_FAIL: 'docker.grpcurl.fail',
  RUN_ERROR: 'docker.grpcurl.error',
} as const;

export type AssetAuditEvent = typeof ASSET_AUDIT_EVENTS[keyof typeof ASSET_AUDIT_EVENTS];
export type GrpcurlAuditEvent = typeof GRPCURL_AUDIT_EVENTS[keyof typeof GRPCURL_AUDIT_EVENTS];

