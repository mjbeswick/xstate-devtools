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

const dividerStyle: React.CSSProperties = {
  width: 4, background: '#e0e0e0', cursor: 'col-resize', flexShrink: 0,
}
const hDividerStyle: React.CSSProperties = {
  height: 4, background: '#e0e0e0', cursor: 'row-resize', flexShrink: 0,
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
            padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12,
          }}>
            <span>⏮ Time travel — seq {timeTravelSeq}</span>
            <button onClick={() => timeTravel(null)} style={{ marginLeft: 'auto', cursor: 'pointer' }}>
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
            collapsedSize={0}
            onCollapse={() => setBottomCollapsed(true)}
            onExpand={() => setBottomCollapsed(false)}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {!bottomCollapsed && <EventLog />}
          </Panel>
        </PanelGroup>
      </div>
    </PanelCollapseContext.Provider>
  )
}
