# JM WPBot — Atendente WhatsApp para estética facial

Base inicial do atendente oficial via WhatsApp Cloud API, com agenda PostgreSQL, confirmação automática e painel administrativo.

## Stack
- Node.js + TypeScript + Fastify
- PostgreSQL 16 como fonte única da verdade
- pg-boss para jobs duráveis
- GPT-5.6 Luna para conversa
- WhatsApp Cloud API

## Homelab
1. Copie `.env.example` para `.env` e troque os segredos.
2. `docker compose up -d postgres`
3. `npm install && npm run db:migrate && npm run dev`

O webhook deve usar HTTPS e validação HMAC. O painel administrativo deve ficar atrás do Cloudflare Access. Serviços, preços e expediente entram pelo painel antes da operação.