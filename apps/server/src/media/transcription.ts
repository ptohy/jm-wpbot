import { createHash } from 'node:crypto';

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 180;
const ALLOWED_AUDIO = new Set(['audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm']);

export interface MediaRef { id: string; mimeType?: string; seconds?: number; bytes?: number; }
export interface MediaTranscriber { transcribe(media: MediaRef): Promise<string>; }

export class MediaRejectedError extends Error {}

/** OpenAI-compatible transcription adapter. Media bytes are never logged or persisted. */
export class OpenAITranscriber implements MediaTranscriber {
  constructor(private readonly config: { apiKey: string; baseUrl?: string; model?: string; timeoutMs?: number; fetch?: typeof fetch; mediaFetcher?: (mediaId: string) => Promise<{ bytes: Uint8Array; mimeType: string }> }) {
    if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) throw new Error('timeoutMs must be a finite number greater than 0');
  }
  async transcribe(media: MediaRef): Promise<string> {
    validateMedia(media);
    if (!this.config.mediaFetcher) throw new Error('mediaFetcher is required');
    const file = await this.config.mediaFetcher(media.id);
    if (file.bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaRejectedError('audio file exceeds size limit');
    const mimeType = file.mimeType.split(';', 1)[0].trim().toLowerCase();
    if (!ALLOWED_AUDIO.has(mimeType)) throw new MediaRejectedError('unsupported audio content type');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(file.bytes)], { type: mimeType }), `audio-${safeId(media.id)}.bin`);
    form.append('model', this.config.model ?? 'gpt-4o-mini-transcribe');
    const response = await (this.config.fetch ?? fetch)(`${this.config.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`, {
      method: 'POST', headers: { authorization: `Bearer ${this.config.apiKey}` }, body: form, signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
    });
    if (!response.ok) throw new Error(`transcription request failed (${response.status})`);
    const json = await response.json() as { text?: string };
    const text = json.text?.trim();
    if (!text) throw new Error('transcription response was empty');
    return text.slice(0, 4000);
  }
}

export function validateMedia(media: MediaRef): void {
  if (!media.id || !/^[\w.-]{1,256}$/.test(media.id)) throw new MediaRejectedError('invalid media id');
  if (media.bytes !== undefined && media.bytes > MAX_MEDIA_BYTES) throw new MediaRejectedError('media exceeds size limit');
  if (media.seconds !== undefined && media.seconds > MAX_AUDIO_SECONDS) throw new MediaRejectedError('audio exceeds duration limit');
}

export function mediaFallback(type: string): string {
  return type === 'audio' ? 'Não consegui ouvir esse áudio. Pode escrever a mensagem ou aguardar o atendimento da profissional?' : 'Não consegui processar essa mídia. Pode enviar uma mensagem de texto?';
}

export function redactMediaLog(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
function safeId(id: string) { return redactMediaLog(id); }
