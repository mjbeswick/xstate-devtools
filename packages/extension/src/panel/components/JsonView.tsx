// Lightweight collapsible JSON viewer — no external deps.
import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from './Icons.js'

const colors = {
  key: '#871094',
  string: '#067d17',
  number: '#1750eb',
  boolean: '#0033b3',
  null: '#999',
  punct: '#777',
  bracket: '#444',
  toggle: '#888',
}

type Json = unknown

function typeOf(value: Json): 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'other' {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return t
  if (t === 'object') return 'object'
  return 'other'
}

function Primitive({ value }: { value: Json }) {
  const t = typeOf(value)
  switch (t) {
    case 'string':
      return <span style={{ color: colors.string }}>"{value as string}"</span>
    case 'number':
      return <span style={{ color: colors.number }}>{String(value)}</span>
    case 'boolean':
      return <span style={{ color: colors.boolean }}>{String(value)}</span>
    case 'null':
      return <span style={{ color: colors.null, fontStyle: 'italic' }}>null</span>
    case 'undefined':
      return <span style={{ color: colors.null, fontStyle: 'italic' }}>undefined</span>
    default:
      return <span style={{ color: colors.null }}>{String(value)}</span>
  }
}

interface NodeProps {
  k?: string | number
  value: Json
  depth: number
  defaultOpenDepth: number
  isLast?: boolean
}

function JsonNode({ k, value, depth, defaultOpenDepth, isLast }: NodeProps) {
  const t = typeOf(value)
  const isContainer = t === 'object' || t === 'array'
  const [open, setOpen] = useState(depth < defaultOpenDepth)

  const renderKey = () =>
    k !== undefined && (
      <>
        <span style={{ color: colors.key }}>
          {typeof k === 'string' ? `"${k}"` : k}
        </span>
        <span style={{ color: colors.punct }}>: </span>
      </>
    )

  if (!isContainer) {
    return (
      <div style={{ paddingLeft: depth * 14, lineHeight: 1.5 }}>
        <span style={{ display: 'inline-block', width: 12 }} />
        {renderKey()}
        <Primitive value={value} />
        {!isLast && <span style={{ color: colors.punct }}>,</span>}
      </div>
    )
  }

  const entries: [string | number, Json][] =
    t === 'array'
      ? (value as Json[]).map((v, i) => [i, v])
      : Object.entries(value as Record<string, Json>)
  const open_ = t === 'array' ? '[' : '{'
  const close_ = t === 'array' ? ']' : '}'
  const empty = entries.length === 0

  return (
    <div style={{ paddingLeft: depth * 14, lineHeight: 1.5 }}>
      <span
        onClick={() => !empty && setOpen(!open)}
        style={{
          display: 'inline-flex', width: 12, height: 12, verticalAlign: 'middle',
          color: colors.toggle, cursor: empty ? 'default' : 'pointer',
          userSelect: 'none', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {empty ? null : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </span>
      {renderKey()}
      <span style={{ color: colors.bracket }}>{open_}</span>
      {empty ? (
        <span style={{ color: colors.bracket }}>{close_}</span>
      ) : open ? (
        <>
          <div>
            {entries.map(([childKey, childValue], i) => (
              <JsonNode
                key={String(childKey)}
                k={childKey}
                value={childValue}
                depth={depth + 1}
                defaultOpenDepth={defaultOpenDepth}
                isLast={i === entries.length - 1}
              />
            ))}
          </div>
          <div style={{ paddingLeft: 0 }}>
            <span style={{ display: 'inline-block', width: 12 }} />
            <span style={{ color: colors.bracket }}>{close_}</span>
            {!isLast && <span style={{ color: colors.punct }}>,</span>}
          </div>
        </>
      ) : (
        <>
          <span style={{ color: colors.null, margin: '0 4px', fontSize: 10 }}>
            {t === 'array' ? `${entries.length} items` : `${entries.length} keys`}
          </span>
          <span style={{ color: colors.bracket }}>{close_}</span>
          {!isLast && <span style={{ color: colors.punct }}>,</span>}
        </>
      )}
    </div>
  )
}

export function JsonView({
  value,
  defaultOpenDepth = 2,
}: {
  value: Json
  defaultOpenDepth?: number
}) {
  return (
    <div style={{
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 11,
      overflow: 'auto',
    }}>
      <JsonNode value={value} depth={0} defaultOpenDepth={defaultOpenDepth} isLast />
    </div>
  )
}
