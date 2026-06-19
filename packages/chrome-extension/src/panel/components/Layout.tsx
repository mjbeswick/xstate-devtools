// packages/chrome-extension/src/panel/components/Layout.tsx
import React, { useRef, useState, useMemo, useEffect } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { ActorList } from './ActorList.js'
import { MachineTree } from './MachineTree.js'
import { SidePanel } from './SidePanel.js'
import { EventLog } from './EventLog.js'
import { useStore } from '../store.js'
import { PanelCollapseContext } from '../panel-collapse-context.js'
import { History } from './Icons.js'

// Thin Chrome-DevTools-style dividers: 1px visible border with a wider
// invisible hit area for easier grabbing.
const dividerStyle: React.CSSProperties = {
  width: 1, background: '#d0d7de', cursor: 'col-resize', flexShrink: 0,
  outline: '2px solid transparent', outlineOffset: -1,
}
const hDividerStyle: React.CSSProperties = {
  height: 1, background: '#d0d7de', cursor: 'row-resize', flexShrink: 0,
  outline: '2px solid transparent', outlineOffset: -1,
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

export function Layout() {
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)
  const events = useStore((s) => s.events)
  const selectActor = useStore((s) => s.selectActor)

  // Step time-travel one event earlier/later along the global timeline.
  // Stepping past the newest event returns to live; null seq means "live".
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (events.length === 0) return

      if (e.key === 'Escape') {
        if (timeTravelSeq !== null) { e.preventDefault(); timeTravel(null) }
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return

      e.preventDefault()
      if (timeTravelSeq === null) {
        // Enter history from live: ArrowLeft lands on the newest event.
        if (e.key === 'ArrowLeft') {
          const last = events[events.length - 1]
          timeTravel(last.globalSeq)
          selectActor(last.sessionId)
        }
        return
      }

      const idx = events.findIndex((ev) => ev.globalSeq === timeTravelSeq)
      if (idx === -1) return
      if (e.key === 'ArrowLeft') {
        if (idx === 0) return
        const prev = events[idx - 1]
        timeTravel(prev.globalSeq)
        selectActor(prev.sessionId)
      } else {
        if (idx === events.length - 1) { timeTravel(null); return }
        const next = events[idx + 1]
        timeTravel(next.globalSeq)
        selectActor(next.sessionId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [events, timeTravelSeq, timeTravel, selectActor])

  const currentEvent = timeTravelSeq !== null
    ? events.find((ev) => ev.globalSeq === timeTravelSeq) ?? null
    : null

  const actorListRef = useRef<ImperativePanelHandle>(null)
  const sideRef = useRef<ImperativePanelHandle>(null)
  const logRef = useRef<ImperativePanelHandle>(null)

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [bottomCollapsed, setBottomCollapsed] = useState(false)

  const collapseControls = useMemo(() => ({
    leftCollapsed, rightCollapsed, bottomCollapsed,
    toggleLeft: () => {
      const ref = actorListRef.current
      if (!ref) return
      if (ref.isCollapsed()) ref.expand()
      else ref.collapse()
    },
    toggleRight: () => {
      const ref = sideRef.current
      if (!ref) return
      if (ref.isCollapsed()) ref.expand()
      else ref.collapse()
    },
    toggleBottom: () => {
      const ref = logRef.current
      if (!ref) return
      if (ref.isCollapsed()) ref.expand()
      else ref.collapse()
    },
  }), [leftCollapsed, rightCollapsed, bottomCollapsed])

  return (
    <PanelCollapseContext.Provider value={collapseControls}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {timeTravelSeq !== null && (
          <div style={{
            background: '#fffbe6', borderBottom: '1px solid #ffe58f',
            padding: '4px 10px', minHeight: 30, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <History size={14} />
              Time travel — seq {timeTravelSeq}
              {currentEvent && (
                <>
                  {' · '}
                  <code style={{ fontSize: 11 }}>{currentEvent.event.type}</code>
                  {' · '}
                  <span style={{ color: '#888' }}>{formatTime(currentEvent.timestamp)}</span>
                </>
              )}
            </span>
            <span style={{ marginLeft: 'auto', color: '#bbb', fontSize: 11 }}>← → to step · Esc for live</span>
            <button
              onClick={() => timeTravel(null)}
              style={{
                cursor: 'pointer',
                padding: '2px 10px', fontSize: 11, lineHeight: 1.4,
                background: '#fff', color: '#444',
                border: '1px solid #d9d9d9', borderRadius: 4,
              }}
            >
              Back to live
            </button>
          </div>
        )}

        <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0 }}>
          <Panel defaultSize={70} minSize={30}>
            <PanelGroup direction="horizontal" style={{ height: '100%' }}>
              <Panel
                ref={actorListRef}
                defaultSize={20}
                minSize={12}
                collapsible
                collapsedSize={0}
                onCollapse={() => setLeftCollapsed(true)}
                onExpand={() => setLeftCollapsed(false)}
                style={{ overflow: 'auto' }}
              >
                {!leftCollapsed && <ActorList />}
              </Panel>
              <PanelResizeHandle style={dividerStyle} />
              <Panel defaultSize={55} minSize={25} style={{ overflow: 'auto' }}>
                <MachineTree />
              </Panel>
              <PanelResizeHandle style={dividerStyle} />
              <Panel
                ref={sideRef}
                defaultSize={25}
                minSize={15}
                collapsible
                collapsedSize={0}
                onCollapse={() => setRightCollapsed(true)}
                onExpand={() => setRightCollapsed(false)}
                style={{ overflow: 'auto' }}
              >
                {!rightCollapsed && <SidePanel />}
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle style={hDividerStyle} />
          <Panel
            ref={logRef}
            defaultSize={30}
            minSize={10}
            collapsible
            collapsedSize={4}
            onCollapse={() => setBottomCollapsed(true)}
            onExpand={() => setBottomCollapsed(false)}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <EventLog collapsed={bottomCollapsed} onExpand={() => logRef.current?.expand()} />
          </Panel>
        </PanelGroup>
      </div>
    </PanelCollapseContext.Provider>
  )
}
