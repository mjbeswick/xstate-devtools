// packages/extension/src/panel/components/ActorList.tsx
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { PanelContextMenu, copyTextToClipboard, usePanelContextMenu } from '../PanelContextMenu.js'
import { openSourceLocation } from '../open-source.js'
import { useStore } from '../store.js'
import { getActorNodePresentation } from '../tree-metadata.js'
import { DisclosureTriangle } from './Icons.js'

export function ActorList() {
  const contextMenu = usePanelContextMenu()
  const actors = useStore((s) => s.actors)
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectActor = useStore((s) => s.selectActor)
  const hideStoppedActors = useStore((s) => s.hideStoppedActors)
  const setHideStoppedActors = useStore((s) => s.setHideStoppedActors)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Build parent→children map
  const { childrenOf, roots } = useMemo(() => {
    const map = new Map<string | undefined, string[]>()
    const rootIds: string[] = []
    for (const actor of actors.values()) {
      if (hideStoppedActors && actor.status === 'stopped') continue

      const parent = actor.parentSessionId
      if (!map.has(parent)) map.set(parent, [])
      map.get(parent)?.push(actor.sessionId)

      if (
        !parent ||
        !actors.has(parent) ||
        (hideStoppedActors && actors.get(parent)?.status === 'stopped')
      ) {
        rootIds.push(actor.sessionId)
      }
    }
    return { childrenOf: map, roots: rootIds }
  }, [actors, hideStoppedActors])

  useEffect(() => {
    if (!selectedActorId) return

    const nextExpanded: Record<string, boolean> = {}
    let currentId = selectedActorId

    while (currentId) {
      const actor = actors.get(currentId)
      const parentId = actor?.parentSessionId
      if (!parentId) break
      nextExpanded[parentId] = true
      currentId = parentId
    }

    if (Object.keys(nextExpanded).length === 0) return
    setExpanded((current) => ({ ...nextExpanded, ...current }))
  }, [selectedActorId, actors])

  function isExpanded(sessionId: string, hasChildren: boolean, depth: number) {
    if (!hasChildren) return false
    return expanded[sessionId] ?? true
  }

  function toggleExpanded(sessionId: string) {
    setExpanded((current) => ({
      ...current,
      [sessionId]: !(current[sessionId] ?? true),
    }))
  }

  function handleRowClick(sessionId: string) {
    selectActor(sessionId)
  }

  function renderActor(sessionId: string, depth: number): React.ReactNode {
    const actor = actors.get(sessionId)
    if (!actor) return null
    const isSelected = sessionId === selectedActorId
    const isStopped = actor.status === 'stopped'
    const children = childrenOf.get(sessionId) ?? []
    const hasChildren = children.length > 0
    const open = isExpanded(sessionId, hasChildren, depth)
    const actorInfo = getActorNodePresentation(actor, children.length)

    return (
      <div key={sessionId}>
        <div
          onClick={() => handleRowClick(sessionId)}
          onDoubleClick={() => {
            if (hasChildren) toggleExpanded(sessionId)
          }}
          onContextMenu={(event) => {
            contextMenu.openMenu(event, [
              {
                label: 'Select actor',
                onSelect: () => selectActor(sessionId),
              },
              {
                label: 'Open source location',
                disabled: !actor.machine?.sourceLocation,
                onSelect: () => {
                  if (actor.machine?.sourceLocation) openSourceLocation(actor.machine.sourceLocation)
                },
              },
              {
                label: 'Copy session id',
                onSelect: () => void copyTextToClipboard(sessionId),
              },
              {
                label: open ? 'Collapse actor branch' : 'Expand actor branch',
                disabled: !hasChildren,
                onSelect: () => {
                  if (hasChildren) toggleExpanded(sessionId)
                },
              },
            ])
          }}
          style={{
            paddingLeft: 4 + depth * 12,
            paddingTop: 4,
            paddingBottom: 4,
            cursor: 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            background: isSelected ? '#d0e8ff' : 'transparent',
            color: isStopped ? '#aaa' : 'inherit',
            borderLeft: isSelected ? '2px solid #1890ff' : '2px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title={actorInfo.title}
        >
          {hasChildren ? (
            <span
              onClick={(event) => {
                event.stopPropagation()
                toggleExpanded(sessionId)
              }}
              style={{
                width: 10,
                height: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#777',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              title={open ? 'Collapse actor branch' : 'Expand actor branch'}
            >
              <DisclosureTriangle expanded={open} size={10} color="#777" />
            </span>
          ) : (
            <span style={{ width: 10, flexShrink: 0 }} />
          )}
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: isStopped ? 'inherit' : actorInfo.labelColor,
            }}
          >
            {actorInfo.label}
          </span>
        </div>
        {open && children.map((cid) => renderActor(cid, depth + 1))}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', background: '#fafafa' }}>
      <div
        style={{
          padding: '4px 10px',
          minHeight: 30,
          boxSizing: 'border-box',
          fontWeight: 600,
          borderBottom: '1px solid #eee',
          fontSize: 11,
          color: '#666',
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>ACTORS</span>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 500,
            color: '#888',
          }}
        >
          <input
            type="checkbox"
            checked={hideStoppedActors}
            onChange={(event) => setHideStoppedActors(event.target.checked)}
            style={{ margin: 0 }}
          />
          <span>Hide stopped</span>
        </label>
      </div>
      {roots.map((sid) => renderActor(sid, 0))}
      <PanelContextMenu menu={contextMenu.menu} onClose={contextMenu.closeMenu} />
    </div>
  )
}
