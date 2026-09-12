alter table messages add column if not exists media_transcription_status text check (media_transcription_status in ('pending','completed','failed','rejected'));
alter table messages add column if not exists media_transcription_text text;
alter table messages add column if not exists media_transcription_error text;
