// packages/extension/src/panel/components/MachineTree.tsx
import React from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { getActiveNodeIds } from '../active-nodes.js'
import type { SerializedStateNode } from '../../shared/types.js'

function StateNodeRow({
  node,
  activeIds,
  selectedId,
  onSelect,
  depth,
}: {
  node: SerializedStateNode
  activeIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
  depth: number
}) {
  const isActive = activeIds.has(node.id)
  const isSelected = node.id === selectedId
  const hasChildren = Object.keys(node.states).length > 0
  const [expanded, setExpanded] = React.useState(true)

  const typeColor: Record<string, string> = {
    parallel: '#722ed1', final: '#d4380d', history: '#d48806',
    atomic: '#595959', compound: '#595959',
  }

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
            onClick={(e) => { e.stopPropagation(); setExpanded((ex) => !ex) }}
            style={{ color: '#aaa', fontSize: 10, width: 10, cursor: 'pointer' }}
          >
            {expanded ? '▼' : '▶'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 10 }} />}
        <span style={{ color: typeColor[node.type] ?? '#595959', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          {node.type.slice(0, 4)}
        </span>
        <span style={{ fontWeight: isActive ? 700 : 400, color: isActive ? '#237804' : '#333' }}>
          {node.key}
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
        />
      ))}
    </>
  )
}

export function MachineTree() {
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const selectStateNode = useStore((s) => s.selectStateNode)
  const actors = useStore((s) => s.actors)
  const snapshot = useStore((s) =>
    selectedActorId ? getDisplaySnapshot(s, selectedActorId) : null
  )

  const actor = selectedActorId ? actors.get(selectedActorId) : null

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

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{
        padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid #eee',
        fontSize: 11, color: '#666', position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        display: 'flex', alignItems: 'center', gap: 8,
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
      </div>
      <StateNodeRow
        node={actor.machine.root}
        activeIds={activeIds}
        selectedId={selectedStateNodeId}
        onSelect={selectStateNode}
        depth={0}
      />
    </div>
  )
}
