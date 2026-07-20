import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// The "librarian": given a note plus context, return tags to apply and which of
// the candidate note-titles are genuine references worth linking. One Claude
// call, no embeddings — so this runs on an Anthropic key alone.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { title = "", text = "", existing_tags = [], candidate_titles = [] } = await req.json()
    if (!text || !String(text).trim()) {
      return new Response(JSON.stringify({ tags: [], link_titles: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const system = `You organize a personal knowledge base. Respond with ONLY a JSON object of the form:
{ "tags": string[], "link_titles": string[] }

Rules:
- "tags": 3-6 short, lowercase, single-or-two-word topical tags describing this note. STRONGLY prefer reusing a tag from EXISTING_TAGS when it fits; only invent a new tag when nothing existing applies.
- "link_titles": the subset of CANDIDATE_TITLES that the note GENUINELY references (the note actually discusses that topic — not just an incidental appearance of the word). Return [] if none apply. NEVER include a title that is not exactly present in CANDIDATE_TITLES.
Respond with the JSON object and nothing else.`

    const user = `NOTE TITLE: ${title}

EXISTING_TAGS: ${JSON.stringify(existing_tags)}

CANDIDATE_TITLES: ${JSON.stringify(candidate_titles)}

NOTE TEXT:
${String(text).slice(0, 8000)}`

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system,
        messages: [{ role: "user", content: user }],
      }),
    })

    if (!res.ok) throw new Error(`Claude API error: ${await res.text()}`)
    const data = await res.json()
    const raw = data?.content?.[0]?.text ?? ""

    let out: { tags?: unknown; link_titles?: unknown } = {}
    try {
      out = JSON.parse(raw)
    } catch (_) {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) { try { out = JSON.parse(m[0]) } catch (_) { out = {} } }
    }

    const tags = Array.isArray(out.tags)
      ? out.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8)
      : []

    // Guard: only ever return titles that were offered as candidates.
    const candidateSet = new Set((candidate_titles as string[]).map((c) => String(c).toLowerCase()))
    const link_titles = Array.isArray(out.link_titles)
      ? out.link_titles.filter((t) => candidateSet.has(String(t).toLowerCase()))
      : []

    return new Response(JSON.stringify({ tags, link_titles }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
