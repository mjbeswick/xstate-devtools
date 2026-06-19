// packages/chrome-extension/src/panel/components/SidePanel.tsx
import React, { useState, useCallback } from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { useDispatch } from '../port-context.js'
import { AccordionSection } from './Accordion.js'
import { JsonView } from './JsonView.js'
import type { SerializedStateNode, SerializedTransition } from '../../shared/types.js'

function findNode(root: SerializedStateNode, id: string): SerializedStateNode | null {
  if (root.id === id) return root
  for (const child of Object.values(root.states)) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function TransitionRow({
  transition, onSend, disabled,
}: {
  transition: SerializedTransition
  onSend: (eventType: string) => void
  disabled?: boolean
}) {
  return (
    <div style={{
      padding: '5px 0', borderBottom: '1px solid #f0f0f0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
          {transition.eventType || '(always)'}
        </div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
          {transition.targets.length > 0 && (
            <>→ {transition.targets.map((t) => t.split('.').pop()).join(', ')}</>
          )}
          {transition.guard && <> [if: {transition.guard}]</>}
        </div>
      </div>
      {transition.eventType && (
        <button
          onClick={() => onSend(transition.eventType)}
          disabled={disabled}
          style={{
            padding: '2px 8px', fontSize: 11, cursor: disabled ? 'default' : 'pointer',
            background: disabled ? '#bfbfbf' : '#1890ff', color: '#fff',
            border: 'none', borderRadius: 4,
          }}
        >
          Send
        </button>
      )}
    </div>
  )
}

export function SidePanel() {
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const actors = useStore((s) => s.actors)
  const replayMode = useStore((s) => s.replayMode)
  const persisted = useStore((s) =>
    selectedActorId ? s.persistedSnapshots.get(selectedActorId) : undefined
  )
  const snapshot = useStore((s) =>
    selectedActorId ? getDisplaySnapshot(s, selectedActorId) : null
  )

  const dispatch_ = useDispatch()

  const capturePersisted = useCallback(() => {
    if (!selectedActorId || replayMode) return
    dispatch_({ type: 'XSTATE_REQUEST_PERSISTED', sessionId: selectedActorId })
  }, [selectedActorId, replayMode, dispatch_])

  const restorePersisted = useCallback((value: unknown) => {
    if (!selectedActorId || replayMode) return
    const ok = window.confirm(
      'Live rewind (experimental)\n\n' +
      'This recreates the actor from the captured persisted snapshot. ' +
      'It only works for actors wired with useRestorableInspectedMachine, and ' +
      'already-performed side effects (network calls, spawned children, messages ' +
      'sent to parents) are NOT undone.\n\nRestore to this state?'
    )
    if (!ok) return
    dispatch_({ type: 'XSTATE_RESTORE', sessionId: selectedActorId, persisted: value })
  }, [selectedActorId, replayMode, dispatch_])

  const [payloadJson, setPayloadJson] = useState('{}')
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [customEventType, setCustomEventType] = useState('')

  const actor = selectedActorId ? actors.get(selectedActorId) : null
  const node = actor?.machine && selectedStateNodeId
    ? findNode(actor.machine.root, selectedStateNodeId)
    : null

  const dispatch = useCallback((eventType: string) => {
    if (!selectedActorId || replayMode) return
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
  }, [selectedActorId, payloadJson, dispatch_, replayMode])

  if (!actor) {
    return (
      <div style={{ padding: 16, color: '#aaa', fontSize: 12 }}>
        Select an actor to inspect.
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#fff' }}>
      <AccordionSection
        title={node ? <>Transitions — <code style={{ fontSize: 11 }}>{node.key}</code></> : 'Transitions'}
      >
        {node && node.on.length > 0 ? (
          <>
            {node.on.map((t, i) => (
              <TransitionRow key={i} transition={t} onSend={dispatch} disabled={replayMode} />
            ))}
            {node.always.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#aaa', margin: '8px 0 4px' }}>ALWAYS</div>
                {node.always.map((t, i) => (
                  <TransitionRow key={i} transition={t} onSend={() => {}} />
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
        {replayMode && (
          <div style={{
            fontSize: 11, color: '#722ed1', background: '#f9f0ff',
            border: '1px solid #efdbff', borderRadius: 4, padding: '4px 8px', marginBottom: 8,
          }}>
            Disabled during replay — no live actor to receive events.
          </div>
        )}
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>PAYLOAD (JSON)</div>
        <textarea
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          style={{
            width: '100%', height: 70, fontFamily: 'monospace', fontSize: 11,
            border: payloadError ? '1px solid red' : '1px solid #d9d9d9',
            borderRadius: 4, padding: 4, resize: 'vertical',
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
              flex: 1, fontFamily: 'monospace', fontSize: 11,
              padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4,
            }}
          />
          <button
            onClick={() => customEventType && dispatch(customEventType)}
            disabled={replayMode}
            style={{
              padding: '2px 10px', fontSize: 11, cursor: replayMode ? 'default' : 'pointer',
              background: replayMode ? '#bfbfbf' : '#52c41a', color: '#fff',
              border: 'none', borderRadius: 4,
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

      <AccordionSection title="Persisted snapshot" defaultOpen={false}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>
          XState persisted snapshot — restorable, unlike the display Context above.
        </div>
        <button
          onClick={capturePersisted}
          disabled={replayMode}
          style={{
            padding: '2px 10px', fontSize: 11, marginBottom: 6,
            cursor: replayMode ? 'default' : 'pointer',
            background: replayMode ? '#bfbfbf' : '#1890ff', color: '#fff',
            border: 'none', borderRadius: 4,
          }}
        >
          {persisted ? 'Re-capture' : 'Capture'}
        </button>
        {replayMode && (
          <div style={{ fontSize: 10, color: '#888' }}>
            Replay sessions show snapshots captured at export time; live capture is disabled.
          </div>
        )}
        {persisted?.error && (
          <div style={{
            fontSize: 11, color: '#a8071a', background: '#fff1f0',
            border: '1px solid #ffccc7', borderRadius: 4, padding: '4px 8px',
          }}>
            {persisted.error}
          </div>
        )}
        {persisted?.persisted !== undefined && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button
                onClick={() => restorePersisted(persisted.persisted)}
                disabled={replayMode}
                title="Recreate the actor from this snapshot (experimental)"
                style={{
                  padding: '2px 10px', fontSize: 11,
                  cursor: replayMode ? 'default' : 'pointer',
                  background: replayMode ? '#bfbfbf' : '#fff', color: replayMode ? '#fff' : '#a8071a',
                  border: `1px solid ${replayMode ? '#bfbfbf' : '#ffa39e'}`, borderRadius: 4,
                }}
              >
                ⏮ Restore to this state
              </button>
              <span style={{ fontSize: 10, color: '#aaa' }}>experimental · live rewind</span>
            </div>
            <JsonView value={persisted.persisted} />
          </>
        )}
      </AccordionSection>

      <AccordionSection
        title="Status"
        defaultOpen={Boolean(snapshot && snapshot.status !== 'active')}
      >
        <div style={{ fontSize: 11 }}>
          <div>State: <strong>{snapshot?.status ?? 'unknown'}</strong></div>
          {snapshot?.error != null && (
            <pre style={{
              fontSize: 10, marginTop: 4, background: '#fff1f0', color: '#a8071a',
              padding: 6, borderRadius: 4, overflow: 'auto',
            }}>
              {JSON.stringify(snapshot.error, null, 2)}
            </pre>
          )}
        </div>
      </AccordionSection>

      <AccordionSection title="Actor info" defaultOpen={false}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6 }}>
          <div>id: <code>{actor.machine?.id ?? '(no machine)'}</code></div>
          <div>session: <code>{actor.sessionId}</code></div>
          {actor.parentSessionId && (
            <div>parent: <code>{actor.parentSessionId}</code></div>
          )}
          {actor.machine?.sourceLocation && (
            <div>
              source:{' '}
              <a
                href={`vscode://file/${actor.machine.sourceLocation}`}
                style={{ color: '#1890ff' }}
              >
                {actor.machine.sourceLocation}
              </a>
            </div>
          )}
        </div>
      </AccordionSection>
    </div>
  )
}
