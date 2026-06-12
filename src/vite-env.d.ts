/// <reference types="vite/client" />

type ClientMode = 'remote' | 'local';

type ClientConfig = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  hasPassword: boolean;
};

type ConnectionTestResult = {
  ok: boolean;
  error?: string;
  health?: Record<string, unknown>;
  config: ClientConfig;
};

type AssetResponse = {
  ok: boolean;
  status: number;
  contentType: string;
  data: string;
};

type ServiceStatus = {
  mode: ClientMode;
  running: boolean;
  baseUrl: string;
  localServiceAvailable: boolean;
  error?: string;
};

interface Window {
  waConfig: {
    get(): Promise<ClientConfig>;
    set(input: Partial<ClientConfig> & { password?: string }): Promise<ClientConfig>;
    testConnection(input?: Partial<ClientConfig> & { password?: string }): Promise<ConnectionTestResult>;
  };
  waApi: {
    request<T>(input: { path: string; method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }): Promise<T>;
    fetchAsset(path: string): Promise<AssetResponse>;
  };
  waService: {
    status(): Promise<ServiceStatus>;
    start(): Promise<ServiceStatus>;
    stop(): Promise<ServiceStatus>;
  };
  waDesktop: {
    waConfig: {
      get(): Promise<ClientConfig>;
      set(input: Partial<ClientConfig> & { password?: string }): Promise<ClientConfig>;
      testConnection(input?: Partial<ClientConfig> & { password?: string }): Promise<ConnectionTestResult>;
    };
    waApi: {
      request<T>(input: { path: string; method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }): Promise<T>;
      fetchAsset(path: string): Promise<AssetResponse>;
    };
    waService: {
      status(): Promise<ServiceStatus>;
      start(): Promise<ServiceStatus>;
      stop(): Promise<ServiceStatus>;
    };
  };
}
