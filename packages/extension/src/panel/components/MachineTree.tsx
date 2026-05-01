// packages/extension/src/panel/components/MachineTree.tsx
import React from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { getActiveNodeIds } from '../active-nodes.js'
import type { SerializedStateNode } from '../../shared/types.js'

/** Returns the set of node ids that match `filter` (case-insensitive on key) or have a matching descendant. */
function buildMatchSet(node: SerializedStateNode, filter: string): Set<string> {
  const matched = new Set<string>()
  const lower = filter.toLowerCase()

  function visit(n: SerializedStateNode): boolean {
    let anyChildMatches = false
    for (const child of Object.values(n.states)) {
      if (visit(child)) anyChildMatches = true
    }
    const selfMatches = n.key.toLowerCase().includes(lower)
    if (selfMatches || anyChildMatches) {
      matched.add(n.id)
      return true
    }
    return false
  }

  visit(node)
  return matched
}

function highlight(text: string, filter: string): React.ReactNode {
  if (!filter) return text
  const lower = text.toLowerCase()
  const i = lower.indexOf(filter.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: '#fff566', padding: 0 }}>{text.slice(i, i + filter.length)}</mark>
      {text.slice(i + filter.length)}
    </>
  )
}

function StateNodeRow({
  node,
  activeIds,
  selectedId,
  onSelect,
  depth,
  filter,
  matchSet,
}: {
  node: SerializedStateNode
  activeIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
  depth: number
  filter: string
  matchSet: Set<string> | null
}) {
  const isActive = activeIds.has(node.id)
  const isSelected = node.id === selectedId
  const hasChildren = Object.keys(node.states).length > 0
  const filterActive = filter.length > 0
  // Auto-expand when filtering so matched paths are visible
  const [userExpanded, setUserExpanded] = React.useState(true)
  const expanded = filterActive ? true : userExpanded

  const typeColor: Record<string, string> = {
    parallel: '#722ed1', final: '#d4380d', history: '#d48806',
    atomic: '#595959', compound: '#595959',
  }

  if (matchSet && !matchSet.has(node.id)) return null

  return (
    <>
      <div
        style={{
          paddingLeft: 8 + depth * 18,
          paddingTop: 3, paddingBottom: 3,
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer',
          background: isSelected ? '#e6f4ff' : isActive ? '#f6ffed' : 'transparent',
          borderLeft: isActive ? '3px solid #52c41a' : '3px solid transparent',
          fontFamily: 'monospace', fontSize: 12,
        }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren && (
          <span
            onClick={(e) => { e.stopPropagation(); if (!filterActive) setUserExpanded((ex) => !ex) }}
            style={{ color: '#aaa', fontSize: 10, width: 10, cursor: filterActive ? 'default' : 'pointer' }}
          >
            {expanded ? '▼' : '▶'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 10 }} />}
        <span style={{ color: typeColor[node.type] ?? '#595959', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          {node.type.slice(0, 4)}
        </span>
        <span style={{ fontWeight: isActive ? 700 : 400, color: isActive ? '#237804' : '#333' }}>
          {highlight(node.key, filter)}
        </span>
        {node.invoke.length > 0 && (
          <span title="has invoked services" style={{ color: '#096dd9', fontSize: 10 }}>⚙</span>
        )}
      </div>
      {expanded && hasChildren && Object.values(node.states).map((child) => (
        <StateNodeRow
          key={child.id}
          node={child}
          activeIds={activeIds}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
          filter={filter}
          matchSet={matchSet}
        />
      ))}
    </>
  )
}

export function MachineTree() {
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const selectStateNode = useStore((s) => s.selectStateNode)
  const treeFilter = useStore((s) => s.treeFilter)
  const setTreeFilter = useStore((s) => s.setTreeFilter)
  const actors = useStore((s) => s.actors)
  const snapshot = useStore((s) =>
    selectedActorId ? getDisplaySnapshot(s, selectedActorId) : null
  )

  const actor = selectedActorId ? actors.get(selectedActorId) : null

  const matchSet = React.useMemo(() => {
    if (!actor?.machine || !treeFilter) return null
    return buildMatchSet(actor.machine.root, treeFilter)
  }, [actor?.machine, treeFilter])

  if (!actor) {
    return (
      <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>
        Select an actor from the left panel.
      </div>
    )
  }

  if (!actor.machine) {
    return (
      <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>
        No machine definition available for this actor.
      </div>
    )
  }

  const activeIds = snapshot
    ? getActiveNodeIds(snapshot.value as any, actor.machine.root)
    : new Set<string>()

  const noMatches = matchSet !== null && matchSet.size === 0

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{
        padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid #eee',
        fontSize: 11, color: '#666', position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span>{actor.machine.id}</span>
        {actor.machine.sourceLocation && (
          <a
            href={`vscode://file/${actor.machine.sourceLocation}`}
            style={{ color: '#1890ff', fontSize: 10, textDecoration: 'none' }}
            title="Open in VS Code"
          >
            ↗ source
          </a>
        )}
        <input
          value={treeFilter}
          onChange={(e) => setTreeFilter(e.target.value)}
          placeholder="Search states…"
          style={{
            marginLeft: 'auto', flex: '1 1 140px', minWidth: 100, maxWidth: 240,
            padding: '2px 6px', fontSize: 11, fontFamily: 'inherit',
            border: '1px solid #d9d9d9', borderRadius: 4,
          }}
        />
        {treeFilter && (
          <button
            onClick={() => setTreeFilter('')}
            style={{
              padding: '2px 6px', fontSize: 10, cursor: 'pointer',
              background: '#fafafa', border: '1px solid #d9d9d9', borderRadius: 4,
            }}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
      {noMatches ? (
        <div style={{ padding: 16, color: '#aaa', fontSize: 12 }}>
          No states match "{treeFilter}".
        </div>
      ) : (
        <StateNodeRow
          node={actor.machine.root}
          activeIds={activeIds}
          selectedId={selectedStateNodeId}
          onSelect={selectStateNode}
          depth={0}
          filter={treeFilter}
          matchSet={matchSet}
        />
      )}
    </div>
  )
}
