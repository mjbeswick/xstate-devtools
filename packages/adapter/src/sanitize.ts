// packages/adapter/src/sanitize.ts

const MAX_DEPTH = 10
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 100
// Node budget. The per-level caps above still allow multiplicative blow-up
// (100^depth) on wide+deep or cross-linked objects, which can produce a string
// too large for JSON.stringify to handle. This bounds the output regardless of
// shape. Each TOP-LEVEL key of the root value gets its OWN slice of this budget
// (see the object branch) so one huge value — a store, an actor ref, a logger —
// can't spend it all depth-first and leave the rest of the context as "[Truncated]".
const MAX_NODES = 20000
const MIN_KEY_BUDGET = 500

interface Ctx {
  depth: number
  /** Mutable node counter + ceiling — per top-level key at the root, shared below it. */
  budget: { n: number; max: number }
  /** Objects/arrays seen on the current path + elsewhere, to break cycles and DAGs. */
  seen: WeakSet<object>
}

function sanitizeInner(value: unknown, ctx: Ctx): unknown {
  if (ctx.depth > MAX_DEPTH) return '[MaxDepth]'
  if (++ctx.budget.n > ctx.budget.max) return '[Truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + '…' : value
  }
  if (typeof value === 'function') return `[Function: ${value.name || '(anonymous)'}]`
  if (typeof value === 'symbol') return `[Symbol: ${value.description ?? ''}]`
  if (typeof value === 'bigint') return `[BigInt: ${value}]`
  if (value instanceof Error) return { __type: 'Error', name: value.name, message: value.message }
  if (value instanceof Date) return { __type: 'Date', iso: value.toISOString() }
  if (value instanceof RegExp) return { __type: 'RegExp', source: value.source, flags: value.flags }
  if (value instanceof Promise) return '[Promise]'
  if (value instanceof WeakMap || value instanceof WeakSet) return '[WeakCollection]'
  if (ArrayBuffer.isView(value)) return `[TypedArray: ${(value as any).constructor.name}]`
  // Detect DOM nodes (works in browser and is safe to check)
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return `[DOMNode: ${(value as Element).tagName ?? value.nodeName}]`
  }

  // Respect toJSON, like JSON.stringify — critical for XState ActorRefs held in
  // context (e.g. `receiver`/spawned children): their toJSON is a tiny
  // { xstate$$type, id } marker, whereas recursing into the raw ref walks the
  // whole actor system and eats the node budget, truncating everything else.
  // Not for Map/Set/Array (handled below) or plain objects (no toJSON).
  if (!Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) &&
      typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    try {
      const json = (value as { toJSON: () => unknown }).toJSON()
      if (json !== value) { return sanitizeInner(json, ctx) }
    } catch { /* fall through to normal object handling */ }
  }

  // From here on we recurse into containers — guard against shared/circular refs.
  if (ctx.seen.has(value as object)) return '[Circular]'
  ctx.seen.add(value as object)
  const child = { ...ctx, depth: ctx.depth + 1 }

  if (value instanceof Map) {
    const entries: [unknown, unknown][] = []
    for (const [k, v] of value as Map<unknown, unknown>) {
      if (entries.length >= MAX_ARRAY_LENGTH) break
      entries.push([sanitizeInner(k, child), sanitizeInner(v, child)])
    }
    return { __type: 'Map', entries }
  }
  if (value instanceof Set) {
    const values: unknown[] = []
    for (const v of value as Set<unknown>) {
      if (values.length >= MAX_ARRAY_LENGTH) break
      values.push(sanitizeInner(v, child))
    }
    return { __type: 'Set', values }
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_LENGTH)
    const result = sliced.map((v) => sanitizeInner(v, child))
    if (value.length > MAX_ARRAY_LENGTH) result.push(`[…${value.length - MAX_ARRAY_LENGTH} more]`)
    return result
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const result: Record<string, unknown> = {}
    // At the root, fair-share the budget across top-level keys so a giant value
    // can't starve the rest into "[Truncated]" (depth-first would spend it early).
    const perKey = ctx.depth === 0 && entries.length > 0
      ? Math.max(MIN_KEY_BUDGET, Math.floor(MAX_NODES / Math.min(entries.length, MAX_ARRAY_LENGTH)))
      : 0
    let count = 0
    for (const [k, v] of entries) {
      if (count++ >= MAX_ARRAY_LENGTH) { result['…'] = '[truncated]'; break }
      const kctx = perKey ? { ...child, budget: { n: 0, max: perKey } } : child
      result[k] = sanitizeInner(v, kctx)
    }
    return result
  }
  return String(value)
}

export function sanitize(value: unknown): unknown {
  return sanitizeInner(value, { depth: 0, budget: { n: 0, max: MAX_NODES }, seen: new WeakSet() })
}
