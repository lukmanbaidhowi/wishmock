export interface GrpcPorts {
  plaintext: number | string;
  tls?: number | string;
  tls_enabled: boolean;
  mtls?: boolean;
  tls_error?: string | null;
}

export interface ProtoInfo {
  loaded: string[];
  skipped: { file: string; status?: string; error?: string }[];
}

export interface ConnectRpcInfo {
  enabled: boolean;
  port?: number;
  cors_enabled: boolean;
  cors_origins?: string[];
  tls_enabled: boolean;
  error?: string | null;
  services: string[];
  reflection_enabled?: boolean;
  metrics?: {
    requests_total: number;
    requests_by_protocol: {
      connect: number;
      grpc_web: number;
      grpc: number;
    };
    errors_total: number;
  };
}

/**
 * Shared metrics tracked across both gRPC and Connect RPC servers
 */
export interface SharedMetricsInfo {
  validation: {
    checks_total: number;
    failures_total: number;
    failures_by_type: Record<string, number>;
  };
  rule_matching: {
    attempts_total: number;
    matches_total: number;
    misses_total: number;
    matches_by_rule: Record<string, number>;
  };
}

/**
 * Validation coverage information
 */
export interface ValidationInfo {
  enabled: boolean;
  source?: string;
  mode?: string;
  message_cel?: string;
  coverage?: {
    total_types: number;
    validated_types: number;
    types: string[];
  };
}

/**
 * Reload information
 */
export interface ReloadInfo {
  last_triggered?: string;
  mode?: string;
  downtime_detected?: boolean;
}

export interface StatusResponse {
  // Backward compatibility - legacy single port field
  grpc_port?: number | string;
  
  // Native gRPC server status
  grpc_ports?: GrpcPorts;
  
  // Connect RPC server status
  connect_rpc?: ConnectRpcInfo;
  
  // Service and rule information
  loaded_services: string[];
  rules: string[];
  protos?: ProtoInfo;
  
  // Validation information
  validation?: ValidationInfo;
  
  // Reload information
  reload?: ReloadInfo;
  
  // Shared metrics across both servers
  shared_metrics?: SharedMetricsInfo;
}

export interface ServiceMethod {
  name: string;
  full_method: string;
  rule_key: string;
  request_type: string;
  response_type: string;
  request_stream: boolean;
  response_stream: boolean;
}

export interface Service {
  name: string;
  package: string;
  service: string;
  methods: ServiceMethod[];
}

export interface ServicesResponse {
  services: Service[];
}
