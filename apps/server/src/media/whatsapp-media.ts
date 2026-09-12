import { MediaRejectedError, MAX_MEDIA_BYTES, redactMediaLog } from './transcription.js';
const ALLOWED_AUDIO = new Set(['audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm']);
export class WhatsAppMediaDownloader {
  constructor(private readonly config: { accessToken: string; graphBaseUrl?: string; timeoutMs?: number; fetch?: typeof fetch }) {}
  async download(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const f = this.config.fetch ?? fetch; const headers = { authorization: `Bearer ${this.config.accessToken}` };
    const requestSignal = () => AbortSignal.timeout(this.config.timeoutMs ?? 15_000);
    const meta = await f(`${this.config.graphBaseUrl ?? 'https://graph.facebook.com/v23.0'}/${encodeURIComponent(mediaId)}`, { headers, signal: requestSignal() });
    if (!meta.ok) throw new Error(`media metadata request failed (${meta.status})`);
    const info = await meta.json() as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url || !info.mime_type || !ALLOWED_AUDIO.has(info.mime_type.toLowerCase())) throw new MediaRejectedError(`unsupported audio media ${redactMediaLog(mediaId)}`);
    if (info.file_size !== undefined && info.file_size > MAX_MEDIA_BYTES) throw new MediaRejectedError('media exceeds size limit');
    const response = await f(info.url, { headers, signal: requestSignal() });
    if (!response.ok || !response.body) throw new Error(`media download failed (${response.status})`);
    const mimeType = (response.headers.get('content-type') ?? info.mime_type).split(';', 1)[0].trim().toLowerCase();
    if (!ALLOWED_AUDIO.has(mimeType)) throw new MediaRejectedError('unsupported audio content type');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try { while (true) { const n = await reader.read(); if (n.done) break; total += n.value.byteLength; if (total > MAX_MEDIA_BYTES) throw new MediaRejectedError('media exceeds size limit'); chunks.push(n.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, mimeType };
  }
}
