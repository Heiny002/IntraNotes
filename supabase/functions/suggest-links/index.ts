import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { note_id, text, limit = 5 } = await req.json()
    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // Embed the current note text
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8192),
        dimensions: 1536,
      }),
    })

    if (!embedRes.ok) throw new Error(`OpenAI embedding failed: ${await embedRes.text()}`)
    const { data } = await embedRes.json()
    const embedding = data[0].embedding

    // Vector similarity search, excluding current note
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const vectorStr = `[${embedding.join(",")}]`

    const { data: similar, error } = await supabase.rpc("match_notes_by_embedding", {
      query_embedding: vectorStr,
      exclude_id: note_id ?? "00000000-0000-0000-0000-000000000000",
      match_count: limit,
    })

    if (error) throw error

    // Ask Claude to explain why each note is related
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 512,
        system: "You are a knowledge assistant. Given a source note and a list of related notes, briefly explain (1 sentence each) why each related note is semantically connected to the source.",
        messages: [{
          role: "user",
          content: `Source note text:\n\n${text.slice(0, 1000)}\n\nRelated notes:\n${
            (similar || []).map((n: any, i: number) => `${i + 1}. "${n.title}"`).join("\n")
          }\n\nRespond with a JSON array: [{"title": "...", "reason": "..."}]`,
        }],
      }),
    })

    let enriched = similar || []
    if (anthropicRes.ok) {
      try {
        const claudeData = await anthropicRes.json()
        const reasons = JSON.parse(claudeData.content[0].text)
        enriched = enriched.map((n: any, i: number) => ({
          ...n,
          reason: reasons[i]?.reason ?? "",
        }))
      } catch (_) { /* fall through with plain results */ }
    }

    return new Response(JSON.stringify({ suggestions: enriched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
