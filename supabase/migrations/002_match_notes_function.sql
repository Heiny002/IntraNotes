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
