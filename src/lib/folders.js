/**
 * Flatten the folder tree into a depth-ordered list for pickers/menus.
 * Returns [{ id, name, depth }] in display order (parents before children).
 */
export function flattenFolders(folders) {
  const byParent = {}
  for (const f of folders) {
    const key = f.parent_id || '__root__'
    ;(byParent[key] ??= []).push(f)
  }
  for (const key of Object.keys(byParent)) {
    byParent[key].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || ''))
  }
  const out = []
  function walk(key, depth) {
    for (const f of byParent[key] || []) {
      out.push({ id: f.id, name: f.name, depth })
      walk(f.id, depth + 1)
    }
  }
  walk('__root__', 0)
  return out
}

/** Ids of all folders nested (at any depth) under `folderId`. */
export function getDescendantIds(folderId, folders) {
  const out = new Set()
  const stack = [folderId]
  while (stack.length) {
    const id = stack.pop()
    for (const f of folders) {
      if (f.parent_id === id && !out.has(f.id)) { out.add(f.id); stack.push(f.id) }
    }
  }
  return out
}
