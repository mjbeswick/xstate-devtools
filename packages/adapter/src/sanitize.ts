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
    const entries: [unknown, unknown][] = []
    for (const [k, v] of value as Map<unknown, unknown>) {
      if (entries.length >= MAX_ARRAY_LENGTH) break
      entries.push([sanitize(k, depth + 1), sanitize(v, depth + 1)])
    }
    return { __type: 'Map', entries }
  }
  if (value instanceof Set) {
    const values: unknown[] = []
    for (const v of value as Set<unknown>) {
      if (values.length >= MAX_ARRAY_LENGTH) break
      values.push(sanitize(v, depth + 1))
    }
    return { __type: 'Set', values }
  }
  if (value instanceof Promise) return '[Promise]'
  if (value instanceof WeakMap || value instanceof WeakSet) return '[WeakCollection]'
  if (ArrayBuffer.isView(value)) return `[TypedArray: ${(value as any).constructor.name}]`
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
      if (count++ >= MAX_ARRAY_LENGTH) { result['…'] = '[truncated]'; break }
      result[k] = sanitize(v, depth + 1)
    }
    return result
  }
  return String(value)
}
