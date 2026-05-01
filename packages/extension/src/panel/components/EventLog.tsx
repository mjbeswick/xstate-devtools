// packages/extension/src/panel/components/EventLog.tsx
import React, { useRef, useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { ChevronDown, ChevronUp } from './Icons.js'

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

interface Props {
  collapsed?: boolean
  onExpand?: () => void
}

export function EventLog({ collapsed = false, onExpand }: Props = {}) {
  const events = useStore((s) => s.events)
  const actors = useStore((s) => s.actors)
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)
  const selectActor = useStore((s) => s.selectActor)

  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!collapsed && autoScroll && timeTravelSeq === null) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events, autoScroll, timeTravelSeq, collapsed])

  const filtered = filter
    ? events.filter((e) => e.event.type.toLowerCase().includes(filter.toLowerCase()))
    : events

  if (collapsed) {
    return (
      <div
        onClick={onExpand}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 10px', minHeight: 30, height: '100%', boxSizing: 'border-box',
          background: '#fafafa', cursor: 'pointer', userSelect: 'none',
        }}
        title="Show event log"
      >
        <span style={{ display: 'inline-flex', color: '#666' }}>
          <ChevronUp size={14} />
        </span>
        <span style={{ fontWeight: 600, fontSize: 11, color: '#666' }}>EVENTS</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>
          {events.length}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', minHeight: 30, boxSizing: 'border-box',
        borderBottom: '1px solid #eee', background: '#fafafa', flexShrink: 0,
      }}>
        <span style={{ display: 'inline-flex', color: '#666' }}>
          <ChevronDown size={14} />
        </span>
        <span style={{ fontWeight: 600, fontSize: 11, color: '#666' }}>EVENTS</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by type…"
          style={{
            fontSize: 11, padding: '2px 6px',
            border: '1px solid #d9d9d9', borderRadius: 4, width: 160,
          }}
        />
        <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>
          {events.length} events
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
        {filtered.map((evt) => {
          const actorLabel = actors.get(evt.sessionId)?.machine?.id ?? evt.sessionId.slice(0, 12)
          const isCurrent = evt.globalSeq === timeTravelSeq
          return (
            <div
              key={evt.globalSeq}
              onClick={() => {
                timeTravel(evt.globalSeq)
                selectActor(evt.sessionId)
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 120px 1fr 80px',
                gap: 8,
                padding: '3px 8px',
                cursor: 'pointer',
                background: isCurrent ? '#e6f4ff' : 'transparent',
                borderLeft: isCurrent ? '3px solid #1890ff' : '3px solid transparent',
              }}
              title="Click to time travel to this event"
            >
              <span style={{ color: '#aaa' }}>{formatTime(evt.timestamp)}</span>
              <span style={{
                color: '#595959', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {actorLabel}
              </span>
              <span style={{ fontWeight: 600, color: '#003a8c' }}>{evt.event.type}</span>
              <span style={{ color: '#8c8c8c', textAlign: 'right' }}>seq:{evt.globalSeq}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
