create unique index outbox_messages_appointment_reminder_kind_uidx
  on outbox_messages (appointment_id, reminder_kind)
  where appointment_id is not null and reminder_kind is not null;
