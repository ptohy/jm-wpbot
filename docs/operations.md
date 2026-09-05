# Operação e recuperação

## Backup

O backup deve ser executado fora dos containers, em uma rotina do host/Portainer:

```bash
DATABASE_URL='postgres://booking:...@postgres:5432/booking' \
BACKUP_DIR=/srv/backups/jm-wpbot \
BACKUP_PASSPHRASE_FILE=/run/secrets/jm-wpbot-backup-passphrase \
deploy/backup.sh
```

O arquivo de senha deve existir somente no host, com permissão `0600`. Os arquivos `.sql.gz.gpg` são cifrados com AES-256 e devem ser replicados para armazenamento offsite (R2/B2). Nunca grave a senha no repositório, no Compose ou nos logs.

A retenção padrão é de 35 dias e pode ser alterada por `BACKUP_RETENTION_DAYS`.

## Teste de restauração

Use um banco temporário, nunca a base de produção:

```bash
DATABASE_URL='postgres://booking:...@restore-db:5432/booking_restore' \
BACKUP_PASSPHRASE_FILE=/run/secrets/jm-wpbot-backup-passphrase \
deploy/restore.sh /srv/backups/jm-wpbot/jm-wpbot-AAAAmmddTHHMMSSZ.sql.gz.gpg
```

O teste é aprovado quando o script termina com `restore=ok` e as migrações/consultas básicas funcionam no banco restaurado.

## Saúde

- `GET /healthz`: processo HTTP ativo.
- O healthcheck do Compose valida também a disponibilidade do Postgres.
- Falha no worker não deve ser mascarada por um healthcheck HTTP; acompanhe os logs do serviço worker e os registros de outbox/retry.
