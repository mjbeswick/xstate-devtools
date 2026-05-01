// packages/extension/src/panel/components/SidePanel.tsx
import React, { useState, useCallback } from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { useDispatch } from '../port-context.js'
import { AccordionSection } from './Accordion.js'
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
  transition, onSend,
}: {
  transition: SerializedTransition
  onSend: (eventType: string) => void
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
          style={{
            padding: '2px 8px', fontSize: 11, cursor: 'pointer',
            background: '#1890ff', color: '#fff', border: 'none', borderRadius: 4,
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
  const snapshot = useStore((s) =>
    selectedActorId ? getDisplaySnapshot(s, selectedActorId) : null
  )

  const dispatch_ = useDispatch()

  const [payloadJson, setPayloadJson] = useState('{}')
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [customEventType, setCustomEventType] = useState('')

  const actor = selectedActorId ? actors.get(selectedActorId) : null
  const node = actor?.machine && selectedStateNodeId
    ? findNode(actor.machine.root, selectedStateNodeId)
    : null

  const dispatch = useCallback((eventType: string) => {
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
  }, [selectedActorId, payloadJson, dispatch_])

  if (!actor) {
    return (
      <div style={{ padding: 16, color: '#aaa', fontSize: 12, borderLeft: '1px solid #eee' }}>
        Select an actor to inspect.
      </div>
    )
  }

  return (
    <div style={{ borderLeft: '1px solid #eee', height: '100%', overflow: 'auto', background: '#fff' }}>
      <AccordionSection
        title={node ? <>Transitions — <code style={{ fontSize: 11 }}>{node.key}</code></> : 'Transitions'}
      >
        {node && node.on.length > 0 ? (
          <>
            {node.on.map((t, i) => (
              <TransitionRow key={i} transition={t} onSend={dispatch} />
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
            style={{
              padding: '2px 10px', fontSize: 11, cursor: 'pointer',
              background: '#52c41a', color: '#fff', border: 'none', borderRadius: 4,
            }}
          >
            Send
          </button>
        </div>
      </AccordionSection>

      <AccordionSection title="Context">
        {snapshot ? (
          <pre style={{
            fontSize: 11, background: '#f5f5f5', padding: 8,
            borderRadius: 4, overflow: 'auto', margin: 0,
            fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {snapshot.context === undefined
              ? '(no context)'
              : JSON.stringify(snapshot.context, null, 2)}
          </pre>
        ) : (
          <div style={{ color: '#aaa', fontSize: 11 }}>No snapshot available.</div>
        )}
      </AccordionSection>

      <AccordionSection
        title="Status"
        defaultOpen={Boolean(snapshot && snapshot.status !== 'active')}
      >
        <div style={{ fontSize: 11 }}>
          <div>State: <strong>{snapshot?.status ?? 'unknown'}</strong></div>
          {snapshot?.error && (
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
