# Atendente de WhatsApp para agendamentos de estética facial

## Objetivo

Criar um atendente com IA para o novo número exclusivo da empresa, capaz de conversar naturalmente com clientes e confirmar automaticamente agendamentos de serviços de estética facial. A agenda será própria, inicialmente com uma profissional ativa e modelada desde o início para múltiplas profissionais.

## Decisões aprovadas

- WhatsApp Cloud API oficial da Meta, sem API não oficial e sem BSP intermediário.
- Hospedagem no LXC 200, por Portainer Stack.
- IA natural com confirmações objetivas.
- GPT-5.6 Luna via OpenAI API como IA principal.
- Interface de provedor preparada para fallback local futuro, sem fallback automático na primeira versão.
- Reserva automática após confirmação explícita dos dados.
- Apenas os papéis `administradora` e `profissional`; não haverá recepção.
- Serviços, preços, durações, intervalos e horários serão cadastráveis no painel.
- Não haverá cobrança de sinal na primeira versão.

## Arquitetura

O Stack terá `app`, `worker`, `postgres` e `redis`. O n8n existente ficará como apoio para backups, alertas e integrações futuras, não como autoridade da agenda.

O `app` fornecerá a API, o painel responsivo, o webhook Meta e o controle de autenticação. O `worker` processará conversas assíncronas, lembretes e retentativas. O PostgreSQL será a fonte única da verdade. Redis fornecerá filas, locks temporários e idempotência operacional.

O motor de conversa usará o GPT-5.6 Luna com esforço de raciocínio baixo e function calling. O modelo receberá somente ferramentas tipadas; a aplicação validará toda solicitação antes de executar qualquer alteração. O `gpt-oss-20b` local não fará parte do caminho crítico da primeira versão.

O painel e o webhook serão publicados atrás do Cloudflare. PostgreSQL e Redis permanecerão sem exposição pública.

## Fluxo de atendimento

1. Identificar cliente nova ou recorrente.
2. Entender o objetivo em linguagem natural.
3. Consultar somente serviços cadastrados.
4. Informar preço, duração e orientações aprovadas.
5. Consultar disponibilidade real.
6. Oferecer horários.
7. Repetir serviço, data, hora, preço e profissional.
8. Reservar atomicamente após confirmação.
9. Confirmar a reserva.
10. Permitir reagendamento e cancelamento conforme regras configuráveis.
11. Enviar lembretes por templates oficiais.
12. Transferir para a profissional quando solicitado, quando houver exceção ou quando a IA não tiver segurança.

A IA não fará diagnóstico, prescrição, promessa de resultado ou orientação clínica. O chatbot armazenará somente dados comerciais e operacionais, não dados clínicos. O GPT-5.6 Luna não receberá áudio diretamente: áudios serão transcritos localmente e imagens serão encaminhadas à profissional.

## Agenda e domínio de dados

Reservas terão os estados `pendente`, `confirmada`, `cancelada`, `concluída` e `não compareceu`. A disponibilidade será calculada como expediente menos bloqueios, reservas e intervalos do serviço. Uma restrição transacional impedirá colisões concorrentes.

O fuso será `America/Sao_Paulo`. A administradora poderá criar serviços, horários, bloqueios, encaixes e reservas manuais. A estrutura suportará novas profissionais sem migração.

## Painel

- Agenda diária, semanal e mensal.
- Conversas, histórico, assumir atendimento e pausar/devolver IA.
- Cadastro de serviços e regras comerciais.
- Cadastro de profissionais e expedientes.
- Cadastro de clientes, histórico, preferências e consentimentos.

## Segurança e continuidade

- Validação de assinatura do webhook Meta.
- Segredos somente em variáveis protegidas.
- Autenticação de painel com expiração de sessão.
- Auditoria de reservas, cancelamentos, alterações e ações da IA.
- Deduplicação de eventos e mensagens.
- Backups diários no `RAID1_WD` e teste periódico de restauração.
- Monitoramento de app, worker, banco, Redis, webhook e Cloudflare Tunnel.
- Pausa global da IA e assunção manual de conversa.
- Retenção, exportação e exclusão configuráveis para dados de clientes.

## Custos previstos

Estimativa inicial: R$ 20–70/mês, sem marketing e em baixo volume. Inclui mensagens transacionais da Meta, uso do GPT-5.6 Luna, transcrição local e energia incremental do homelab. A Meta cobra por mensagem entregue conforme categoria e país; tarifas devem ser recalculadas no rate card vigente no momento da ativação.

## Critérios de aceite

- Mensagem real chega e recebe resposta.
- IA entende solicitação livre sem inventar dados.
- Serviço, preço e horários vêm do banco.
- Concorrência não cria dupla reserva.
- Confirmação só ocorre depois da gravação.
- Reagendamento e cancelamento funcionam.
- Lembrete oficial é entregue.
- Painel permite bloquear horários e inserir reservas.
- Falhas não criam reservas incorretas.
- Reinício preserva dados.
- Backup restaura com sucesso.
- Banco e Redis não são públicos.
- Auditoria reconstrói alterações.
- Segunda profissional pode ser adicionada pelo painel.

## Fora do escopo inicial

- Recepção.
- Pagamento ou sinal.
- Campanhas de marketing.
- Dados clínicos e anamnese.
- Integração obrigatória com plataforma externa de agenda.
