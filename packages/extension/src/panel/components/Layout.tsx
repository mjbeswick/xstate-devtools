// packages/extension/src/panel/components/Layout.tsx
import React, { useRef, useState, useMemo } from 'react'
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

export function Layout() {
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)

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
            </span>
            <button
              onClick={() => timeTravel(null)}
              style={{
                marginLeft: 'auto', cursor: 'pointer',
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
