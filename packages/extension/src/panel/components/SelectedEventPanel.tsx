import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { copyTextToClipboard, usePanelContextMenu } from '../PanelContextMenu.js'
import { getSelectedEvent, getSnapshotBeforeEvent, useStore } from '../store.js'
import { AccordionSection } from './Accordion.js'
import { JsonView } from './JsonView.js'
import { SnapshotDiffView } from './SnapshotDiffView.js'

export function SelectedEventPanel() {
  const contextMenu = usePanelContextMenu()
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedEvent = useStore((s) => getSelectedEvent(s))
  const snapshotBefore = useStore((s) => {
    const event = getSelectedEvent(s)
    return event ? getSnapshotBeforeEvent(s, event) : null
  })
  const [selectedEventOpen, setSelectedEventOpen] = useState(Boolean(selectedEvent))
  const previousSelectedEventSeqRef = useRef<number | null>(selectedEvent?.globalSeq ?? null)
  const [viewMode, setViewMode] = useState<'event' | 'diff'>('event')

  useEffect(() => {
    const selectedEventSeq = selectedEvent?.globalSeq ?? null
    if (selectedEventSeq === previousSelectedEventSeqRef.current) {
      return
    }

    previousSelectedEventSeqRef.current = selectedEventSeq
    setSelectedEventOpen(Boolean(selectedEvent))
    setViewMode('event')
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedEvent])

  return (
    <div
      ref={containerRef}
      onMouseDown={(event) => {
        if (event.button !== 2) return
        if (!selectedEvent) return
        contextMenu.openMenu(event, [
          {
            label: 'Copy selected event JSON',
            onSelect: () => void copyTextToClipboard(JSON.stringify(selectedEvent.event, null, 2)),
          },
          {
            label: 'Copy selected event type',
            onSelect: () => void copyTextToClipboard(selectedEvent.event.type),
          },
        ])
      }}
      onContextMenu={(event) => {
        if (!selectedEvent) return
        contextMenu.openMenu(event, [
          {
            label: 'Copy selected event JSON',
            onSelect: () => void copyTextToClipboard(JSON.stringify(selectedEvent.event, null, 2)),
          },
          {
            label: 'Copy selected event type',
            onSelect: () => void copyTextToClipboard(selectedEvent.event.type),
          },
        ])
      }}
      style={{
        height: '100%',
        overflow: 'auto',
        background: '#fff',
        borderLeft: '1px solid #eee',
      }}
    >
      <AccordionSection
        title={selectedEvent ? `Selected event - ${selectedEvent.event.type}` : 'Selected event'}
        showTopBorder={false}
        open={selectedEventOpen}
        onOpenChange={setSelectedEventOpen}
        actions={
          selectedEvent ? (
            <ViewToggle value={viewMode} onChange={setViewMode} />
          ) : undefined
        }
      >
        {selectedEvent ? (
          viewMode === 'diff' ? (
            <SnapshotDiffView before={snapshotBefore} after={selectedEvent.snapshotAfter} />
          ) : (
            <JsonView value={selectedEvent.event} />
          )
        ) : (
          <div style={{ color: '#aaa', fontSize: 11 }}>
            Click an event in the log to inspect its payload.
          </div>
        )}
      </AccordionSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle buttons
// ---------------------------------------------------------------------------

const toggleBtnBase: React.CSSProperties = {
  fontSize: 10,
  padding: '1px 6px',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'pointer',
  lineHeight: 1.6,
  fontWeight: 500,
  userSelect: 'none',
}

function ViewToggle({
  value,
  onChange,
}: {
  value: 'event' | 'diff'
  onChange: (v: 'event' | 'diff') => void
}) {
  return (
    <>
      <button
        type="button"
        style={{
          ...toggleBtnBase,
          background: value === 'event' ? '#444' : '#fff',
          color: value === 'event' ? '#fff' : '#555',
          borderColor: value === 'event' ? '#444' : '#ccc',
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderRight: 'none',
        }}
        onClick={() => onChange('event')}
      >
        Event
      </button>
      <button
        type="button"
        style={{
          ...toggleBtnBase,
          background: value === 'diff' ? '#444' : '#fff',
          color: value === 'diff' ? '#fff' : '#555',
          borderColor: value === 'diff' ? '#444' : '#ccc',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
        }}
        onClick={() => onChange('diff')}
      >
        Diff
      </button>
    </>
  )
}
