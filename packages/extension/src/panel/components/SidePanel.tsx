// packages/extension/src/panel/components/SidePanel.tsx
import { useCallback, useState } from 'react'
import type { SerializedStateNode, SerializedTransition } from '../../shared/types.js'
import { getActiveNodeIds } from '../active-nodes.js'
import { canOpenSourceLocation, getSourceHref, openSourceLocation } from '../open-source.js'
import { copyTextToClipboard, usePanelContextMenu } from '../PanelContextMenu.js'
import { useDispatch } from '../port-context.js'
import { getDisplaySnapshot, useStore } from '../store.js'
import { AccordionSection } from './Accordion.js'
import { ChevronRight } from './Icons.js'
import { JsonView } from './JsonView.js'

function findNode(root: SerializedStateNode, id: string): SerializedStateNode | null {
  if (root.id === id) return root
  for (const child of Object.values(root.states)) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function sortTransitions(transitions: SerializedTransition[]): SerializedTransition[] {
  return [...transitions].sort((left, right) => {
    const leftLabel = left.eventType || '(always)'
    const rightLabel = right.eventType || '(always)'
    const byLabel = leftLabel.localeCompare(rightLabel)
    if (byLabel !== 0) return byLabel

    const leftTargets = left.targets.join(',')
    const rightTargets = right.targets.join(',')
    const byTargets = leftTargets.localeCompare(rightTargets)
    if (byTargets !== 0) return byTargets

    return (left.guard || '').localeCompare(right.guard || '')
  })
}

function TransitionRow({
  transition,
  onSend,
  onOpenContextMenu,
}: {
  transition: SerializedTransition
  onSend: (eventType: string) => void
  onOpenContextMenu: (event: React.MouseEvent, transition: SerializedTransition) => void
}) {
  return (
    <div
      onMouseDown={(event) => {
        if (event.button !== 2) return
        onOpenContextMenu(event, transition)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, transition)}
      style={{
        padding: '5px 0',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 600,
            overflowWrap: 'anywhere',
          }}
        >
          {transition.eventType || '(always)'}
        </div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 2, overflowWrap: 'anywhere' }}>
          {transition.targets.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ChevronRight size={10} color="#888" />
              <span>{transition.targets.map((t) => t.split('.').pop()).join(', ')}</span>
            </span>
          )}
          {transition.guard && <> [if: {transition.guard}]</>}
        </div>
      </div>
      {transition.eventType && (
        <button
          type="button"
          onClick={() => onSend(transition.eventType)}
          style={{
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            background: '#1890ff',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          Send
        </button>
      )}
    </div>
  )
}

export function SidePanel() {
  const contextMenu = usePanelContextMenu()
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const actors = useStore((s) => s.actors)
  const snapshot = useStore((s) =>
    selectedActorId ? getDisplaySnapshot(s, selectedActorId) : null,
  )

  const dispatch_ = useDispatch()

  const [payloadJson, setPayloadJson] = useState('{}')
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [customEventType, setCustomEventType] = useState('')

  const actor = selectedActorId ? actors.get(selectedActorId) : null
  const node =
    actor?.machine && selectedStateNodeId ? findNode(actor.machine.root, selectedStateNodeId) : null
  const activeIds =
    actor?.machine && snapshot
      ? getActiveNodeIds(snapshot.value as any, actor.machine.root)
      : new Set()
  const canOpenSource = canOpenSourceLocation(actor?.machine?.sourceLocation)
  const selectedNodeIsActive = node ? activeIds.has(node.id) : false
  const sortedOnTransitions = node ? sortTransitions(node.on) : []
  const sortedAlwaysTransitions = node ? sortTransitions(node.always) : []

  const dispatch = useCallback(
    (eventType: string) => {
      if (!selectedActorId) return
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(payloadJson)
        setPayloadError(null)
      } catch {
        setPayloadError('Invalid JSON')
        return
      }
      dispatch_({
        type: 'XSTATE_DISPATCH',
        sessionId: selectedActorId,
        event: { type: eventType, ...payload },
      })
    },
    [selectedActorId, payloadJson, dispatch_],
  )

  const setActiveState = useCallback(() => {
    if (!selectedActorId || !node) return
    dispatch_({
      type: 'XSTATE_SET_ACTIVE_STATE',
      sessionId: selectedActorId,
      stateNodeId: node.id,
    })
  }, [dispatch_, node, selectedActorId])

  const openTransitionMenu = useCallback(
    (event: React.MouseEvent, transition: SerializedTransition) => {
      contextMenu.openMenu(event, [
        {
          label: 'Send event',
          disabled: !transition.eventType || !canSendEvents,
          onSelect: () => {
            if (transition.eventType) dispatch(transition.eventType)
          },
        },
        {
          label: 'Log event type to console',
          disabled: !transition.eventType,
          onSelect: () => {
            if (!transition.eventType) return
            chrome.devtools.inspectedWindow.eval(
              'console.log("XState DevTools:',
              // Escaping quotes for eval payload
              transition.eventType.replace(/"/g, '"'),
              '")',
            )
          },
        },
        {
          label: 'Copy event type',
          disabled: !transition.eventType,
          onSelect: () => {
            if (transition.eventType) copyTextToClipboard(transition.eventType)
          },
        },
      ])
    },
    [dispatch, contextMenu],
  )

  if (!actor) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#aaa',
          fontSize: 12,
        }}
      >
        Select an actor to inspect.
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#fff' }}>
      <AccordionSection
        title={
          node ? (
            <>
              Transitions — <code style={{ fontSize: 11 }}>{node.key}</code>
            </>
          ) : (
            'Transitions'
          )
        }
      >
        {node && (
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={setActiveState}
              disabled={selectedNodeIsActive}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                cursor: selectedNodeIsActive ? 'default' : 'pointer',
                background: selectedNodeIsActive ? '#f5f5f5' : '#722ed1',
                color: selectedNodeIsActive ? '#8c8c8c' : '#fff',
                border: 'none',
                borderRadius: 4,
              }}
            >
              {selectedNodeIsActive ? 'Active' : 'Set active'}
            </button>
          </div>
        )}
        {node && (sortedOnTransitions.length > 0 || sortedAlwaysTransitions.length > 0) ? (
          <>
            {sortedOnTransitions.map((t, i) => (
              <TransitionRow
                key={`${t.eventType || 'always'}:${t.targets.join(',')}:${t.guard || ''}:${i}`}
                transition={t}
                onSend={dispatch}
                onOpenContextMenu={openTransitionMenu}
              />
            ))}
            {sortedAlwaysTransitions.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#aaa', margin: '8px 0 4px' }}>ALWAYS</div>
                {sortedAlwaysTransitions.map((t, i) => (
                  <TransitionRow
                    key={`${t.eventType || 'always'}:${t.targets.join(',')}:${t.guard || ''}:${i}`}
                    transition={t}
                    onSend={() => {}}
                    onOpenContextMenu={openTransitionMenu}
                  />
                ))}
              </>
            )}
          </>
        ) : node ? (
          <div style={{ color: '#aaa', fontSize: 11 }}>No transitions from this state.</div>
        ) : (
          <div style={{ color: '#aaa', fontSize: 11 }}>Select a state node in the tree.</div>
        )}
      </AccordionSection>

      <AccordionSection title="Send event">
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>PAYLOAD (JSON)</div>
        <textarea
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          style={{
            width: '100%',
            height: 70,
            fontFamily: 'monospace',
            fontSize: 11,
            border: payloadError ? '1px solid red' : '1px solid #d9d9d9',
            borderRadius: 4,
            padding: 4,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        {payloadError && <div style={{ color: 'red', fontSize: 10 }}>{payloadError}</div>}

        <div style={{ fontSize: 10, color: '#888', margin: '8px 0 4px' }}>CUSTOM EVENT</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={customEventType}
            onChange={(e) => setCustomEventType(e.target.value)}
            placeholder="EVENT_TYPE"
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 11,
              padding: '2px 6px',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
            }}
          />
          <button
            onClick={() => customEventType && dispatch(customEventType)}
            style={{
              padding: '2px 10px',
              fontSize: 11,
              cursor: 'pointer',
              background: '#52c41a',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
            }}
          >
            Send
          </button>
        </div>
      </AccordionSection>

      <AccordionSection title="Context">
        {snapshot ? (
          snapshot.context === undefined ? (
            <div style={{ color: '#aaa', fontSize: 11 }}>(no context)</div>
          ) : (
            <JsonView value={snapshot.context} />
          )
        ) : (
          <div style={{ color: '#aaa', fontSize: 11 }}>No snapshot available.</div>
        )}
      </AccordionSection>

      <AccordionSection
        title="Status"
        defaultOpen={Boolean(snapshot && snapshot.status !== 'active')}
      >
        <div style={{ fontSize: 11 }}>
          <div>
            State: <strong>{snapshot?.status ?? 'unknown'}</strong>
          </div>
          {snapshot?.error && (
            <pre
              style={{
                fontSize: 10,
                marginTop: 4,
                background: '#fff1f0',
                color: '#a8071a',
                padding: 6,
                borderRadius: 4,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(snapshot.error, null, 2)}
            </pre>
          )}
        </div>
      </AccordionSection>

      <AccordionSection title="Actor info" defaultOpen={false}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6 }}>
          <div>
            id: <code>{actor.machine?.id ?? '(no machine)'}</code>
          </div>
          <div>
            session: <code>{actor.sessionId}</code>
          </div>
          {actor.parentSessionId && (
            <div>
              parent: <code>{actor.parentSessionId}</code>
            </div>
          )}
          {actor.machine?.sourceLocation && (
            <div>
              source:{' '}
              {canOpenSource ? (
                <a
                  href={getSourceHref(actor.machine.sourceLocation) ?? undefined}
                  onMouseDown={(event) => {
                    if (event.button !== 2) return

                    contextMenu.openMenu(event, [
                      {
                        label: 'Open source location',
                        onSelect: () => openSourceLocation(actor.machine.sourceLocation),
                      },
                      {
                        label: 'Copy source location',
                        onSelect: () => void copyTextToClipboard(actor.machine.sourceLocation),
                      },
                    ])
                  }}
                  onContextMenu={(event) => {
                    contextMenu.openMenu(event, [
                      {
                        label: 'Open source location',
                        onSelect: () => openSourceLocation(actor.machine.sourceLocation),
                      },
                      {
                        label: 'Copy source location',
                        onSelect: () => void copyTextToClipboard(actor.machine.sourceLocation),
                      },
                    ])
                  }}
                  style={{
                    color: '#1890ff',
                    padding: 0,
                    font: 'inherit',
                    textDecoration: 'underline',
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    openSourceLocation(actor.machine.sourceLocation)
                  }}
                >
                  {actor.machine.sourceLocation}
                </a>
              ) : (
                <span style={{ color: '#999' }}>{actor.machine.sourceLocation}</span>
              )}
            </div>
          )}
        </div>
      </AccordionSection>
    </div>
  )
}
