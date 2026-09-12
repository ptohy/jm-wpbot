import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/types.js';

const id = z.string().uuid();
const serviceInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional().nullable(), base_price_cents: z.coerce.number().int().min(0), default_duration_minutes: z.coerce.number().int().positive(), default_before_buffer_minutes: z.coerce.number().int().min(0).default(0), default_after_buffer_minutes: z.coerce.number().int().min(0).default(0) });
const professionalInput = z.object({ display_name: z.string().trim().min(1).max(120), email: z.string().email().max(254) });
const blockInput = z.object({ professional_id: id, starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }), reason: z.string().trim().max(250).optional().nullable() });

export function registerAdminPanel(app: FastifyInstance, db: Kysely<Database>, options: { nodeEnv: string; devUser?: string }): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin')) return;
    const email = request.headers['cf-access-authenticated-user-email'];
    const dev = request.headers['x-dev-user'];
    const identity = typeof email === 'string' && email.length > 3 ? email : options.nodeEnv !== 'production' && dev === options.devUser ? dev : undefined;
    if (!identity) return reply.code(401).type('text/html').send('<h1>401</h1><p>Autenticação necessária.</p>');
    const user = await db.selectFrom('users').select(['id','email','role']).where('email','=',identity).where('active','=',true).executeTakeFirst();
    if (!user && options.nodeEnv === 'production') return reply.code(403).send({ error: 'user_not_authorized' });
    (request as any).panelUser = user ?? { id: null, email: identity, role: 'admin' };
    if (!['GET','HEAD'].includes(request.method) && !validCsrf(request)) return reply.code(403).send({ error: 'csrf_invalid' });
    if (request.method !== 'GET' && request.method !== 'HEAD' && user?.role !== 'admin') return reply.code(403).send({ error: 'admin_required' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'validation_error', issues: error.issues });
    return reply.code(500).send({ error: 'internal_error' });
  });
  app.get('/admin', async (req, reply) => {
    const [services, professionals, appointments, conversations] = await Promise.all([
      db.selectFrom('services').selectAll().where('active', '=', true).orderBy('name').execute(),
      db.selectFrom('professionals').selectAll().where('active', '=', true).orderBy('display_name').execute(),
      db.selectFrom('appointments').innerJoin('services','services.id','appointments.service_id').innerJoin('professionals','professionals.id','appointments.professional_id').innerJoin('customers','customers.id','appointments.customer_id').select(['appointments.id','appointments.status','appointments.scheduled_start_at','appointments.scheduled_end_at','services.name as service_name','professionals.display_name as professional_name','customers.display_name as customer_name','customers.whatsapp_phone']).where('appointments.status','in',['hold','confirmed']).orderBy('scheduled_start_at').limit(50).execute(),
      conversationList(db, (req as any).panelUser),
    ]);
    const token = csrfToken(reply);
    return reply.type('text/html').send(render({ services, professionals, appointments, conversations, token }));
  });
  app.post('/admin/services', async (req, reply) => { const body = serviceInput.parse(req.body); const row = await db.insertInto('services').values(body).returningAll().executeTakeFirstOrThrow(); await audit(db, req, 'create', 'service', row.id, null, row); return reply.code(201).send(row); });
  app.delete('/admin/services/:id', async (req, reply) => { const p = id.parse((req.params as any).id); const before = await db.selectFrom('services').selectAll().where('id','=',p).executeTakeFirstOrThrow(); await db.updateTable('services').set({ active: false }).where('id','=',p).execute(); await audit(db, req, 'deactivate', 'service', p, before, { ...before, active:false }); return reply.code(204).send(); });
  app.post('/admin/professionals', async (req, reply) => { const body = professionalInput.parse(req.body); const result = await db.transaction().execute(async tx => { const existing = await tx.selectFrom('users').selectAll().where('email','=',body.email).executeTakeFirst(); const user = existing ?? await tx.insertInto('users').values({ email: body.email, display_name: body.display_name, role: 'staff' }).returningAll().executeTakeFirstOrThrow(); const professional = await tx.selectFrom('professionals').selectAll().where('user_id','=',user.id).executeTakeFirst(); if (professional) return professional; return tx.insertInto('professionals').values({ user_id: user.id, display_name: body.display_name }).returningAll().executeTakeFirstOrThrow(); }); await audit(db, req, 'create_or_get', 'professional', result.id, null, result); return reply.code(201).send(result); });
  app.post('/admin/blocks', async (req, reply) => { const b = blockInput.parse(req.body); const start = new Date(b.starts_at), end = new Date(b.ends_at); if (end <= start) return reply.code(400).send({ error:'invalid_interval' }); const local = localParts(start, end); const row = await db.insertInto('schedule_blocks').values({ ...b, starts_at: start, ends_at: end, ...local }).returningAll().executeTakeFirstOrThrow(); await audit(db, req, 'create', 'schedule_block', row.id, null, row); return reply.code(201).send(row); });
  app.post('/admin/conversations/:id/takeover', async (req, reply) => {
    const conversationId = id.parse((req.params as any).id); const user = panelUser(req); const now = new Date() as any;
    const row = await db.transaction().execute(async tx => {
      const before = await tx.selectFrom('conversations').selectAll().where('id','=',conversationId).where('status','=','open').forUpdate().executeTakeFirst();
      if (!before || (user.role === 'staff' && before.human_owner_user_id && before.human_owner_user_id !== user.id)) return undefined;
      const after = await tx.updateTable('conversations').set({ ai_paused_at: now, human_owner_user_id: user.id, updated_at: now }).where('id','=',conversationId).returning(['id','ai_paused_at','human_owner_user_id']).executeTakeFirstOrThrow();
      await audit(tx, req, 'takeover', 'conversation', conversationId, before, after); return after;
    });
    return row ? reply.send(row) : reply.code(404).send({ error:'conversation_not_found' });
  });
  app.post('/admin/conversations/:id/resume', async (req, reply) => {
    const conversationId = id.parse((req.params as any).id); const user = panelUser(req);
    const row = await db.transaction().execute(async tx => {
      const before = await tx.selectFrom('conversations').selectAll().where('id','=',conversationId).where('status','=','open').forUpdate().executeTakeFirst();
      if (!before || (user.role === 'staff' && before.human_owner_user_id !== user.id)) return undefined;
      const after = await tx.updateTable('conversations').set({ ai_paused_at: null, human_owner_user_id: null, updated_at: new Date() as any }).where('id','=',conversationId).returning(['id','ai_paused_at','human_owner_user_id']).executeTakeFirstOrThrow();
      await audit(tx, req, 'resume', 'conversation', conversationId, before, after); return after;
    });
    return row ? reply.send(row) : reply.code(404).send({ error:'conversation_not_found' });
  });
}

function panelUser(req: FastifyRequest): { id: string | null; role: 'admin' | 'staff' } { return (req as any).panelUser; }
async function conversationList(db: Kysely<Database>, user: { id: string | null; role: 'admin' | 'staff' }) {
  let q = db.selectFrom('conversations').innerJoin('customers','customers.id','conversations.customer_id').select(['conversations.id','conversations.status','conversations.ai_paused_at','conversations.human_owner_user_id','conversations.last_message_at','customers.display_name','customers.whatsapp_phone']).where('conversations.status','=','open');
  if (user.role === 'staff' && user.id) q = q.where(eb => eb.or([eb('conversations.human_owner_user_id','=',user.id), eb('conversations.human_owner_user_id','is',null)])) as typeof q;
  return q.orderBy('last_message_at','desc').limit(50).execute();
}
function localParts(start: Date, end: Date): { local_date: string; local_start_time: string; local_end_time: string; timezone: string } {
  const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const a:any=parts(start), b:any=parts(end); return { local_date:`${a.year}-${a.month}-${a.day}`, local_start_time:`${a.hour}:${a.minute}:${a.second}`, local_end_time:`${b.hour}:${b.minute}:${b.second}`, timezone:'America/Sao_Paulo' };
}
async function audit(db: Kysely<Database>, req: FastifyRequest, action: string, entity_type: string, entity_id: string, before: unknown, after: unknown): Promise<void> { const user=(req as any).panelUser; await db.insertInto('audit_log').values({ actor_user_id:user?.id ?? null, action, entity_type, entity_id, before: before as any, after: after as any }).execute(); }

function csrfToken(reply: any): string { const token = randomBytes(24).toString('hex'); reply.header('set-cookie', `panel_csrf=${token}; Path=/admin; SameSite=Strict; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); return token; }
function validCsrf(req: FastifyRequest): boolean { const cookie = String(req.headers.cookie ?? '').match(/(?:^|;\s*)panel_csrf=([^;]+)/)?.[1]; const body = req.body as any; const header = req.headers['x-csrf-token'] ?? body?.csrf; if (!cookie || typeof header !== 'string' || cookie.length !== header.length) return false; return timingSafeEqual(Buffer.from(cookie), Buffer.from(header)); }
function esc(v: unknown): string { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
function render(d: any): string { return `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda JM</title><style>body{font:16px system-ui;margin:auto;max-width:900px;padding:1rem;background:#faf8f6;color:#292321}section{background:white;border:1px solid #e5ded9;border-radius:12px;padding:1rem;margin:1rem 0;overflow:auto}table{width:100%;border-collapse:collapse}td,th{padding:.55rem;text-align:left;border-bottom:1px solid #eee}button{padding:.55rem .8rem;border:0;border-radius:8px;background:#7b4b3a;color:white}small{color:#766}h1{font-size:1.5rem}</style><h1>Agenda JM</h1><p><small>Painel administrativo · fatos da agenda vêm do PostgreSQL</small></p><section><h2>Serviços</h2><table><tr><th>Nome</th><th>Preço</th><th>Duração</th></tr>${d.services.map((x:any)=>`<tr><td>${esc(x.name)}</td><td>R$ ${(x.base_price_cents/100).toFixed(2).replace('.',',')}</td><td>${x.default_duration_minutes} min</td></tr>`).join('')}</table></section><section><h2>Profissionais</h2><table><tr><th>Nome</th><th>Status</th></tr>${d.professionals.map((x:any)=>`<tr><td>${esc(x.display_name)}</td><td>${x.active?'Ativa':'Inativa'}</td></tr>`).join('')}</table></section><section><h2>Próximos agendamentos</h2><table><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Status</th></tr>${d.appointments.map((x:any)=>`<tr><td>${esc(new Date(x.scheduled_start_at).toLocaleString('pt-BR'))}</td><td>${esc(x.customer_name||x.whatsapp_phone)}</td><td>${esc(x.service_name)}</td><td>${esc(x.status)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum agendamento</td></tr>'}</table></section><section><h2>Conversas abertas</h2><table><tr><th>Cliente</th><th>Última mensagem</th><th>IA</th><th>Ação</th></tr>${d.conversations.map((x:any)=>`<tr><td>${esc(x.display_name||x.whatsapp_phone)}</td><td>${esc(x.last_message_at)}</td><td>${x.ai_paused_at?'pausada':'ativa'}</td><td><form method="post" action="/admin/conversations/${x.id}/${x.ai_paused_at?'resume':'takeover'}"><input type="hidden" name="csrf" value="${d.token}"><button>${x.ai_paused_at?'Retomar IA':'Assumir conversa'}</button></form></td></tr>`).join('')||'<tr><td colspan="4">Nenhuma conversa</td></tr>'}</table></section></html>`; }
