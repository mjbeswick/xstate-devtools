// packages/extension/src/panel/components/SidePanel.tsx
import React, { useState, useCallback } from 'react'
import { useStore, getDisplaySnapshot } from '../store.js'
import { useDispatch } from '../port-context.js'
import type { SerializedStateNode, SerializedTransition } from '../../shared/types.js'

type Tab = 'transitions' | 'context'

function findNode(root: SerializedStateNode, id: string): SerializedStateNode | null {
  if (root.id === id) return root
  for (const child of Object.values(root.states)) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function TransitionRow({
  transition,
  onSend,
}: {
  transition: SerializedTransition
  onSend: (eventType: string) => void
}) {
  return (
    <div style={{
      padding: '6px 0', borderBottom: '1px solid #f0f0f0',
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

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        background: 'transparent', border: 'none',
        borderBottom: active ? '2px solid #1890ff' : '2px solid transparent',
        color: active ? '#1890ff' : '#666',
      }}
    >
      {children}
    </button>
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

  const [tab, setTab] = useState<Tab>('transitions')
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
    <div style={{ borderLeft: '1px solid #eee', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0 }}>
        <TabButton active={tab === 'transitions'} onClick={() => setTab('transitions')}>
          Transitions
        </TabButton>
        <TabButton active={tab === 'context'} onClick={() => setTab('context')}>
          Context
        </TabButton>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {tab === 'transitions' && (
          <>
            <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 8 }}>
              {node ? `TRANSITIONS FROM: ${node.key}` : 'SELECTED STATE'}
            </div>

            {node && node.on.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
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
              </div>
            ) : node ? (
              <div style={{ color: '#aaa', fontSize: 11, marginBottom: 12 }}>
                No transitions from this state.
              </div>
            ) : (
              <div style={{ color: '#aaa', fontSize: 11, marginBottom: 12 }}>
                Select a state node in the tree.
              </div>
            )}

            <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 4 }}>PAYLOAD</div>
            <textarea
              value={payloadJson}
              onChange={(e) => setPayloadJson(e.target.value)}
              style={{
                width: '100%', height: 80, fontFamily: 'monospace', fontSize: 11,
                border: payloadError ? '1px solid red' : '1px solid #d9d9d9',
                borderRadius: 4, padding: 4, resize: 'vertical',
              }}
            />
            {payloadError && <div style={{ color: 'red', fontSize: 10 }}>{payloadError}</div>}

            <div style={{ fontWeight: 600, fontSize: 11, color: '#666', margin: '8px 0 4px' }}>
              SEND CUSTOM EVENT
            </div>
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
          </>
        )}

        {tab === 'context' && (
          <>
            <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 8 }}>
              CONTEXT — {actor.machine?.id ?? 'actor'}
            </div>
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

            {snapshot?.status && snapshot.status !== 'active' && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#d4380d' }}>
                Status: <strong>{snapshot.status}</strong>
                {snapshot.error && (
                  <pre style={{ fontSize: 10, marginTop: 4 }}>
                    {JSON.stringify(snapshot.error, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
