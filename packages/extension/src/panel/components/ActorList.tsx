// packages/extension/src/panel/components/ActorList.tsx
import React, { useMemo } from 'react'
import { useStore } from '../store.js'

export function ActorList() {
  const actors = useStore((s) => s.actors)
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectActor = useStore((s) => s.selectActor)

  // Build parent→children map
  const childrenOf = useMemo(() => {
    const map = new Map<string | undefined, string[]>()
    for (const actor of actors.values()) {
      const parent = actor.parentSessionId
      if (!map.has(parent)) map.set(parent, [])
      map.get(parent)!.push(actor.sessionId)
    }
    return map
  }, [actors])

  const roots = childrenOf.get(undefined) ?? []

  function renderActor(sessionId: string, depth: number): React.ReactNode {
    const actor = actors.get(sessionId)
    if (!actor) return null
    const isSelected = sessionId === selectedActorId
    const isStopped = actor.status === 'stopped'
    const children = childrenOf.get(sessionId) ?? []
    const label = actor.machine?.id ?? sessionId.slice(0, 12)

    return (
      <div key={sessionId}>
        <div
          onClick={() => selectActor(sessionId)}
          style={{
            paddingLeft: 8 + depth * 16,
            paddingTop: 4, paddingBottom: 4,
            cursor: 'pointer',
            background: isSelected ? '#d0e8ff' : 'transparent',
            color: isStopped ? '#aaa' : 'inherit',
            borderLeft: isSelected ? '2px solid #1890ff' : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: isStopped ? '#ccc' : '#52c41a',
          }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{label}</span>
        </div>
        {children.map((cid) => renderActor(cid, depth + 1))}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', background: '#fafafa' }}>
      <div style={{
        padding: '4px 10px', minHeight: 30, boxSizing: 'border-box',
        fontWeight: 600, borderBottom: '1px solid #eee',
        fontSize: 11, color: '#666', background: '#fafafa',
        display: 'flex', alignItems: 'center',
      }}>
        ACTORS
      </div>
      {roots.length === 0 ? (
        <div style={{ padding: 12, color: '#aaa', fontSize: 11 }}>
          No actors detected.<br />Make sure the adapter is wired up.
        </div>
      ) : (
        roots.map((sid) => renderActor(sid, 0))
      )}
    </div>
  )
}
