import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createQueue } from './jobs/queue.js';
import { registerMetaWebhook } from './http/meta-webhook.js';
import rawBody from 'fastify-raw-body';
import { withConversationLock } from './jobs/queue.js';
import { processConversationTurn } from './conversation/turn.js';
import { CloudWhatsAppClient } from './messaging/whatsapp-client.js';
import { claimOutbound, markFailed, markSent } from './messaging/outbox.js';
import { createLunaResponder } from './ai/luna.js';
import { PostgresLunaToolExecutor } from './ai/postgres-executor.js';
import { registerAdminPanel } from './http/admin-panel.js';
import formbody from '@fastify/formbody';
import { enqueueDueReminders } from './jobs/reminders.js';
import { canRetry, retryAt } from './messaging/reminders.js';
import { OpenAITranscriber } from './media/transcription.js';
import { WhatsAppMediaDownloader } from './media/whatsapp-media.js';

export interface BuildAppOptions {
  config?: AppConfig;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(formbody);
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.addHook('onClose', async () => {
    // Reserved for closing database pools and other resources as they are added.
  });
  app.decorate('config', config);
  if (config.whatsappVerifyToken && config.whatsappAppSecret) {
    const db = createDatabase(config.databaseUrl);
    const boss = await createQueue(config.databaseUrl);
    registerMetaWebhook(app, db, boss, { verifyToken: config.whatsappVerifyToken, appSecret: config.whatsappAppSecret });
    registerAdminPanel(app, db, { nodeEnv: config.nodeEnv, devUser: process.env.PANEL_DEV_USER });
    app.addHook('onClose', async () => { await boss.stop(); await db.destroy(); });
  }
  return app;
}

/** Starts the background process without opening an HTTP socket. */
export async function startWorker(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  // The worker owns exactly one DB pool and one pg-boss instance.
  const app = await buildApp({ ...options, config: { ...config, whatsappAppSecret: undefined, whatsappVerifyToken: undefined } });
  if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
    const heartbeat = setInterval(() => undefined, 60_000);
    app.addHook('onClose', async () => clearInterval(heartbeat));
    registerGracefulShutdown(app);
    return app;
  }
  const db = createDatabase(config.databaseUrl);
  const boss = await createQueue(config.databaseUrl);
  await boss.createQueue('conversation.turn');
  await boss.createQueue('reminders.sweep');
  await boss.work('conversation.turn', async ([job]) => {
    const data = job.data as { conversationId?: string };
    if (!data.conversationId) throw new Error('conversationId is required');
    await withConversationLock(db, data.conversationId, (tx) => {
      if (!config.openaiApiKey) return processConversationTurn(tx, data.conversationId!);
      const responder = createLunaResponder({ apiKey: config.openaiApiKey, model: config.openaiModel, baseUrl: config.openaiBaseUrl }, new PostgresLunaToolExecutor(tx));
      const transcriber = config.whatsappAccessToken ? new OpenAITranscriber({ apiKey: config.openaiApiKey, baseUrl: config.openaiBaseUrl, model: config.transcriptionModel, timeoutMs: config.mediaTimeoutMs, mediaFetcher: (id) => new WhatsAppMediaDownloader({ accessToken: config.whatsappAccessToken!, timeoutMs: config.mediaTimeoutMs }).download(id) }) : undefined;
      return processConversationTurn(tx, data.conversationId!, responder, transcriber);
    });
  });
  await boss.work('reminders.sweep', async () => {
    try { await enqueueDueReminders(db); }
    finally { await boss.send('reminders.sweep', {}, { singletonKey: 'reminders-sweep', startAfter: 60 }); }
  });
  await boss.send('reminders.sweep', {}, { singletonKey: 'reminders-sweep', startAfter: 1 });
  const client = new CloudWhatsAppClient(config.whatsappAccessToken, config.whatsappPhoneNumberId);
  const heartbeat = setInterval(async () => {
    const pending = await (await import('./messaging/outbox.js')).claimOutbound(db);
    for (const row of pending) {
      try {
        const customer = await db.selectFrom('customers').select('whatsapp_phone').where('id', '=', row.customer_id).executeTakeFirstOrThrow();
        const result = await client.sendPayload(customer.whatsapp_phone, row.payload as Record<string, unknown>);
        await markSent(db, row.id, result.providerMessageId);
      } catch (error) {
        const attempt = row.attempts + 1;
        await markFailed(db, row.id, error instanceof Error ? error.message : String(error), retryAt(attempt), !canRetry(attempt));
      }
    }
  }, 1000);
  app.addHook('onClose', async () => { clearInterval(heartbeat); await boss.stop(); await db.destroy(); });
  registerGracefulShutdown(app);
  return app;
}

function registerGracefulShutdown(app: FastifyInstance): void {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (process.argv.includes('--worker')) {
    await startWorker({ config, logger: true });
    return;
  }
  const app = await buildApp({ config, logger: true });
  registerGracefulShutdown(app);
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
