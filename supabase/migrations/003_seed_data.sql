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
