-- ============================================================
-- IntraNotes — one-shot database setup
-- Paste this whole file into the Supabase dashboard SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- Combines migrations 001 + 002 + 003 (003 seed is optional).
-- ============================================================

-- ============================================================
-- IntraNotes — Initial Schema
-- Run this against your Supabase project via:
--   supabase db push  OR  paste into the SQL editor
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector";
create extension if not exists "pg_trgm";  -- for BM25-style full-text ranking

-- ============================================================
-- FOLDERS
-- ============================================================
create table if not exists folders (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  parent_id   uuid references folders(id) on delete cascade,
  "order"     integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists folders_parent_id_idx on folders(parent_id);

-- Root sentinel (parent_id IS NULL = top level)
insert into folders (id, name, parent_id, "order")
values ('00000000-0000-0000-0000-000000000001', 'Notes', null, 0)
on conflict do nothing;

-- ============================================================
-- NOTES
-- ============================================================
create table if not exists notes (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null default 'Untitled',
  content     jsonb not null default '{}',         -- TipTap JSON doc
  content_text text not null default '',            -- plain-text extraction of `content`, kept in sync by the client
  folder_id   uuid references folders(id) on delete set null,
  is_pinned   boolean not null default false,
  word_count  integer not null default 0,
  embedding   vector(1536),                        -- OpenAI text-embedding-3-small
  fts         tsvector generated always as (
                to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, ''))
              ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_folder_id_idx   on notes(folder_id);
create index if not exists notes_fts_idx         on notes using gin(fts);
create index if not exists notes_embedding_idx   on notes using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
create index if not exists notes_updated_at_idx  on notes(updated_at desc);

-- ============================================================
-- NOTE ALIASES (a note can appear in multiple folders)
-- ============================================================
create table if not exists note_aliases (
  id          uuid primary key default uuid_generate_v4(),
  note_id     uuid not null references notes(id) on delete cascade,
  folder_id   uuid not null references folders(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique(note_id, folder_id)
);

-- ============================================================
-- WIKI LINKS (backlinks)
-- ============================================================
create table if not exists links (
  id              uuid primary key default uuid_generate_v4(),
  source_note_id  uuid not null references notes(id) on delete cascade,
  target_note_id  uuid not null references notes(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique(source_note_id, target_note_id)
);

create index if not exists links_source_idx on links(source_note_id);
create index if not exists links_target_idx on links(target_note_id);

-- ============================================================
-- TAGS
-- ============================================================
create table if not exists tags (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  color       text not null default '#6366f1',
  created_at  timestamptz not null default now()
);

create table if not exists note_tags (
  note_id  uuid not null references notes(id) on delete cascade,
  tag_id   uuid not null references tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

create index if not exists note_tags_tag_id_idx on note_tags(tag_id);

-- ============================================================
-- MEDIA
-- ============================================================
create table if not exists media (
  id            uuid primary key default uuid_generate_v4(),
  note_id       uuid not null references notes(id) on delete cascade,
  storage_path  text not null,           -- path in Supabase Storage bucket
  media_type    text not null,           -- 'image' | 'video' | 'drawing'
  filename      text,
  size_bytes    bigint,
  width         integer,
  height        integer,
  created_at    timestamptz not null default now()
);

create index if not exists media_note_id_idx on media(note_id);

-- ============================================================
-- OFFLINE SYNC QUEUE (mirrors IndexedDB for conflict resolution)
-- ============================================================
create table if not exists sync_queue (
  id          uuid primary key default uuid_generate_v4(),
  table_name  text not null,
  operation   text not null check (operation in ('insert','update','delete')),
  record_id   uuid not null,
  payload     jsonb,
  synced_at   timestamptz,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Update updated_at automatically
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_updated_at   before update on notes   for each row execute function set_updated_at();
create trigger folders_updated_at before update on folders for each row execute function set_updated_at();

-- Hybrid search: combines tsvector BM25 rank + cosine vector similarity
-- Usage: select * from hybrid_search('my query', '[0.1,0.2,...]'::vector, 10);
create or replace function hybrid_search(
  query_text   text,
  query_embed  vector(1536),
  match_count  int default 10,
  bm25_weight  float default 0.4,
  vec_weight   float default 0.6
)
returns table (
  id          uuid,
  title       text,
  folder_id   uuid,
  updated_at  timestamptz,
  bm25_score  float,
  vec_score   float,
  score       float
)
language sql stable as $$
  with bm25 as (
    select
      id,
      ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) as bm25_score
    from notes
    where fts @@ websearch_to_tsquery('english', query_text)
  ),
  vec as (
    select
      id,
      1 - (embedding <=> query_embed) as vec_score
    from notes
    where embedding is not null
    order by embedding <=> query_embed
    limit match_count * 3
  ),
  combined as (
    select
      coalesce(b.id, v.id) as id,
      coalesce(b.bm25_score, 0)              as bm25_score,
      coalesce(v.vec_score, 0)               as vec_score,
      coalesce(b.bm25_score, 0) * bm25_weight
        + coalesce(v.vec_score, 0) * vec_weight as score
    from bm25 b
    full outer join vec v on b.id = v.id
  )
  select
    n.id, n.title, n.folder_id, n.updated_at,
    c.bm25_score, c.vec_score, c.score
  from combined c
  join notes n on n.id = c.id
  order by c.score desc
  limit match_count;
$$;

-- Backlink count helper
create or replace function backlink_count(note_uuid uuid)
returns bigint language sql stable as $$
  select count(*) from links where target_note_id = note_uuid;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- (Single-user app — RLS gates on auth.uid() being present)
-- ============================================================

alter table notes       enable row level security;
alter table folders     enable row level security;
alter table note_aliases enable row level security;
alter table links       enable row level security;
alter table tags        enable row level security;
alter table note_tags   enable row level security;
alter table media       enable row level security;
alter table sync_queue  enable row level security;

-- Allow all operations for authenticated users (single-user app)
create policy "authenticated_all" on notes       for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on folders     for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on note_aliases for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on links       for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on tags        for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on note_tags   for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on media       for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on sync_queue  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  52428800,  -- 50 MB
  array['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','video/mp4','video/webm']
)
on conflict (id) do nothing;

create policy "auth_read_media"   on storage.objects for select using (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "auth_insert_media" on storage.objects for insert with check (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "auth_delete_media" on storage.objects for delete using (bucket_id = 'media' and auth.role() = 'authenticated');


-- Vector similarity search function used by suggest-links Edge Function
create or replace function match_notes_by_embedding(
  query_embedding  vector(1536),
  exclude_id       uuid,
  match_count      int default 5
)
returns table (
  id         uuid,
  title      text,
  folder_id  uuid,
  vec_score  float
)
language sql stable as $$
  select
    id,
    title,
    folder_id,
    1 - (embedding <=> query_embedding) as vec_score
  from notes
  where
    embedding is not null
    and id <> exclude_id
  order by embedding <=> query_embedding
  limit match_count;
$$;


-- Optional seed: creates a welcome note in the default root folder
-- Run this after 001_initial_schema.sql if you want a starter note

insert into notes (title, content, folder_id)
values (
  'Welcome to IntraNotes',
  '{
    "type": "doc",
    "content": [
      {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Welcome to IntraNotes 👋"}]},
      {"type": "paragraph", "content": [{"type": "text", "text": "This is your personal knowledge base. Here''s what you can do:"}]},
      {"type": "bulletList", "content": [
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Write notes with rich formatting (headings, code blocks, tables)"}]}]},
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Link notes with [[Note Title]] wiki-style links"}]}]},
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Use ⌘K to search across all your notes with AI hybrid search"}]}]},
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Paste a URL to get an AI-summarized note automatically"}]}]},
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Draw diagrams with the embedded Excalidraw pad"}]}]}
      ]},
      {"type": "paragraph", "content": [{"type": "text", "text": "Start typing to edit this note, or create a new one in the sidebar."}]}
    ]
  }',
  '00000000-0000-0000-0000-000000000001'
)
on conflict do nothing;
