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
}

export interface RuleDoc {
  match?: MatchSpec;
  responses?: ResponseOption[];
}

export type MetadataMap = Record<string, unknown>;
