export type ApiError = { message?: string };

export type Timestamped = {
  seconds?: number;
  nanos?: number;
} | string;

export type PhoneTarget = {
  e164_number?: string;
  country_calling_code?: string;
  national_number?: string;
  country_iso2?: string;
};

export type AuditInfo = {
  created_at?: Timestamped;
  updated_at?: Timestamped;
};

export type TwoFactorProjection = {
  configured?: boolean;
  email_configured?: boolean;
  email_verified?: boolean;
  email_confirmed?: boolean;
  email_address?: string;
};

export type WAAccount = {
  wa_account_id: string;
  display_name?: string;
  status?: string | number;
  phone?: PhoneTarget;
  audit?: AuditInfo;
  two_factor_auth?: TwoFactorProjection;
};

export type ClientProfile = {
  client_profile_id?: string;
  wa_account_id?: string;
  protocol_profile_id?: string;
  status?: string | number;
  device?: Record<string, unknown>;
  device_fingerprint?: DeviceFingerprint;
  app_version?: string;
  locale_language?: string;
  locale_country?: string;
  created_at?: Timestamped;
  updated_at?: Timestamped;
  [key: string]: unknown;
};

export type DeviceFingerprint = {
  fingerprint_id?: string;
  fdid?: string;
  device_vendor?: string;
  device_model?: string;
  android_version?: string;
  device_ram_gib?: string | number;
  network_radio_type?: string | number;
  mcc?: string;
  mnc?: string;
  sim_mcc?: string;
  sim_mnc?: string;
  phone_sha256_prefix?: string;
  created_at?: Timestamped;
  [key: string]: unknown;
};

export type WAContact = {
  contact_id: string;
  wa_account_id?: string;
  jid?: string;
  number?: string;
  display_name?: string;
  wa_name?: string;
  verified_name?: string;
  profile_picture_id?: string;
  kind?: string | number;
  unread_count?: number;
  last_message_at?: Timestamped;
  last_message_preview?: string;
  updated_at?: Timestamped;
  [key: string]: unknown;
};

export type AccountMessage = {
  account_message_id?: string;
  message_id?: string;
  wa_account_id?: string;
  contact_ref?: string;
  direction?: string | number;
  text?: unknown;
  preview?: string;
  display_text?: string;
  received_at?: Timestamped;
  sent_at?: Timestamped;
  created_at?: Timestamped;
  ack_status?: string | number;
  read?: boolean;
  [key: string]: unknown;
};

export type WorkflowResponse = {
  success?: boolean;
  passed?: boolean;
  request_failed?: boolean;
  status?: string;
  error_message?: string;
  reject_reason?: string;
  wa_account_id?: string;
  client_profile_id?: string;
  protocol_profile_id?: string;
  verification_request_id?: string;
  delivery_method?: string;
  method?: string;
  registration_phase?: string;
  method_statuses?: Array<Record<string, unknown>>;
  phone_status?: Record<string, unknown>;
  account_probe?: Record<string, unknown>;
  sms_probe?: Record<string, unknown>;
  phone?: Record<string, unknown>;
  proxy?: Record<string, unknown>;
  verification_request?: Record<string, unknown>;
  registration?: Record<string, unknown>;
  login_state?: Record<string, unknown>;
  check?: Record<string, unknown>;
};

export type ListAccountsResponse = { accounts?: WAAccount[]; next_cursor?: string; error?: ApiError };
export type ListProfilesResponse = { client_profiles?: ClientProfile[]; next_cursor?: string; error?: ApiError };
export type ListContactsResponse = { contacts?: WAContact[]; next_cursor?: string; error?: ApiError };
export type ListMessagesResponse = { messages?: AccountMessage[]; next_cursor?: string; error?: ApiError };
export type ListOtpMessagesResponse = { messages?: AccountMessage[]; otp_messages?: AccountMessage[]; next_cursor?: string; error?: ApiError };
export type LongConnectionStatusResponse = { states?: Array<Record<string, unknown>>; connections?: Array<Record<string, unknown>>; error?: ApiError };

export type AccountSettingsResponse = {
  status?: TwoFactorProjection;
  operation?: { status?: string | number; error?: ApiError };
  profile_picture_id?: string;
  error?: ApiError;
};
