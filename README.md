# JM WPBot — Atendente WhatsApp do Jessica Marques Beauty Studio

Canal de atendimento via WhatsApp Cloud API, com GPT-5.6 Luna, filas duráveis e integração de agendamento.

## Arquitetura canônica

O **Tohy Hub** é a fonte de verdade para catálogo, profissionais, disponibilidade, leads, clientes e agendamentos do Studio. O `jm-wpbot` deve atuar como adapter/orquestrador de canal; n8n também não deve possuir dados mestres de agenda ou catálogo.

Contrato interno já disponível no Hub:

- `GET /api/internal/jm/catalog`
- `GET /api/internal/jm/availability`
- `POST /api/internal/jm/leads`
- `POST /api/internal/jm/appointments`

A autenticação usa credencial interna dedicada e organização fixa no Hub. Segredos nunca devem ser versionados.

## Estado transicional — H000056 / 2026-09-17

A implementação atual do bot ainda usa PostgreSQL local para `services`, `professionals`, `appointments`, disponibilidade e o fluxo `hold -> confirm/cancel`. Esse banco é **legado operacional**, não a arquitetura-alvo.

Não fazer dual-write nem sincronização bidirecional entre o banco local e o Hub. A migração do executor de agenda só pode ocorrer quando o Hub tiver um contrato canônico equivalente para reserva temporária/hold, confirmação e cancelamento. O endpoint atual de criação direta de appointment não substitui com segurança o hold de cinco minutos do bot, pois um hold invisível ao Hub permitiria disputa de slot/double booking.

Até esse boundary existir, manter o executor legado funcional e isolado; mudanças de catálogo/agendamento mestre devem convergir para o Hub.

## Stack

- Node.js + TypeScript + Fastify
- PostgreSQL 16 para estado legado do bot e jobs
- pg-boss para jobs duráveis
- GPT-5.6 Luna para conversa
- WhatsApp Cloud API oficial
- Portainer Stack para produção

## Produção reconciliada em 2026-09-17

- Portainer stack `184` acompanha `refs/heads/main`.
- `web`, `worker` e `postgres` usam `restart: unless-stopped`.
- PostgreSQL está healthy e `/healthz` retorna `{"status":"ok"}`.
- Verificação local do webhook Meta retorna HTTP 200 e ecoa corretamente o challenge.
- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` e `OPENAI_API_KEY` estão provisionados sem exposição de valores.
- `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` ainda não estão provisionados; envio real permanece bloqueado por esse gate externo.
- Os smokes dessa reconciliação não enviaram mensagens reais.

Backup pré-redeploy criado no host Docker em `/root/backups/jm-wpbot/20260917T102903Z`.

## Operação local

1. Copie `.env.example` para `.env` e troque os segredos.
2. Suba a stack de desenvolvimento conforme o Compose do repositório.
3. Execute migrations antes de iniciar `web`/`worker`.
4. Mantenha webhook HTTPS com validação HMAC e painel administrativo atrás do Cloudflare Access.

Docker de produção é administrado exclusivamente por **Portainer Stack**; não usar `docker compose` direto para alterar a stack de produção.
