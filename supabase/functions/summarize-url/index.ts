import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function extractTextFromUrl(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; IntraNotes/1.0)" },
  })
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`)
  const html = await res.text()

  // Basic HTML stripping
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : "Untitled"

  // Remove scripts, styles, nav, footer
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return { title, text: cleaned.slice(0, 12000) }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { url } = await req.json()
    if (!url) {
      return new Response(JSON.stringify({ error: "url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const { title, text } = await extractTextFromUrl(url)

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: `You are a research assistant. Given webpage content, produce a structured summary as a JSON object with these keys:
- "title": a clean, descriptive title for the note
- "summary": 2-3 sentence executive summary
- "key_points": array of 3-7 bullet-point strings
- "tags": array of 3-6 lowercase tag strings
- "source": the original URL
Respond ONLY with valid JSON.`,
        messages: [{
          role: "user",
          content: `URL: ${url}\n\nPage title: ${title}\n\nContent:\n${text}`,
        }],
      }),
    })

    if (!claudeRes.ok) throw new Error(`Claude API error: ${await claudeRes.text()}`)

    const claudeData = await claudeRes.json()
    let structured: Record<string, unknown>
    try {
      structured = JSON.parse(claudeData.content[0].text)
    } catch (_) {
      structured = {
        title,
        summary: claudeData.content[0].text,
        key_points: [],
        tags: [],
        source: url,
      }
    }

    // Build TipTap-compatible content JSON
    const tiptapContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: structured.title }] },
        { type: "paragraph", content: [{ type: "text", text: `Source: ${url}` }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Summary" }] },
        { type: "paragraph", content: [{ type: "text", text: structured.summary }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Key Points" }] },
        {
          type: "bulletList",
          content: (structured.key_points as string[] ?? []).map((p) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: p }] }],
          })),
        },
      ],
    }

    return new Response(JSON.stringify({ ...structured, tiptap_content: tiptapContent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
