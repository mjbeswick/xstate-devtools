// packages/extension/src/panel/components/MachineTree.tsx
import React from 'react'
import { getActiveNodeIds, getActivePaths } from '../active-nodes.js'
import { buildMachineTreeMatchSet, getMachineTreeHighlightTerm } from '../machine-tree-filter.js'
import { canOpenSourceLocation, openSourceLocation } from '../open-source.js'
import { copyTextToClipboard, usePanelContextMenu } from '../PanelContextMenu.js'
import { useDispatch } from '../port-context.js'
import { getDisplaySnapshot, useStore } from '../store.js'

function findPath(root: SerializedStateNode, id: string): SerializedStateNode[] | null {
  if (root.id === id) return [root]
  for (const child of Object.values(root.states)) {
    const sub = findPath(child, id)
    if (sub) return [root, ...sub]
  }
  return null
}

import type { ActorRecord, SerializedStateNode } from '../../shared/types.js'
import { usePanelCollapse } from '../panel-collapse-context.js'
import { useServerControls } from '../server-context.js'
import { getStateNodeTitle } from '../tree-metadata.js'
import { Close, DisclosureTriangle, ExternalLink, PanelToggle } from './Icons.js'

function HeaderIconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        padding: 0,
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        color: '#666',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#eee'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
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
  onOpenContextMenu,
  depth,
  filter,
  matchSet,
}: {
  node: SerializedStateNode
  activeIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenContextMenu: (event: React.MouseEvent, node: SerializedStateNode, isActive: boolean) => void
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

  if (matchSet && !matchSet.has(node.id)) return null

  const handleRowClick = () => {
    onSelect(node.id)
  }

  const rowTitle = getStateNodeTitle(node, isActive)

  return (
    <>
      <div
        style={{
          paddingLeft: 4 + depth * 14,
          paddingTop: 2,
          paddingBottom: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: isSelected ? '#e6f4ff' : isActive ? '#f6ffed' : 'transparent',
          borderLeft: isActive ? '3px solid #52c41a' : '3px solid transparent',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
        onClick={handleRowClick}
        onDoubleClick={() => {
          if (hasChildren && !filterActive) setUserExpanded((ex) => !ex)
        }}
        onMouseDown={(event) => {
          if (event.button !== 2) return
          onOpenContextMenu(event, node, isActive)
        }}
        onContextMenu={(event) => {
          onOpenContextMenu(event, node, isActive)
        }}
        title={rowTitle}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (!filterActive) setUserExpanded((ex) => !ex)
            }}
            style={{
              color: '#888',
              width: 10,
              height: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: filterActive ? 'default' : 'pointer',
              flexShrink: 0,
            }}
            title={expanded ? 'Collapse state branch' : 'Expand state branch'}
          >
            <DisclosureTriangle expanded={expanded} size={10} color="#888" />
          </span>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: isActive ? 700 : 400, color: isActive ? '#237804' : '#333' }}>
          {highlight(node.key, filter)}
        </span>
        {node.description && (
          <span
            style={{
              color: 'rgb(153, 153, 153)',
              fontSize: 12,
              fontFamily: 'sans-serif',
              fontWeight: 400,
              fontStyle: 'italic',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flexShrink: 1,
            }}
            title={node.description}
          >
            {node.description}
          </span>
        )}
        {node.invoke.length > 0 && (
          <span title="has invoked services" style={{ color: '#096dd9', fontSize: 10 }}>
            ⚙
          </span>
        )}
      </div>
      {expanded &&
        hasChildren &&
        Object.values(node.states).map((child) => (
          <StateNodeRow
            key={child.id}
            node={child}
            activeIds={activeIds}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpenContextMenu={onOpenContextMenu}
            depth={depth + 1}
            filter={filter}
            matchSet={matchSet}
          />
        ))}
    </>
  )
}

function BreadcrumbRow({
  path,
  onSelect,
  dimmed = false,
}: {
  path: SerializedStateNode[]
  onSelect: (id: string) => void
  dimmed?: boolean
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        minWidth: 0,
        gap: 0,
      }}
    >
      {path.map((n, j) => {
        const isLeaf = j === path.length - 1
        return (
          <React.Fragment key={n.id}>
            {j > 0 && (
              <span style={{ color: '#aaa', padding: '0 1px', flexShrink: 0, fontSize: 10 }}>
                ›
              </span>
            )}
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              title={n.id}
              style={{
                padding: '0 3px',
                border: 'none',
                background: 'transparent',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 11,
                color: dimmed ? (isLeaf ? '#52c41a' : '#999') : isLeaf ? '#0958d9' : '#555',
                fontWeight: isLeaf ? 600 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 140,
              }}
            >
              {n.key}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function getOrderedMatchIds(root: SerializedStateNode, matchSet: Set<string>): string[] {
  const result: string[] = []
  function traverse(node: SerializedStateNode) {
    if (matchSet.has(node.id)) result.push(node.id)
    for (const child of Object.values(node.states)) traverse(child)
  }
  traverse(root)
  return result
}

export function MachineTree() {
  const contextMenu = usePanelContextMenu()
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const selectStateNode = useStore((s) => s.selectStateNode)
  const treeFilter = useStore((s) => s.treeFilter)
  const setTreeFilter = useStore((s) => s.setTreeFilter)
  const actors = useStore((s) => s.actors)
  const portConnected = useStore((s) => s.portConnected)
  const dispatch = useDispatch()
  const snapshot = useStore((s) =>
    selectedActorId ? getDisplaySnapshot(s, selectedActorId) : null,
  )

  const collapse = usePanelCollapse()
  const serverControls = useServerControls()

  const actor = selectedActorId ? actors.get(selectedActorId) : null

  const openRowContextMenu = React.useCallback(
    (event: React.MouseEvent, node: SerializedStateNode, isActive: boolean) => {
      contextMenu.openMenu(event, [
        {
          label: 'Select state node',
          onSelect: () => selectStateNode(node.id),
        },
        {
          label: 'Set active state',
          disabled: !selectedActorId || isActive,
          onSelect: () => {
            if (!selectedActorId) return
            dispatch({
              type: 'XSTATE_SET_ACTIVE_STATE',
              sessionId: selectedActorId,
              stateNodeId: node.id,
            })
          },
        },
        {
          label: 'Copy state node id',
          onSelect: () => void copyTextToClipboard(node.id),
        },
        {
          label: 'Go to definition',
          disabled: !canOpenSourceLocation(node.sourceLocation),
          onSelect: () => {
            if (node.sourceLocation) openSourceLocation(node.sourceLocation)
          },
        },
      ])
    },
    [contextMenu, selectStateNode, selectedActorId, dispatch],
  )

  const nearestMachineAncestor = React.useMemo(() => {
    if (!actor?.parentSessionId) return null

    let currentId = actor.parentSessionId
    while (currentId) {
      const current = actors.get(currentId)
      if (!current) return null
      if (current.machine) return current
      currentId = current.parentSessionId
    }

    return null
  }, [actor, actors])

  const selectActor = useStore((s) => s.selectActor)

  const serverDot =
    serverControls?.status === 'open'
      ? '#52c41a'
      : serverControls?.status === 'connecting'
        ? '#faad14'
        : serverControls?.status === 'error'
          ? '#ff4d4f'
          : '#d9d9d9'

  const matchSet = React.useMemo(() => {
    if (!actor?.machine || !treeFilter) return null
    return buildMachineTreeMatchSet(actor.machine.root, actor.machine.id, treeFilter)
  }, [actor?.machine, treeFilter])

  const highlightTerm = React.useMemo(() => getMachineTreeHighlightTerm(treeFilter), [treeFilter])

  // --- Search bar state (cmd+f / ctrl+f) ---
  const [searchOpen, setSearchOpen] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const [currentMatchIndex, setCurrentMatchIndex] = React.useState(0)

  const orderedMatchIds = React.useMemo(
    () => (actor?.machine && matchSet ? getOrderedMatchIds(actor.machine.root, matchSet) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actor?.machine, matchSet],
  )

  // Reset navigation index when filter text changes
  React.useEffect(() => {
    setCurrentMatchIndex(0)
  }, [])

  // Focus the input whenever the search bar opens
  React.useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    } else {
      setTreeFilter('')
    }
  }, [searchOpen, setTreeFilter])

  // Keyboard shortcut: cmd+f / ctrl+f to open; Escape to close
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setSearchOpen(true)
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [searchOpen])

  const navigateMatch = React.useCallback(
    (direction: 1 | -1) => {
      if (orderedMatchIds.length === 0) return
      const next = (currentMatchIndex + direction + orderedMatchIds.length) % orderedMatchIds.length
      setCurrentMatchIndex(next)
      selectStateNode(orderedMatchIds[next])
    },
    [currentMatchIndex, orderedMatchIds, selectStateNode],
  )

  // Breadcrumb path for the selected state node (safe with optional chaining)
  const breadcrumbPath =
    selectedStateNodeId && actor?.machine?.root
      ? findPath(actor.machine.root, selectedStateNodeId)
      : null

  // Active state paths — used as a fallback breadcrumb when nothing is selected
  const activePaths = React.useMemo(
    () =>
      !selectedStateNodeId && snapshot?.value != null && actor?.machine?.root
        ? getActivePaths(snapshot.value as any, actor.machine.root)
        : null,
    [selectedStateNodeId, snapshot?.value, actor?.machine?.root],
  )

  // Actor ancestry chain: root ancestor → direct parent of current actor
  const actorPath = React.useMemo(() => {
    if (!actor?.parentSessionId) return []
    const chain: ActorRecord[] = []
    let currentId: string | undefined = actor.parentSessionId
    while (currentId) {
      const a = actors.get(currentId)
      if (!a) break
      chain.unshift(a)
      currentId = a.parentSessionId
    }
    return chain
  }, [actor, actors])

  const Header = (
    <div
      style={{
        padding: '0 4px',
        minHeight: 30,
        boxSizing: 'border-box',
        borderBottom: '1px solid #eee',
        fontSize: 11,
        color: '#666',
        position: 'sticky',
        top: 0,
        background: '#fafafa',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <HeaderIconButton
          onClick={collapse.toggleLeft}
          title={collapse.leftCollapsed ? 'Show actor list' : 'Hide actor list'}
        >
          <PanelToggle side="left" collapsed={collapse.leftCollapsed} />
        </HeaderIconButton>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 2,
          overflow: 'hidden',
        }}
      >
        {actor?.machine && (
          <>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{actor.machine.id}</span>
            {actor.machine.sourceLocation &&
              (() => {
                const canOpenSource = canOpenSourceLocation(actor.machine.sourceLocation)
                return (
                  <button
                    type="button"
                    style={{
                      padding: 0,
                      background: 'transparent',
                      border: 'none',
                      cursor: canOpenSource ? 'pointer' : 'default',
                      color: canOpenSource ? '#1890ff' : '#999',
                      fontSize: 10,
                      textDecoration: canOpenSource ? 'none' : 'none',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                    title={
                      canOpenSource
                        ? 'Open in VS Code'
                        : `Source not openable: ${actor.machine.sourceLocation}`
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      if (canOpenSource) {
                        openSourceLocation(actor.machine.sourceLocation)
                      }
                    }}
                  >
                    {canOpenSource ? <ExternalLink size={11} /> : null}
                    {canOpenSource ? 'source' : 'source (unavailable)'}
                  </button>
                )
              })()}
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: '1px 6px',
            borderRadius: 10,
            background: portConnected ? '#f6ffed' : '#fff1f0',
            color: portConnected ? '#389e0d' : '#cf1322',
            border: `1px solid ${portConnected ? '#b7eb8f' : '#ffa39e'}`,
            whiteSpace: 'nowrap',
          }}
        >
          {portConnected ? '● Bridge connected' : '○ Bridge disconnected'}
        </span>
        <HeaderIconButton
          onClick={collapse.toggleRight}
          title={collapse.rightCollapsed ? 'Show side panel' : 'Hide side panel'}
        >
          <PanelToggle side="right" collapsed={collapse.rightCollapsed} />
        </HeaderIconButton>
      </div>
    </div>
  )

  const Footer = (
    <div
      style={{
        padding: '0 4px',
        minHeight: 26,
        borderTop: '1px solid #d0d7de',
        background: '#f6f8fa',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        fontSize: 11,
        boxSizing: 'border-box',
      }}
    >
      {searchOpen && actor?.machine ? (
        // Chrome DevTools-style find bar
        <>
          <HeaderIconButton onClick={() => setSearchOpen(false)} title="Close find (Escape)">
            <Close size={12} />
          </HeaderIconButton>
          <input
            ref={searchInputRef}
            value={treeFilter}
            onChange={(e) => setTreeFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false)
              } else if (e.key === 'Enter') {
                navigateMatch(e.shiftKey ? -1 : 1)
              }
            }}
            placeholder="Find state node"
            style={{
              flex: '1 1 auto',
              minWidth: 60,
              padding: '2px 6px',
              fontSize: 11,
              fontFamily: 'inherit',
              border: '1px solid #c6c6c6',
              borderRadius: 3,
              outline: 'none',
              height: 20,
              boxSizing: 'border-box',
              background: '#fff',
            }}
          />
          {treeFilter && (
            <span
              style={{
                fontSize: 10,
                color: orderedMatchIds.length > 0 ? '#444' : '#cf1322',
                whiteSpace: 'nowrap',
                padding: '0 6px',
                flexShrink: 0,
              }}
            >
              {orderedMatchIds.length > 0
                ? `${currentMatchIndex + 1} of ${orderedMatchIds.length}`
                : 'No results'}
            </span>
          )}
          <HeaderIconButton onClick={() => navigateMatch(-1)} title="Previous match (Shift+Enter)">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
              <path d="M5.5 3L9.5 8.5H1.5L5.5 3Z" />
            </svg>
          </HeaderIconButton>
          <HeaderIconButton onClick={() => navigateMatch(1)} title="Next match (Enter)">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
              <path d="M5.5 8L1.5 2.5H9.5L5.5 8Z" />
            </svg>
          </HeaderIconButton>
        </>
      ) : breadcrumbPath || (activePaths && activePaths.length > 0) ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            minWidth: 0,
            gap: 0,
          }}
        >
          {/* Actor ancestry segments */}
          {actorPath.map((a) => {
            const label = a.displayName ?? a.machine?.id ?? a.sessionId.slice(0, 8)
            return (
              <React.Fragment key={a.sessionId}>
                <button
                  type="button"
                  onClick={() => selectActor(a.sessionId)}
                  title={a.sessionId}
                  style={{
                    padding: '0 3px',
                    border: 'none',
                    background: 'transparent',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: 11,
                    color: '#888',
                    fontWeight: 400,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 120,
                  }}
                >
                  {label}
                </button>
                <span style={{ color: '#bbb', padding: '0 1px', flexShrink: 0, fontSize: 10 }}>
                  ›
                </span>
              </React.Fragment>
            )
          })}
          {/* State path */}
          {breadcrumbPath ? (
            <BreadcrumbRow path={breadcrumbPath} onSelect={selectStateNode} />
          ) : (
            activePaths?.map((path, pi) => (
              <React.Fragment key={pi}>
                {pi > 0 && (
                  <span style={{ color: '#ccc', padding: '0 3px', flexShrink: 0, fontSize: 10 }}>
                    |
                  </span>
                )}
                <BreadcrumbRow path={path} onSelect={selectStateNode} dimmed />
              </React.Fragment>
            ))
          )}
        </div>
      ) : (
        <span style={{ flex: 1 }} />
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
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          {!portConnected ? (
            <div style={{ fontSize: 12 }}>
              <div style={{ color: '#cf1322', fontWeight: 500, marginBottom: 4 }}>
                Not connected
              </div>
              <div style={{ color: '#8c8c8c' }}>
                Open DevTools on an inspected tab and reload the page.
              </div>
            </div>
          ) : actors.size === 0 ? (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              No actors detected.
              <br />
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
            <span style={{ fontSize: 12, color: '#aaa' }}>
              Select an actor from the left panel.
            </span>
          )}
        </div>
        {Footer}
      </div>
    )
  }

  if (!actor.machine) {
    const noMachineReason = actor.displayName
      ? `It is a service actor named "${actor.displayName}" rather than a machine-backed actor.`
      : 'It is a service actor without a machine-backed state tree.'

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {Header}
        <div
          style={{
            flex: 1,
            padding: 24,
            color: '#666',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontWeight: 500 }}>This actor does not expose a machine definition.</div>
            <div style={{ color: '#8c8c8c', lineHeight: 1.5 }}>{noMachineReason}</div>
            <div style={{ color: '#8c8c8c', lineHeight: 1.5 }}>
              Promise, callback, and other service actors can receive events, but they do not have a
              state tree to inspect.
            </div>
          </div>
          {nearestMachineAncestor && (
            <div>
              <button
                onClick={() => selectActor(nearestMachineAncestor.sessionId)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  background: '#1890ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                }}
              >
                Inspect parent machine {nearestMachineAncestor.machine?.id}
              </button>
            </div>
          )}
        </div>
        {Footer}
      </div>
    )
  }

  const activeIds = snapshot
    ? getActiveNodeIds(snapshot.value as any, actor.machine.root)
    : new Set<string>()

  const noMatches = matchSet !== null && matchSet.size === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {Header}
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
            onOpenContextMenu={openRowContextMenu}
            depth={0}
            filter={highlightTerm}
            matchSet={matchSet}
          />
        )}
      </div>
      {Footer}
    </div>
  )
}
