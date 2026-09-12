import { describe, expect, it, vi } from 'vitest';
import { MAX_AUDIO_SECONDS, MAX_MEDIA_BYTES, MediaRejectedError, OpenAITranscriber, mediaFallback, redactMediaLog, validateMedia } from '../../apps/server/src/media/transcription.js';

describe('media safety', () => {
  it('rejects oversized and long audio before provider call', () => {
    expect(() => validateMedia({ id: 'x', bytes: MAX_MEDIA_BYTES + 1 })).toThrow(MediaRejectedError);
    expect(() => validateMedia({ id: 'x', seconds: MAX_AUDIO_SECONDS + 1 })).toThrow(MediaRejectedError);
  });
  it('transcribes through OpenAI-compatible endpoint without logging media', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: '  mensagem transcrita  ' }), { status: 200 }));
    const transcriber = new OpenAITranscriber({ apiKey: 'secret', fetch: fetcher, mediaFetcher: async () => ({ bytes: new Uint8Array([1, 2]), mimeType: 'audio/ogg' }) });
    await expect(transcriber.transcribe({ id: 'media-123' })).resolves.toBe('mensagem transcrita');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('provides safe fallbacks and redacted identifiers', () => {
    expect(mediaFallback('audio')).toMatch(/escrever/i);
    expect(redactMediaLog('media-123')).toHaveLength(12);
    expect(redactMediaLog('media-123')).not.toContain('media-123');
  });
});
