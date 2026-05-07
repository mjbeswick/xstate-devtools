// packages/extension/src/panel/components/MachineTree.tsx
import React from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { getActiveNodeIds } from '../active-nodes.js'

function findPath(root: SerializedStateNode, id: string): SerializedStateNode[] | null {
  if (root.id === id) return [root]
  for (const child of Object.values(root.states)) {
    const sub = findPath(child, id)
    if (sub) return [root, ...sub]
  }
  return null
}
import { usePanelCollapse } from '../panel-collapse-context.js'
import { ChevronDown, ChevronRight, PanelToggle, ExternalLink, Close } from './Icons.js'
import type { SerializedStateNode } from '../../shared/types.js'

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
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); if (!filterActive) setUserExpanded((ex) => !ex) }}
            style={{
              color: '#888', width: 14, height: 14,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: filterActive ? 'default' : 'pointer', flexShrink: 0,
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
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
  const portConnected = useStore((s) => s.portConnected)
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
      padding: '0 6px', minHeight: 30, boxSizing: 'border-box',
      borderBottom: '1px solid #eee',
      fontSize: 11, color: '#666', position: 'sticky', top: 0,
      background: '#fafafa', zIndex: 1,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <HeaderIconButton
        onClick={collapse.toggleLeft}
        title={collapse.leftCollapsed ? 'Show actor list' : 'Hide actor list'}
      >
        <PanelToggle side="left" collapsed={collapse.leftCollapsed} />
      </HeaderIconButton>

      {actor?.machine && (
        <>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{actor.machine.id}</span>
          {actor.machine.sourceLocation && (
            <a
              href={`vscode://file/${actor.machine.sourceLocation}`}
              style={{
                color: '#1890ff', fontSize: 10, textDecoration: 'none',
                whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2,
              }}
              title="Open in VS Code"
            >
              <ExternalLink size={11} /> source
            </a>
          )}
        </>
      )}

      <span style={{ marginLeft: 'auto' }} />
      <span style={{
        fontSize: 10, fontWeight: 500, padding: '1px 6px',
        borderRadius: 10,
        background: portConnected ? '#f6ffed' : '#fff1f0',
        color: portConnected ? '#389e0d' : '#cf1322',
        border: `1px solid ${portConnected ? '#b7eb8f' : '#ffa39e'}`,
        whiteSpace: 'nowrap',
      }}>
        {portConnected ? '● Connected' : '○ Not connected'}
      </span>
      <HeaderIconButton
        onClick={collapse.toggleRight}
        title={collapse.rightCollapsed ? 'Show side panel' : 'Hide side panel'}
      >
        <PanelToggle side="right" collapsed={collapse.rightCollapsed} />
      </HeaderIconButton>
    </div>
  )

  const Footer = (
    <div style={{
      padding: '4px 6px', borderTop: '1px solid #eee',
      background: '#fafafa', flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {actor?.machine && (
        <>
          <input
            value={treeFilter}
            onChange={(e) => setTreeFilter(e.target.value)}
            placeholder="Search states…"
            style={{
              flex: '1 1 auto', minWidth: 60,
              padding: '2px 6px', fontSize: 11, fontFamily: 'inherit',
              border: '1px solid #d9d9d9', borderRadius: 4,
            }}
          />
          {treeFilter && (
            <HeaderIconButton onClick={() => setTreeFilter('')} title="Clear search">
              <Close size={14} />
            </HeaderIconButton>
          )}
        </>
      )}
      <span style={{ marginLeft: 'auto' }} />
      <HeaderIconButton
        onClick={collapse.toggleBottom}
        title={collapse.bottomCollapsed ? 'Show event log' : 'Hide event log'}
      >
        <PanelToggle side="bottom" collapsed={collapse.bottomCollapsed} />
      </HeaderIconButton>
    </div>
  )

  if (!actor) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {Header}
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, textAlign: 'center',
        }}>
          {!portConnected ? (
            <div style={{ fontSize: 12 }}>
              <div style={{ color: '#cf1322', fontWeight: 500, marginBottom: 4 }}>Not connected</div>
              <div style={{ color: '#8c8c8c' }}>Open DevTools on an inspected tab and reload the page.</div>
            </div>
          ) : actors.size === 0 ? (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              No actors detected.<br />
              Make sure the adapter is wired up on the page.{' '}
              <a
                href="https://github.com/mjbeswick/xstate-devtools#wiring-it-into-your-app"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#8c8c8c' }}
              >
                Help
              </a>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: '#aaa' }}>Select an actor from the left panel.</span>
          )}
        </div>
        {Footer}
      </div>
    )
  }

  if (!actor.machine) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {Header}
        <div style={{ flex: 1, padding: 24, color: '#aaa', fontSize: 12 }}>
          No machine definition available for this actor.
        </div>
        {Footer}
      </div>
    )
  }

  const activeIds = snapshot
    ? getActiveNodeIds(snapshot.value as any, actor.machine.root)
    : new Set<string>()

  const breadcrumbPath = selectedStateNodeId
    ? findPath(actor.machine.root, selectedStateNodeId)
    : null

  const noMatches = matchSet !== null && matchSet.size === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {Header}
      {breadcrumbPath && (
        <div style={{
          padding: '4px 10px', borderBottom: '1px solid #eee',
          background: '#fff', fontSize: 11, color: '#555',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
        }}>
          {breadcrumbPath.map((n, j) => {
            const isLeaf = j === breadcrumbPath.length - 1
            return (
              <React.Fragment key={n.id}>
                {j > 0 && <span style={{ color: '#bbb' }}>›</span>}
                <button
                  onClick={() => selectStateNode(n.id)}
                  title={n.id}
                  style={{
                    padding: '0 4px', border: 'none',
                    background: 'transparent', borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'monospace', fontSize: 11,
                    color: isLeaf ? '#0958d9' : '#555',
                    fontWeight: isLeaf ? 600 : 400,
                  }}
                >
                  {n.key}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
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
      {Footer}
    </div>
  )
}
