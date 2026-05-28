// Snapshot diff view — shows what changed between two serialized XState snapshots.
// No external dependencies; pure recursive diff, consistent with JsonView.
import type { SerializedSnapshot } from '../../shared/types.js'
import { DisclosureTriangle } from './Icons.js'
import { useState } from 'react'

// ---------------------------------------------------------------------------
// Diff data model
// ---------------------------------------------------------------------------

type DiffTag = 'added' | 'removed' | 'changed' | 'unchanged'

interface DiffLeaf {
  kind: 'leaf'
  tag: DiffTag
  /** Defined when tag is 'changed' or 'removed' */
  oldValue?: unknown
  /** Defined when tag is 'changed' or 'added' */
  newValue?: unknown
  /** Defined when tag is 'unchanged' */
  value?: unknown
}

interface DiffObject {
  kind: 'object'
  tag: DiffTag
  entries: Array<{ key: string; child: DiffNode }>
}

interface DiffArray {
  kind: 'array'
  tag: DiffTag
  items: DiffNode[]
}

type DiffNode = DiffLeaf | DiffObject | DiffArray

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

function isPrimitive(v: unknown): boolean {
  if (v === null || v === undefined) return true
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'boolean'
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => jsonEquals(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEquals(a[k], b[k]))
  }
  return false
}

export function computeJsonDiff(before: unknown, after: unknown): DiffNode {
  // Both absent / identical primitives
  if (jsonEquals(before, after)) {
    if (Array.isArray(before)) {
      const items = (before as unknown[]).map((v) => computeJsonDiff(v, v))
      return { kind: 'array', tag: 'unchanged', items }
    }
    if (isPlainObject(before)) {
      const entries = Object.entries(before).map(([k, v]) => ({
        key: k,
        child: computeJsonDiff(v, v),
      }))
      return { kind: 'object', tag: 'unchanged', entries }
    }
    return { kind: 'leaf', tag: 'unchanged', value: before }
  }

  // Type changed or primitive vs object — treat as full replacement
  if (
    isPrimitive(before) ||
    isPrimitive(after) ||
    Array.isArray(before) !== Array.isArray(after) ||
    (isPlainObject(before) && Array.isArray(after)) ||
    (Array.isArray(before) && isPlainObject(after))
  ) {
    return { kind: 'leaf', tag: 'changed', oldValue: before, newValue: after }
  }

  // Both arrays
  if (Array.isArray(before) && Array.isArray(after)) {
    const len = Math.max(before.length, after.length)
    const items: DiffNode[] = []
    let hasChange = false
    for (let i = 0; i < len; i++) {
      const child = computeJsonDiff(before[i], after[i])
      if (child.tag !== 'unchanged') hasChange = true
      items.push(child)
    }
    return { kind: 'array', tag: hasChange ? 'changed' : 'unchanged', items }
  }

  // Both plain objects
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)])
  const entries: DiffObject['entries'] = []
  let hasChange = false
  for (const k of allKeys) {
    const inBefore = Object.prototype.hasOwnProperty.call(b, k)
    const inAfter = Object.prototype.hasOwnProperty.call(a, k)
    let child: DiffNode
    if (inBefore && !inAfter) {
      child = { kind: 'leaf', tag: 'removed', oldValue: b[k] }
      hasChange = true
    } else if (!inBefore && inAfter) {
      child = { kind: 'leaf', tag: 'added', newValue: a[k] }
      hasChange = true
    } else {
      child = computeJsonDiff(b[k], a[k])
      if (child.tag !== 'unchanged') hasChange = true
    }
    entries.push({ key: k, child })
  }
  return { kind: 'object', tag: hasChange ? 'changed' : 'unchanged', entries }
}

// ---------------------------------------------------------------------------
// Colours & rendering helpers
// ---------------------------------------------------------------------------

const INDENT_PX = 14
const MONO: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 11,
  lineHeight: 1.5,
}

const TAG_BG: Record<Exclude<DiffTag, 'unchanged'>, string> = {
  added: 'rgba(0,150,50,0.10)',
  removed: 'rgba(220,30,30,0.10)',
  changed: 'transparent',
}

const TAG_GUTTER: Record<Exclude<DiffTag, 'unchanged'>, string> = {
  added: '#00a832',
  removed: '#cc2020',
  changed: '#888',
}

const colors = {
  key: '#871094',
  string: '#067d17',
  number: '#1750eb',
  boolean: '#0033b3',
  null: '#999',
  punct: '#777',
  bracket: '#444',
  oldValue: '#cc2020',
  newValue: '#007a1e',
}

import type React from 'react'

function Primitive({ value, colorOverride }: { value: unknown; colorOverride?: string }) {
  if (value === null || value === undefined) {
    return (
      <span style={{ color: colorOverride ?? colors.null, fontStyle: 'italic' }}>
        {String(value)}
      </span>
    )
  }
  switch (typeof value) {
    case 'string':
      return (
        <span style={{ color: colorOverride ?? colors.string }}>"{value as string}"</span>
      )
    case 'number':
      return <span style={{ color: colorOverride ?? colors.number }}>{String(value)}</span>
    case 'boolean':
      return <span style={{ color: colorOverride ?? colors.boolean }}>{String(value)}</span>
    default:
      return <span style={{ color: colorOverride ?? colors.null }}>{String(value)}</span>
  }
}

function GutterChar({ tag }: { tag: DiffTag }) {
  if (tag === 'unchanged') return <span style={{ color: 'transparent', userSelect: 'none' }}>{'·'}</span>
  const glyph = tag === 'added' ? '+' : tag === 'removed' ? '-' : '~'
  return <span style={{ color: TAG_GUTTER[tag], fontWeight: 700 }}>{glyph}</span>
}

// Inline display of a simple (non-container) value for the "changed" leaf:
// show old struck-through in red, arrow, new in green.
function ChangedInline({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  return (
    <>
      <span
        style={{ color: colors.oldValue, textDecoration: 'line-through', marginRight: 4 }}
      >
        <Primitive value={oldValue} colorOverride={colors.oldValue} />
      </span>
      <span style={{ color: colors.punct, marginRight: 4 }}>→</span>
      <Primitive value={newValue} colorOverride={colors.newValue} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Recursive diff renderer
// ---------------------------------------------------------------------------

interface DiffNodeProps {
  label?: string | number
  node: DiffNode
  depth: number
  isLast?: boolean
}

function DiffNodeView({ label, node, depth, isLast }: DiffNodeProps) {
  // For objects/arrays that are entirely unchanged and have no changed descendants,
  // we default-collapse them to keep the diff scannable.
  const hasChange = node.tag !== 'unchanged'
  const [open, setOpen] = useState(hasChange || depth < 1)

  const indent = depth === 0 ? 0 : INDENT_PX
  const bg = node.tag !== 'unchanged' ? TAG_BG[node.tag as Exclude<DiffTag, 'unchanged'>] : 'transparent'

  const renderLabel = () =>
    label !== undefined && (
      <>
        <span style={{ color: colors.key }}>{typeof label === 'string' ? `"${label}"` : label}</span>
        <span style={{ color: colors.punct }}>: </span>
      </>
    )

  // ---- Leaf node ----
  if (node.kind === 'leaf') {
    return (
      <div style={{ paddingLeft: indent, background: bg, display: 'flex', gap: 4, alignItems: 'baseline' }}>
        <GutterChar tag={node.tag} />
        {renderLabel()}
        {node.tag === 'unchanged' && <Primitive value={node.value} />}
        {node.tag === 'added' && <Primitive value={node.newValue} colorOverride={colors.newValue} />}
        {node.tag === 'removed' && (
          <span style={{ color: colors.oldValue, textDecoration: 'line-through' }}>
            <Primitive value={node.oldValue} colorOverride={colors.oldValue} />
          </span>
        )}
        {node.tag === 'changed' && (
          <ChangedInline oldValue={node.oldValue} newValue={node.newValue} />
        )}
        {!isLast && <span style={{ color: colors.punct }}>,</span>}
      </div>
    )
  }

  // ---- Container (object or array) ----
  const isArray = node.kind === 'array'
  const entries: Array<{ key: string | number; child: DiffNode }> = isArray
    ? (node as DiffArray).items.map((child, i) => ({ key: i, child }))
    : (node as DiffObject).entries.map(({ key, child }) => ({ key, child }))

  const openBracket = isArray ? '[' : '{'
  const closeBracket = isArray ? ']' : '}'
  const empty = entries.length === 0
  const summaryText = isArray
    ? `${entries.length} item${entries.length !== 1 ? 's' : ''}`
    : `${entries.length} key${entries.length !== 1 ? 's' : ''}`

  return (
    <div style={{ paddingLeft: indent }}>
      <div style={{ background: bg, display: 'flex', gap: 4, alignItems: 'baseline' }}>
        <span
          onClick={() => !empty && setOpen(!open)}
          style={{
            display: 'inline-flex',
            width: 12,
            height: 12,
            verticalAlign: 'middle',
            color: '#888',
            cursor: empty ? 'default' : 'pointer',
            userSelect: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {!empty && <DisclosureTriangle expanded={open} size={10} color="#888" />}
        </span>
        <GutterChar tag={node.tag} />
        {renderLabel()}
        <span style={{ color: colors.bracket }}>{openBracket}</span>
        {!open && !empty && (
          <>
            <span style={{ color: colors.null, margin: '0 2px', fontSize: 10 }}>{summaryText}</span>
            <span style={{ color: colors.bracket }}>{closeBracket}</span>
            {!isLast && <span style={{ color: colors.punct }}>,</span>}
          </>
        )}
      </div>
      {open && !empty && (
        <>
          <div>
            {entries.map(({ key, child }, i) => (
              <DiffNodeView
                key={String(key)}
                label={key}
                node={child}
                depth={depth + 1}
                isLast={i === entries.length - 1}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ color: 'transparent', userSelect: 'none' }}>{'·'}</span>
            <span style={{ color: colors.bracket }}>{closeBracket}</span>
            {!isLast && <span style={{ color: colors.punct }}>,</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: '#888',
        padding: '6px 0 2px',
        borderBottom: '1px solid #eee',
        marginBottom: 4,
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface SnapshotDiffViewProps {
  before: SerializedSnapshot | null
  after: SerializedSnapshot
}

export function SnapshotDiffView({ before, after }: SnapshotDiffViewProps) {
  const valueDiff = computeJsonDiff(before?.value ?? null, after.value)
  const contextDiff = computeJsonDiff(before?.context ?? null, after.context)
  const statusChanged = (before?.status ?? null) !== after.status

  if (before === null) {
    return (
      <div style={{ ...MONO, color: '#888', fontStyle: 'italic', padding: '4px 0' }}>
        No prior snapshot — this is the first recorded event for this actor.
      </div>
    )
  }

  return (
    <div style={MONO}>
      <SectionHeader label="State" />
      <DiffNodeView node={valueDiff} depth={0} isLast />

      {statusChanged && (
        <>
          <SectionHeader label="Status" />
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0' }}>
            <GutterChar tag="changed" />
            <span
              style={{
                color: colors.oldValue,
                textDecoration: 'line-through',
                marginRight: 4,
              }}
            >
              {before.status}
            </span>
            <span style={{ color: colors.punct }}>→</span>
            <span style={{ color: colors.newValue, marginLeft: 4 }}>{after.status}</span>
          </div>
        </>
      )}

      <SectionHeader label="Context" />
      <DiffNodeView node={contextDiff} depth={0} isLast />
    </div>
  )
}
