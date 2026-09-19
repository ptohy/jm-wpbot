# JM WPBot — Atendente WhatsApp do Jessica Marques Beauty Studio

Canal de atendimento via WhatsApp Cloud API, com GPT-5.6 Luna, filas duráveis e integração de agendamento.

## Arquitetura canônica

O **Tohy Hub** é a fonte de verdade para catálogo, profissionais, disponibilidade, leads, clientes e agendamentos do Studio. O `jm-wpbot` atua como adapter/orquestrador de canal; n8n também não deve possuir dados mestres de agenda ou catálogo.

Contrato interno disponível no Hub:

- `GET /api/internal/jm/catalog`
- `GET /api/internal/jm/availability`
- `POST /api/internal/jm/leads`
- `POST /api/internal/jm/appointments`
- `POST /api/internal/jm/booking-holds`
- `POST /api/internal/jm/booking-holds/:holdId/confirm`
- `POST /api/internal/jm/booking-holds/:holdId/cancel`

A autenticação usa credencial interna dedicada e organização fixa no Hub. Segredos nunca devem ser versionados.

## Estado transicional — Hub canonical scheduling

O executor Luna usa o Hub para catálogo, disponibilidade, reserva temporária, confirmação e cancelamento quando `HUB_INTERNAL_API_TOKEN` e `HUB_INTERNAL_ORGANIZATION_ID` estão configurados. O bot envia a organização fixa pelo cabeçalho `X-Hub-Organization` e usa `sourceDetail=jm-wpbot` nas reservas.

Se a configuração interna do Hub estiver ausente, o worker mantém o executor PostgreSQL legado como rollback seguro. Não há dual-write: em modo Hub, slot occupancy e appointments pertencem ao Hub; o PostgreSQL local permanece para conversas, mensagens, outbox, jobs, painel operacional legado e estado de canal.

Configuração necessária para o modo Hub:

```env
HUB_INTERNAL_BASE_URL=https://hub.tohy.com.br
HUB_INTERNAL_API_TOKEN=<segredo provisionado no Portainer>
HUB_INTERNAL_ORGANIZATION_ID=<id fixo da Jessica Marques no Hub>
```

`HUB_INTERNAL_API_TOKEN` e `HUB_INTERNAL_ORGANIZATION_ID` devem ser definidos juntos. Definir apenas um deles falha no bootstrap para evitar operação parcial.

## Stack

- Node.js + TypeScript + Fastify
- PostgreSQL 16 para estado de canal, conversas, outbox e jobs
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
