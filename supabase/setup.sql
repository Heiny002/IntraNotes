-- ============================================================
-- IntraNotes — one-shot database setup
-- Paste this whole file into the Supabase dashboard SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- Combines migrations 001 + 002 + 003 + 004.
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


-- Default "How to use IntraNotes" guide note.
-- Idempotent: only inserts if a note with this title doesn't already exist.

insert into notes (title, content, content_text, folder_id)
select
  'How to use IntraNotes',
  '{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"How to use IntraNotes 📓"}]},{"type":"paragraph","content":[{"type":"text","text":"IntraNotes is your personal knowledge base — rich notes, wiki-style links, tags, a graph view, drawing, and optional AI. This guide walks through everything. Feel free to edit or delete it once you know your way around."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"1. Notes & folders"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Hover a folder in the left sidebar to reveal "},{"type":"text","text":"＋ note","marks":[{"type":"bold"}]},{"type":"text","text":" and "},{"type":"text","text":"＋ folder","marks":[{"type":"bold"}]},{"type":"text","text":" buttons."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Click a note to open it. Give it a title at the top, then start writing below."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Everything you type "},{"type":"text","text":"auto-saves","marks":[{"type":"bold"}]},{"type":"text","text":" about 1.5 seconds after you stop — watch the “Saving / Saved” indicator in the top-right of the toolbar."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Hover a note and click "},{"type":"text","text":"×","marks":[{"type":"code"}]},{"type":"text","text":" to delete it."}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"2. Formatting"}]},{"type":"paragraph","content":[{"type":"text","text":"The toolbar above each note covers the essentials:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Text:","marks":[{"type":"bold"}]},{"type":"text","text":" bold, italic, underline, strikethrough, inline code"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Lists:","marks":[{"type":"bold"}]},{"type":"text","text":" bullet, numbered, and checkable task lists"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Blocks:","marks":[{"type":"bold"}]},{"type":"text","text":" tables, code blocks with syntax highlighting, alignment"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Media:","marks":[{"type":"bold"}]},{"type":"text","text":" upload images, or open the drawing pad (see §6)"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"3. Link your notes with [[wiki-links]]"}]},{"type":"paragraph","content":[{"type":"text","text":"This is the heart of IntraNotes. Type two square brackets around a note’s title to link to it:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"[[Note title]]","marks":[{"type":"code"}]},{"type":"text","text":" becomes a clickable link."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Click a link to jump to that note — or, if it doesn’t exist yet, IntraNotes "},{"type":"text","text":"creates it for you","marks":[{"type":"bold"}]},{"type":"text","text":" on the spot."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Try it now, this is a real link: "},{"type":"text","text":"[[My First Note]]","marks":[{"type":"code"}]},{"type":"text","text":" — click it to create that note."}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Backlinks:","marks":[{"type":"bold"}]},{"type":"text","text":" open the backlinks panel (the dashboard icon in the sidebar) to see every note that links to the one you’re viewing. Connections build themselves as you write."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"4. Tags"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Open the "},{"type":"text","text":"Tags","marks":[{"type":"bold"}]},{"type":"text","text":" panel (tag icon in the sidebar) while a note is open."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Create a colored tag and click to apply or remove it. Tags are shared across all notes, so you can group ideas across folders."}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"5. Find anything — ⌘K"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Press "},{"type":"text","text":"⌘K","marks":[{"type":"code"}]},{"type":"text","text":" (or "},{"type":"text","text":"Ctrl+K","marks":[{"type":"code"}]},{"type":"text","text":") anywhere to open search."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Navigate results with "},{"type":"text","text":"↑","marks":[{"type":"code"}]},{"type":"text","text":" / "},{"type":"text","text":"↓","marks":[{"type":"code"}]},{"type":"text","text":" and press "},{"type":"text","text":"Enter","marks":[{"type":"code"}]},{"type":"text","text":" to open."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Toggle the "},{"type":"text","text":"✨ sparkle","marks":[{"type":"bold"}]},{"type":"text","text":" for AI hybrid search (keyword + meaning). Without AI it falls back to fast keyword search."}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"6. Graph, drawing & images"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Graph view","marks":[{"type":"bold"}]},{"type":"text","text":" (branch icon): a force-directed map of every note and link. Click a node to jump to it; drag to rearrange."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Drawing pad","marks":[{"type":"bold"}]},{"type":"text","text":" (pen icon in a note’s toolbar): sketch with Excalidraw and insert it into the note as an image."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Images","marks":[{"type":"bold"}]},{"type":"text","text":" (image icon): upload a picture straight into a note."}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"7. AI features (optional)"}]},{"type":"paragraph","content":[{"type":"text","text":"These need the Supabase Edge Functions deployed with API keys. If they aren’t set up yet, the rest of the app still works fully."}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Suggest links","marks":[{"type":"bold"}]},{"type":"text","text":" (✨ in a note): finds semantically related notes and explains why."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Summarize a URL","marks":[{"type":"bold"}]},{"type":"text","text":" (link icon): paste a web address and get a structured, summarized note."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"AI hybrid search","marks":[{"type":"bold"}]},{"type":"text","text":": smarter "},{"type":"text","text":"⌘K","marks":[{"type":"code"}]},{"type":"text","text":" results that understand meaning, not just keywords."}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"8. Works offline"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"IntraNotes is a "},{"type":"text","text":"PWA","marks":[{"type":"bold"}]},{"type":"text","text":" — install it from your browser’s address bar for an app-like window."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Recent notes are cached, and edits you make offline are queued and synced automatically when you reconnect (watch the counter badge in the sidebar)."}]}]}]},{"type":"horizontalRule"},{"type":"paragraph","content":[{"type":"text","text":"That’s the whole tour. Delete this note whenever you like — or keep it around as a reference. Happy note-taking! 🚀"}]}]}'::jsonb,
  'How to use IntraNotes 📓
IntraNotes is your personal knowledge base — rich notes, wiki-style links, tags, a graph view, drawing, and optional AI. This guide walks through everything. Feel free to edit or delete it once you know your way around.
1. Notes & folders
Hover a folder in the left sidebar to reveal ＋ note and ＋ folder buttons.
Click a note to open it. Give it a title at the top, then start writing below.
Everything you type auto-saves about 1.5 seconds after you stop — watch the “Saving / Saved” indicator in the top-right of the toolbar.
Hover a note and click × to delete it.
2. Formatting
The toolbar above each note covers the essentials:
Text: bold, italic, underline, strikethrough, inline code
Lists: bullet, numbered, and checkable task lists
Blocks: tables, code blocks with syntax highlighting, alignment
Media: upload images, or open the drawing pad (see §6)
3. Link your notes with [[wiki-links]]
This is the heart of IntraNotes. Type two square brackets around a note’s title to link to it:
[[Note title]] becomes a clickable link.
Click a link to jump to that note — or, if it doesn’t exist yet, IntraNotes creates it for you on the spot.
Try it now, this is a real link: [[My First Note]] — click it to create that note.
Backlinks: open the backlinks panel (the dashboard icon in the sidebar) to see every note that links to the one you’re viewing. Connections build themselves as you write.
4. Tags
Open the Tags panel (tag icon in the sidebar) while a note is open.
Create a colored tag and click to apply or remove it. Tags are shared across all notes, so you can group ideas across folders.
5. Find anything — ⌘K
Press ⌘K (or Ctrl+K) anywhere to open search.
Navigate results with ↑ / ↓ and press Enter to open.
Toggle the ✨ sparkle for AI hybrid search (keyword + meaning). Without AI it falls back to fast keyword search.
6. Graph, drawing & images
Graph view (branch icon): a force-directed map of every note and link. Click a node to jump to it; drag to rearrange.
Drawing pad (pen icon in a note’s toolbar): sketch with Excalidraw and insert it into the note as an image.
Images (image icon): upload a picture straight into a note.
7. AI features (optional)
These need the Supabase Edge Functions deployed with API keys. If they aren’t set up yet, the rest of the app still works fully.
Suggest links (✨ in a note): finds semantically related notes and explains why.
Summarize a URL (link icon): paste a web address and get a structured, summarized note.
AI hybrid search: smarter ⌘K results that understand meaning, not just keywords.
8. Works offline
IntraNotes is a PWA — install it from your browser’s address bar for an app-like window.
Recent notes are cached, and edits you make offline are queued and synced automatically when you reconnect (watch the counter badge in the sidebar).
That’s the whole tour. Delete this note whenever you like — or keep it around as a reference. Happy note-taking! 🚀',
  '00000000-0000-0000-0000-000000000001'
where not exists (
  select 1 from notes where title = 'How to use IntraNotes'
);
