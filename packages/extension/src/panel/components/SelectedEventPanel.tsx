import { useEffect, useRef, useState } from 'react'
import { PanelContextMenu, copyTextToClipboard, usePanelContextMenu } from '../PanelContextMenu.js'
import { getSelectedEvent, useStore } from '../store.js'
import { AccordionSection } from './Accordion.js'
import { JsonView } from './JsonView.js'

export function SelectedEventPanel() {
  const contextMenu = usePanelContextMenu()
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedEvent = useStore((s) => getSelectedEvent(s))
  const [selectedEventOpen, setSelectedEventOpen] = useState(Boolean(selectedEvent))
  const previousSelectedEventSeqRef = useRef<number | null>(selectedEvent?.globalSeq ?? null)

  useEffect(() => {
    const selectedEventSeq = selectedEvent?.globalSeq ?? null
    if (selectedEventSeq === previousSelectedEventSeqRef.current) {
      return
    }

    previousSelectedEventSeqRef.current = selectedEventSeq
    setSelectedEventOpen(Boolean(selectedEvent))
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedEvent])

  return (
    <div
      ref={containerRef}
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
      >
        {selectedEvent ? (
          <JsonView value={selectedEvent.event} />
        ) : (
          <div style={{ color: '#aaa', fontSize: 11 }}>
            Click an event in the log to inspect its payload.
          </div>
        )}
      </AccordionSection>
      <PanelContextMenu menu={contextMenu.menu} onClose={contextMenu.closeMenu} />
    </div>
  )
}