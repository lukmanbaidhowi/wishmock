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

export interface StatusResponse {
  grpc_port?: number | string; // Back-compat
  grpc_ports?: GrpcPorts;
  connect_rpc?: ConnectRpcInfo;
  loaded_services: string[];
  rules: string[];
  protos?: ProtoInfo;
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
