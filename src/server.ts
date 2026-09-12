import 'dotenv/config';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';

const env = z.object({
  PORT: z.coerce.number().default(3000),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
}).parse(process.env);

const app = Fastify({ logger: true });

app.get('/healthz', async () => ({ ok: true }));

app.get('/webhook/whatsapp', async (request, reply) => {
  const q = request.query as Record<string,string>;
  if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN) {
    return reply.type('text/plain').send(q['hub.challenge']);
  }
  return reply.code(403).send({ error: 'verification_failed' });
});

app.post('/webhook/whatsapp', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'];
  if (typeof signature !== 'string' || !request.rawBody) return reply.code(401).send();
  const expected = 'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(request.rawBody).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return reply.code(401).send();
  request.log.info({ payload: request.body }, 'whatsapp event accepted');
  return reply.code(200).send('EVENT_RECEIVED');
});

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch(err => { app.log.error(err); process.exit(1); });
