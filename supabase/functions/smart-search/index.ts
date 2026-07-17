import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Query Metadata Decomposition: extract intent, keywords, filters
async function decomposeQuery(query: string): Promise<{
  clean_query: string
  keywords: string[]
  date_filter?: { before?: string; after?: string }
  tag_filter?: string[]
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: `You decompose natural language search queries into structured metadata.
Respond ONLY with JSON: { "clean_query": string, "keywords": string[], "date_filter": { "before"?: "YYYY-MM-DD", "after"?: "YYYY-MM-DD" } | null, "tag_filter": string[] | null }`,
      messages: [{ role: "user", content: `Query: "${query}"` }],
    }),
  })

  if (!res.ok) return { clean_query: query, keywords: [query] }

  try {
    const data = await res.json()
    return JSON.parse(data.content[0].text)
  } catch (_) {
    return { clean_query: query, keywords: [query] }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { query, limit = 15 } = await req.json()
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // Step 1: Decompose query
    const decomposed = await decomposeQuery(query)

    // Step 2: Generate embedding for vector search
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: decomposed.clean_query,
        dimensions: 1536,
      }),
    })

    if (!embedRes.ok) throw new Error(`OpenAI error: ${await embedRes.text()}`)
    const { data: embedData } = await embedRes.json()
    const embedding = embedData[0].embedding

    // Step 3: Hybrid search via stored function
    const { data: results, error } = await supabase.rpc("hybrid_search", {
      query_text: decomposed.clean_query,
      query_embed: `[${embedding.join(",")}]`,
      match_count: limit,
    })

    if (error) throw error

    return new Response(JSON.stringify({
      results: results ?? [],
      decomposed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
