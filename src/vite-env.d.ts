/// <reference types="vite/client" />

type ClientMode = 'remote' | 'local';
type SMSProvider = 'smsbower' | 'hero-sms';

type ClientConfig = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localDataDir: string;
  localCommonProxy: string;
  localDeviceProfilesFile: string;
  autoStartLocalService: boolean;
  smsCancelQueuePollIntervalSeconds: number;
  smsProvider: SMSProvider;
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
  openAIPhoneCheckEnabled: boolean;
  pollIntervalSeconds: number;
  otpTimeoutSeconds: number;
  hasApiKey: boolean;
  hasHeroSMSApiKey: boolean;
  provider: SMSProvider;
  providerLabel: string;
  configured: boolean;
};

type SMSBowerConfigPatch = Partial<Omit<SMSBowerPublicConfig, 'hasApiKey' | 'hasHeroSMSApiKey' | 'providerLabel' | 'configured'>>;
type ClientConfigPatch = Partial<Omit<ClientConfig, 'smsbower'>> & { smsbower?: SMSBowerConfigPatch; password?: string; smsbowerApiKey?: string; heroSMSApiKey?: string };

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
  providerId?: string;
};

type SMSPlatformAPI = {
  status(): Promise<{ configured: boolean; config: SMSBowerPublicConfig; provider?: SMSProvider; label?: string }>;
  getBalance(): Promise<string>;
  getCountries(input?: { provider?: SMSProvider }): Promise<unknown>;
  getPrices(input?: { provider?: SMSProvider; country?: string }): Promise<SMSBowerPrice[]>;
  getNumber(input?: { provider?: SMSProvider; country?: string; minPrice?: number; maxPrice?: number; providerIds?: string[] }): Promise<SMSBowerNumberResult>;
  getStatus(id: string): Promise<SMSBowerStatusResult>;
  setStatus(input: { id: string; status: number }): Promise<string>;
  startRegistrationTask?(input?: unknown): Promise<{ successes: number; orders: number; stopped: boolean }>;
  stopRegistrationTask?(): Promise<void>;
};

type SMSCancelQueueStatus = 'pending' | 'processing' | 'cancelled' | 'failed' | 'removed';
type SMSCancelQueueListStatus = 'all' | SMSCancelQueueStatus;

type SMSCancelQueueItem = {
  id: string;
  provider: SMSProvider;
  activationId: string;
  phone: string;
  reason: string;
  orderedAtMs: number;
  notBeforeMs: number;
  status: SMSCancelQueueStatus;
  attempts: number;
  lastError: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type SMSCancelQueueSummary = {
  total: number;
  active: number;
  pending: number;
  processing: number;
  failed: number;
  cancelled: number;
  removed: number;
  nextDueAtMs: number;
  dbPath: string;
  running: boolean;
  lastError?: string;
};

type SMSCancelQueueListInput = {
  status?: SMSCancelQueueListStatus;
  page?: number;
  pageSize?: number;
};

type SMSCancelQueueListResult = {
  items: SMSCancelQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type SMSCancelQueueAPI = {
  status(): Promise<SMSCancelQueueSummary>;
  list(input?: SMSCancelQueueListInput): Promise<SMSCancelQueueListResult>;
  enqueue(input: { provider: SMSProvider; activationId: string; phone?: string; reason: string; orderedAtMs?: number }): Promise<SMSCancelQueueItem>;
  retry(id: string): Promise<SMSCancelQueueItem>;
  remove(id: string): Promise<SMSCancelQueueItem>;
};

type WindowControlAPI = {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
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
  status: 'used' | 'sent' | 'available' | 'error' | 'rate_limited' | 'session_expired';
  message: string;
  code?: string;
  raw?: unknown;
};

interface Window {
  waConfig: {
    get(): Promise<ClientConfig>;
    set(input: ClientConfigPatch): Promise<ClientConfig>;
    testConnection(input?: ClientConfigPatch): Promise<ConnectionTestResult>;
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
  windowControl?: WindowControlAPI;
  smsCancelQueue: SMSCancelQueueAPI;
  smsbower: SMSPlatformAPI;
  smsPlatform: SMSPlatformAPI;
  waDesktop: {
    waConfig: {
      get(): Promise<ClientConfig>;
      set(input: ClientConfigPatch): Promise<ClientConfig>;
      testConnection(input?: ClientConfigPatch): Promise<ConnectionTestResult>;
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
    windowControl: WindowControlAPI;
    smsPlatform: SMSPlatformAPI;
    smsCancelQueue: SMSCancelQueueAPI;
    smsbower: SMSPlatformAPI;
  };
}
