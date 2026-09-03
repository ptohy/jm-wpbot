import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, startWorker } from '../../apps/server/src/app.js';
import { loadConfig } from '../../apps/server/src/config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('runtime bootstrap', () => {
  it('returns ok from the health endpoint', async () => {
    const app = await buildApp({ config: loadConfig({ DATABASE_URL: 'postgres://localhost/test' }) });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('rejects missing required configuration', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('starts worker mode without binding an HTTP listener', async () => {
    const worker = await startWorker({ config: loadConfig({ DATABASE_URL: 'postgres://localhost/test' }) });

    expect(worker.server.address()).toBeNull();
    await worker.close();
  });
});
