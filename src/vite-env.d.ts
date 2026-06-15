/// <reference types="vite/client" />

type ClientMode = 'remote' | 'local';

type ClientConfig = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  smsbower: SMSBowerPublicConfig;
  hasPassword: boolean;
  authPasswordRef: string;
};

type SMSBowerPublicConfig = {
  enabled: boolean;
  country: string;
  minPrice: number;
  maxPrice: number;
  targetSuccessCount: number;
  maxOrders: number;
  numberIntervalSeconds: number;
  pollIntervalSeconds: number;
  otpTimeoutSeconds: number;
  hasApiKey: boolean;
  configured: boolean;
};

type SMSBowerConfigPatch = Partial<Omit<SMSBowerPublicConfig, 'hasApiKey' | 'configured'>>;

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

type SMSBowerStatusResult = {
  status: 'waiting' | 'ok' | 'cancelled' | 'error';
  code?: string;
  error?: string;
  raw: string;
};

type SMSBowerNumberResult = {
  activationId: string;
  phone: string;
};

type SMSBowerPrice = {
  country: string;
  service: string;
  cost: number;
  count: number;
};

type OpenAIPhoneCheckInput = {
  requestId: string;
  phoneNumber: string;
  countryCallingCode?: string;
  nationalNumber?: string;
  countryIso2?: string;
  mode?: 'page' | 'api';
  timeoutMs?: number;
};

type OpenAIPhoneCheckResult = {
  requestId: string;
  phoneNumber?: string;
  status: 'used' | 'sent' | 'available' | 'error';
  message: string;
  code?: string;
  raw?: unknown;
};

interface Window {
  waConfig: {
    get(): Promise<ClientConfig>;
    set(input: Partial<Omit<ClientConfig, 'smsbower'>> & { smsbower?: SMSBowerConfigPatch; password?: string; smsbowerApiKey?: string }): Promise<ClientConfig>;
    testConnection(input?: Partial<Omit<ClientConfig, 'smsbower'>> & { smsbower?: SMSBowerConfigPatch; password?: string; smsbowerApiKey?: string }): Promise<ConnectionTestResult>;
  };
  waApi: {
    request<T>(input: { path: string; method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }): Promise<T>;
    fetchAsset(path: string): Promise<AssetResponse>;
  };
  openAIPhone: {
    bridgeStatus(): Promise<{ running: boolean; port: number; baseUrl: string; pending: number }>;
    check(input: OpenAIPhoneCheckInput): Promise<OpenAIPhoneCheckResult>;
  };
  waService: {
    status(): Promise<ServiceStatus>;
    start(): Promise<ServiceStatus>;
    stop(): Promise<ServiceStatus>;
  };
  smsbower: {
    status(): Promise<{ configured: boolean; config: SMSBowerPublicConfig }>;
    getBalance(): Promise<string>;
    getCountries(): Promise<unknown>;
    getPrices(input?: { country?: string }): Promise<SMSBowerPrice[]>;
    getNumber(input?: { country?: string; maxPrice?: number }): Promise<SMSBowerNumberResult>;
    getStatus(id: string): Promise<SMSBowerStatusResult>;
    setStatus(input: { id: string; status: number }): Promise<string>;
    startRegistrationTask?(input?: unknown): Promise<{ successes: number; orders: number; stopped: boolean }>;
    stopRegistrationTask?(): Promise<void>;
  };
  waDesktop: {
    waConfig: {
      get(): Promise<ClientConfig>;
      set(input: Partial<Omit<ClientConfig, 'smsbower'>> & { smsbower?: SMSBowerConfigPatch; password?: string; smsbowerApiKey?: string }): Promise<ClientConfig>;
      testConnection(input?: Partial<Omit<ClientConfig, 'smsbower'>> & { smsbower?: SMSBowerConfigPatch; password?: string; smsbowerApiKey?: string }): Promise<ConnectionTestResult>;
    };
    waApi: {
      request<T>(input: { path: string; method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }): Promise<T>;
      fetchAsset(path: string): Promise<AssetResponse>;
    };
    openAIPhone: {
      bridgeStatus(): Promise<{ running: boolean; port: number; baseUrl: string; pending: number }>;
      check(input: OpenAIPhoneCheckInput): Promise<OpenAIPhoneCheckResult>;
    };
    waService: {
      status(): Promise<ServiceStatus>;
      start(): Promise<ServiceStatus>;
      stop(): Promise<ServiceStatus>;
    };
    smsbower: {
      status(): Promise<{ configured: boolean; config: SMSBowerPublicConfig }>;
      getBalance(): Promise<string>;
      getCountries(): Promise<unknown>;
      getPrices(input?: { country?: string }): Promise<SMSBowerPrice[]>;
      getNumber(input?: { country?: string; maxPrice?: number }): Promise<SMSBowerNumberResult>;
      getStatus(id: string): Promise<SMSBowerStatusResult>;
      setStatus(input: { id: string; status: number }): Promise<string>;
      startRegistrationTask?(input?: unknown): Promise<{ successes: number; orders: number; stopped: boolean }>;
      stopRegistrationTask?(): Promise<void>;
    };
  };
}
