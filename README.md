# IntraNotes

A self-hosted, Obsidian-style personal knowledge base — installable as a PWA, works offline, and augmented with AI. Rich-text notes, `[[wiki-links]]` with backlinks, a force-directed graph view, tags, an embedded drawing pad, and AI-powered semantic search, link suggestions, and URL summarization.

## Features

- **Rich text editor** (TipTap) — headings, lists, tasks, tables, code blocks with syntax highlighting, images, highlights, text alignment.
- **`[[Wiki-links]]` & backlinks** — type `[[Note Title]]` to link notes; click to jump (or auto-create the note). A backlinks panel shows what links to the current note.
- **Graph view** — D3 force-directed graph of every note and link.
- **Tags** — colored tags with a per-note tag browser.
- **Drawing pad** — Excalidraw canvas, inserted into notes as images (lazy-loaded).
- **AI (optional)** — hybrid BM25 + vector semantic search, "suggest links" from embeddings, and one-click URL → structured note summarization. Powered by Supabase Edge Functions (OpenAI embeddings + Anthropic Claude).
- **Offline-first PWA** — IndexedDB note cache and an offline mutation outbox that flushes when you reconnect; Supabase Realtime keeps sessions in sync.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, Tailwind CSS, Zustand |
| Editor | TipTap 2 |
| Graph | D3 |
| Drawing | Excalidraw |
| Backend | Supabase (Postgres + `pgvector`, Auth, Storage, Realtime, Edge Functions) |
| AI | OpenAI `text-embedding-3-small`, Anthropic Claude |
| Hosting | Vercel (frontend), Supabase (backend) |

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- (Optional, for AI features) OpenAI and Anthropic API keys

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` with your Supabase project URL and anon key (Project Settings → API):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` entries are **only** used server-side by Edge Functions (step 4) — never expose them in the client.

### 3. Set up the database

**Easiest:** open the Supabase dashboard → **SQL Editor** → **New query**, paste the entire contents of [`supabase/setup.sql`](supabase/setup.sql), and click **Run**. That single script runs all migrations at once.

**Or** with the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Either way this creates the tables, the `hybrid_search` / `match_notes_by_embedding` functions, row-level security policies, and the `media` storage bucket. (`supabase/setup.sql` also inserts an optional welcome note.)

### 4. Deploy Edge Functions (optional — enables AI features)

The app runs fully without these; AI search, link suggestions, and URL summarization simply won't be available.

```bash
supabase functions deploy generate-embedding
supabase functions deploy smart-search
supabase functions deploy suggest-links
supabase functions deploy summarize-url

# Provide the server-side secrets they need:
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
```

### 5. Auth

The app uses passwordless magic-link auth. In the Supabase dashboard (Authentication → URL Configuration), add your site URL (`http://localhost:5173` for local dev) to the redirect allow-list.

## Development

```bash
npm run dev      # start the dev server at http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
npm run lint     # eslint
```

## Deployment

The frontend is a static SPA. `vercel.json` is preconfigured (build command, SPA rewrites, service-worker headers). Import the repo into Vercel and set the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables. Any static host works if you replicate the SPA rewrite rules.

## Project structure

```
src/
  components/    Editor, sidebar, search, graph, tags, backlinks, drawing pad
  pages/         AuthPage, MainLayout
  hooks/         useAutoSave, useOfflineSync, useRealtimeSync
  lib/           supabase client + queries, ai (edge fn calls), store (zustand), offline (IndexedDB)
supabase/
  migrations/    Postgres schema, search functions, RLS, storage bucket
  functions/     Deno Edge Functions (embeddings, hybrid search, link suggestions, URL summary)
```
