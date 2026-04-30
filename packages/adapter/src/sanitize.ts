// packages/adapter/src/sanitize.ts

const MAX_DEPTH = 10
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 100

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]'
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
  if (value instanceof Map) {
    return {
      __type: 'Map',
      entries: Array.from(value.entries())
        .slice(0, MAX_ARRAY_LENGTH)
        .map(([k, v]) => [sanitize(k, depth + 1), sanitize(v, depth + 1)]),
    }
  }
  if (value instanceof Set) {
    return {
      __type: 'Set',
      values: Array.from(value).slice(0, MAX_ARRAY_LENGTH).map((v) => sanitize(v, depth + 1)),
    }
  }
  // Detect DOM nodes (works in browser and is safe to check)
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return `[DOMNode: ${(value as Element).tagName ?? value.nodeName}]`
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_LENGTH)
    const result = sliced.map((v) => sanitize(v, depth + 1))
    if (value.length > MAX_ARRAY_LENGTH) result.push(`[…${value.length - MAX_ARRAY_LENGTH} more]`)
    return result
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    let count = 0
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count++ > 100) { result['…'] = '[truncated]'; break }
      result[k] = sanitize(v, depth + 1)
    }
    return result
  }
  return String(value)
}
