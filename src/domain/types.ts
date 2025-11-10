export interface MatchSpec {
  metadata?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

export interface ResponseOption {
  when?: Record<string, unknown>;
  body?: unknown;
  trailers?: Record<string, string | number | boolean>;
  delay_ms?: number;
  // Higher number wins among matched candidates; defaults to 0
  priority?: number;
  // For server streaming: array of response bodies to stream
  stream_items?: unknown[];
  // Delay between stream items in ms (default: 100)
  stream_delay_ms?: number;
  // Loop stream_items forever while connection is alive
  stream_loop?: boolean;
  // Randomize order of stream_items in each loop iteration
  stream_random_order?: boolean;
}

export interface RuleDoc {
  match?: MatchSpec;
  responses?: ResponseOption[];
}

export type MetadataMap = Record<string, unknown>;

export interface ProtoAsset {
  filename: string;
  bundle_version: string;
  checksum_sha256: string;
  source_path: string;
  service_count: number;
  updated_at: string;
}

export interface RuleAsset {
  filename: string;
  bundle_version: string;
  targets: string[];
  priority?: number;
  checksum_sha256: string;
  updated_at: string;
}

export interface AssetBundle {
  bundle_version: string;
  created_by: string;
  activation_pointer: boolean;
  validation_report?: {
    descriptor_generation: boolean;
    rule_validation: boolean;
    errors?: string[];
  };
  proto_assets: ProtoAsset[];
  rule_assets: RuleAsset[];
}
