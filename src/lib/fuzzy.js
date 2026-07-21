/**
 * Lightweight fuzzy matching for the [[wiki-link]] autocomplete.
 * Handles typos like "motive" → "Motiv" (prefix/edit-distance) and
 * abbreviations like "mtv" → "Motiv" (subsequence).
 */

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

function isSubsequence(q, t) {
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++
  }
  return i === q.length
}

/** 0 (no match) … 1 (exact). */
export function fuzzyScore(query, title) {
  const q = (query || '').toLowerCase().trim()
  const t = (title || '').toLowerCase().trim()
  if (!t) return 0
  if (!q) return 0.2 // empty query → show everything, lightly ranked
  if (t === q) return 1
  if (t.startsWith(q) || q.startsWith(t)) return 0.9
  if (t.includes(q) || q.includes(t)) return 0.75
  if (isSubsequence(q, t)) return 0.55
  const sim = 1 - levenshtein(q, t) / Math.max(q.length, t.length)
  return sim >= 0.6 ? sim * 0.7 : 0
}

/** Rank notes by fuzzy match to `query`. Returns [{ note, score }] descending. */
export function rankNotes(query, notes, limit = 6) {
  return notes
    .map((note) => ({ note, score: fuzzyScore(query, note.title || '') }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
