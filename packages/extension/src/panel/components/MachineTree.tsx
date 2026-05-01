// packages/extension/src/panel/components/MachineTree.tsx
import React from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { getActiveNodeIds } from '../active-nodes.js'
import { usePanelCollapse } from '../panel-collapse-context.js'
import type { SerializedStateNode } from '../../shared/types.js'

function PanelToggleIcon({ side, collapsed }: { side: 'left' | 'right'; collapsed: boolean }) {
  // Material-style "left_panel_close" / "right_panel_close" — a thin bar at the
  // edge with an arrow indicating the direction the panel will move.
  // Inline SVG to avoid font/CSP dependencies in the extension.
  const flip = (side === 'left') !== collapsed
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" ry="2"
        fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line
        x1={side === 'left' ? '8' : '16'} x2={side === 'left' ? '8' : '16'}
        y1="4" y2="20"
        stroke="currentColor" strokeWidth="1.6"
      />
      <polyline
        points={flip ? '13,9 11,12 13,15' : '11,9 13,12 11,15'}
        fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

function HeaderIconButton({
  onClick, title, children,
}: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, padding: 0,
        background: 'transparent', border: 'none', borderRadius: 4,
        cursor: 'pointer', color: '#666',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#eee' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

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

  const collapse = usePanelCollapse()

  const actor = selectedActorId ? actors.get(selectedActorId) : null

  const matchSet = React.useMemo(() => {
    if (!actor?.machine || !treeFilter) return null
    return buildMatchSet(actor.machine.root, treeFilter)
  }, [actor?.machine, treeFilter])

  const Header = (
    <div style={{
      padding: '4px 6px', borderBottom: '1px solid #eee',
      fontSize: 11, color: '#666', position: 'sticky', top: 0,
      background: '#fafafa', zIndex: 1,
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    }}>
      <HeaderIconButton
        onClick={collapse.toggleLeft}
        title={collapse.leftCollapsed ? 'Show actor list' : 'Hide actor list'}
      >
        <PanelToggleIcon side="left" collapsed={collapse.leftCollapsed} />
      </HeaderIconButton>

      {actor?.machine && (
        <>
          <span style={{ fontWeight: 600 }}>{actor.machine.id}</span>
          {actor.machine.sourceLocation && (
            <a
              href={`vscode://file/${actor.machine.sourceLocation}`}
              style={{ color: '#1890ff', fontSize: 10, textDecoration: 'none' }}
              title="Open in VS Code"
            >
              ↗ source
            </a>
          )}
        </>
      )}

      {actor?.machine && (
        <>
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
        </>
      )}

      <HeaderIconButton
        onClick={collapse.toggleRight}
        title={collapse.rightCollapsed ? 'Show side panel' : 'Hide side panel'}
      >
        <PanelToggleIcon side="right" collapsed={collapse.rightCollapsed} />
      </HeaderIconButton>
    </div>
  )

  if (!actor) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {Header}
        <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>
          Select an actor from the left panel.
        </div>
      </div>
    )
  }

  if (!actor.machine) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {Header}
        <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>
          No machine definition available for this actor.
        </div>
      </div>
    )
  }

  const activeIds = snapshot
    ? getActiveNodeIds(snapshot.value as any, actor.machine.root)
    : new Set<string>()

  const noMatches = matchSet !== null && matchSet.size === 0

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {Header}
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
