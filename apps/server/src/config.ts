export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  nodeEnv: string;
  whatsappVerifyToken?: string;
  whatsappAppSecret?: string;
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
  openaiApiKey?: string;
  openaiModel: string;
  openaiBaseUrl: string;
  transcriptionModel: string;
  mediaTimeoutMs: number;
}

type Environment = Record<string, string | undefined>;

export function loadConfig(env: Environment = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  if (nodeEnv === 'production' && !env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required in production');

  const portValue = env.PORT ?? '3000';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const mediaTimeoutMs = Number(env.MEDIA_TIMEOUT_MS ?? '15000');
  if (!Number.isFinite(mediaTimeoutMs) || mediaTimeoutMs <= 0) {
    throw new Error('MEDIA_TIMEOUT_MS must be a finite number greater than 0');
  }

  return {
    databaseUrl,
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    nodeEnv,
    whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || undefined,
    whatsappAppSecret: env.WHATSAPP_APP_SECRET?.trim() || undefined,
    whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() || undefined,
    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() || undefined,
    openaiApiKey: env.OPENAI_API_KEY?.trim() || undefined,
    openaiModel: env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna',
    openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    transcriptionModel: env.TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe',
    mediaTimeoutMs,
  };
}
