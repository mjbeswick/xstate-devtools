// packages/extension/src/panel/components/EventLog.tsx
import { useLayoutEffect, useRef, useState } from 'react'
import type {} from '../../shared/types.js'
import { copyTextToClipboard, usePanelContextMenu } from '../PanelContextMenu.js'
import { usePanelCollapse } from '../panel-collapse-context.js'
import { getEventSourceStateNodeId, useStore } from '../store.js'
import { ClearLog, DisclosureTriangle, EventLog as EventLogIcon, PanelToggle } from './Icons.js'

interface ScrollContainer {
  scrollTop: number
  scrollHeight: number
}

interface SyncEventLogScrollOptions {
  autoScroll: boolean
  collapsed: boolean
  latestEventSeq: number | null
  previousLatestEventSeq: number | null
  previousScrollTop: number
  timeTravelSeq: number | null
}

export function syncEventLogScroll(
  container: ScrollContainer | null,
  {
    autoScroll,
    collapsed,
    latestEventSeq,
    previousLatestEventSeq,
    previousScrollTop,
    timeTravelSeq,
  }: SyncEventLogScrollOptions,
) {
  const hasNewEvents = latestEventSeq !== null && latestEventSeq !== previousLatestEventSeq

  if (!container || collapsed || !hasNewEvents) {
    return
  }

  if (!autoScroll || timeTravelSeq !== null) {
    container.scrollTop = previousScrollTop
    return
  }

  container.scrollTop = container.scrollHeight
}

interface EventFilterToken {
  negated: boolean
  value: string
}

function parseEventFilter(filter: string): EventFilterToken[] {
  return filter
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const negated = token.startsWith('-') && token.length > 1

      return {
        negated,
        value: (negated ? token.slice(1) : token).toLowerCase(),
      }
    })
    .filter((token) => token.value.length > 0)
}

export function eventMatchesFilter(
  eventType: string,
  filter: string,
  actorLabel?: string,
): boolean {
  const tokens = parseEventFilter(filter)

  if (tokens.length === 0) {
    return true
  }

  const normalizedEventType = eventType.toLowerCase()
  const normalizedActorLabel = actorLabel?.toLowerCase()
  const positiveTokens = tokens.filter((token) => !token.negated)

  const matchesField = (token: EventFilterToken) =>
    normalizedEventType.includes(token.value) ||
    (normalizedActorLabel !== undefined && normalizedActorLabel.includes(token.value))

  if (tokens.some((token) => token.negated && matchesField(token))) {
    return false
  }

  if (positiveTokens.length === 0) {
    return true
  }

  return positiveTokens.every(matchesField)
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

interface Props {
  collapsed?: boolean
  onExpand?: () => void
}

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
      type="button"
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

export function EventLog({ collapsed = false, onExpand }: Props = {}) {
  const contextMenu = usePanelContextMenu()
  const collapse = usePanelCollapse()
  const events = useStore((s) => s.events)
  const actors = useStore((s) => s.actors)
  const loggingPaused = useStore((s) => s.loggingPaused)
  const setLoggingPaused = useStore((s) => s.setLoggingPaused)
  const clearEvents = useStore((s) => s.clearEvents)
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)
  const selectActor = useStore((s) => s.selectActor)
  const selectStateNode = useStore((s) => s.selectStateNode)
  const registeredSnapshots = useStore((s) => s.registeredSnapshots)

  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const previousLatestEventSeqRef = useRef<number | null>(null)
  const previousScrollTopRef = useRef(0)
  const latestEventSeq = events.at(-1)?.globalSeq ?? null

  useLayoutEffect(() => {
    syncEventLogScroll(listRef.current, {
      autoScroll,
      collapsed,
      latestEventSeq,
      previousLatestEventSeq: previousLatestEventSeqRef.current,
      previousScrollTop: previousScrollTopRef.current,
      timeTravelSeq,
    })

    previousLatestEventSeqRef.current = latestEventSeq
  }, [autoScroll, collapsed, latestEventSeq, timeTravelSeq])

  const filtered = events.filter((e) => {
    if (!filter) return true
    const label = actors.get(e.sessionId)?.machine?.id ?? e.sessionId.slice(0, 12)
    return eventMatchesFilter(e.event.type, filter, label)
  })

  const selectLogEvent = (
    evt: (typeof filtered)[number],
    options: { toggleIfCurrent: boolean },
  ) => {
    const isCurrent = evt.globalSeq === timeTravelSeq

    if (isCurrent && options.toggleIfCurrent) {
      timeTravel(null)
      return
    }

    const sourceStateNodeId = getEventSourceStateNodeId(
      { actors, events, registeredSnapshots },
      evt,
    )

    timeTravel(evt.globalSeq)
    selectActor(evt.sessionId)
    selectStateNode(sourceStateNodeId)
    if (collapse.selectedEventCollapsed) {
      collapse.toggleSelectedEvent()
    }
  }

  if (collapsed) {
    return (
      <div
        onClick={onExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          minHeight: 30,
          height: '100%',
          boxSizing: 'border-box',
          background: '#fafafa',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        title="Show event log"
      >
        <span style={{ display: 'inline-flex', color: '#666' }}>
          <DisclosureTriangle
            size={12}
            color="#666"
            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
          />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <EventLogIcon size={12} color="#666" />
          <span style={{ fontWeight: 600, fontSize: 11, color: '#666' }}>EVENTS</span>
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{events.length}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          minHeight: 30,
          boxSizing: 'border-box',
          borderBottom: '1px solid #eee',
          background: '#fafafa',
          flexShrink: 0,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 11, color: '#666' }}>EVENTS</span>
        </span>
        <HeaderIconButton
          onClick={clearEvents}
          title={events.length === 0 ? 'No events to clear' : 'Clear all events'}
        >
          <ClearLog size={13} color={events.length === 0 ? '#bfbfbf' : '#666'} />
        </HeaderIconButton>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by type or actor…"
          style={{
            fontSize: 11,
            padding: '2px 6px',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            width: 160,
          }}
        />
        <label
          style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <input
            type="checkbox"
            checked={loggingPaused}
            onChange={(e) => setLoggingPaused(e.target.checked)}
          />
          Pause
        </label>
        <label
          style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>
          {events.length} events
        </span>
        <HeaderIconButton
          onClick={collapse.toggleSelectedEvent}
          title={collapse.selectedEventCollapsed ? 'Show selected event' : 'Hide selected event'}
        >
          <PanelToggle side="right" collapsed={collapse.selectedEventCollapsed} />
        </HeaderIconButton>
      </div>

      <div
        ref={listRef}
        onContextMenu={(event) => {
          contextMenu.openMenu(event, [
            {
              label: 'Copy visible events JSON',
              disabled: filtered.length === 0,
              onSelect: () =>
                void copyTextToClipboard(
                  JSON.stringify(
                    filtered.map((evt) => evt.event),
                    null,
                    2,
                  ),
                ),
            },
            {
              label: 'Clear all events',
              disabled: events.length === 0,
              onSelect: () => clearEvents(),
            },
          ])
        }}
        onScroll={(event) => {
          previousScrollTopRef.current = event.currentTarget.scrollTop
        }}
        style={{
          flex: 1,
          overflow: 'auto',
          overflowAnchor: 'none',
          fontFamily: 'monospace',
          fontSize: 11,
          userSelect: 'none',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 120px 1fr',
            gap: 8,
            padding: '3px 8px',
            position: 'sticky',
            top: 0,
            background: '#f5f5f5',
            borderBottom: '1px solid #e8e8e8',
            color: '#999',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <span>Time</span>
          <span>Actor</span>
          <span>Event</span>
        </div>
        {filtered.map((evt) => {
          const actorLabel = actors.get(evt.sessionId)?.machine?.id ?? evt.sessionId.slice(0, 12)
          const isCurrent = evt.globalSeq === timeTravelSeq
          return (
            <div
              key={evt.globalSeq}
              onClick={(_event) => {
                // Left click should select it
                selectLogEvent(evt, { toggleIfCurrent: false })
              }}
              onContextMenu={(event) => {
                contextMenu.openMenu(event, [
                  {
                    label: isCurrent ? 'Back to live' : 'Time travel to event',
                    onSelect: () => selectLogEvent(evt, { toggleIfCurrent: true }),
                  },
                  {
                    label: `Filter by actor: ${actorLabel}`,
                    onSelect: () => setFilter(actorLabel),
                  },
                  {
                    label: `Exclude actor: ${actorLabel}`,
                    onSelect: () =>
                      setFilter((f) => [f, `-${actorLabel}`].filter(Boolean).join(' ')),
                  },
                  {
                    label: 'Copy event JSON',
                    onSelect: () => void copyTextToClipboard(JSON.stringify(evt.event, null, 2)),
                  },
                  {
                    label: 'Copy event type',
                    onSelect: () => void copyTextToClipboard(evt.event.type),
                  },
                  {
                    label: 'Copy actor session id',
                    onSelect: () => void copyTextToClipboard(evt.sessionId),
                  },
                  {
                    label: 'Copy visible events JSON',
                    disabled: filtered.length === 0,
                    onSelect: () =>
                      void copyTextToClipboard(
                        JSON.stringify(
                          filtered.map((evt) => evt.event),
                          null,
                          2,
                        ),
                      ),
                  },
                  {
                    label: 'Clear all events',
                    disabled: events.length === 0,
                    onSelect: () => clearEvents(),
                  },
                ])
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 120px 1fr',
                gap: 8,
                padding: '3px 8px',
                cursor: 'pointer',
                background: isCurrent ? '#e6f4ff' : 'transparent',
                borderLeft: isCurrent ? '3px solid #1890ff' : '3px solid transparent',
              }}
              title="Click to time travel to this event"
            >
              <span style={{ color: '#aaa' }}>{formatTime(evt.timestamp)}</span>
              <span
                style={{
                  color: '#595959',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {actorLabel}
              </span>
              <span style={{ color: '#003a8c' }}>{evt.event.type}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
