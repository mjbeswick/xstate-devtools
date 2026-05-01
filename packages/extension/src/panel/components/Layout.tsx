// packages/extension/src/panel/components/Layout.tsx
import React from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { ActorList } from './ActorList.js'
import { MachineTree } from './MachineTree.js'
import { SidePanel } from './SidePanel.js'
import { EventLog } from './EventLog.js'
import { useStore } from '../store.js'

const dividerStyle: React.CSSProperties = {
  width: 4, background: '#e0e0e0', cursor: 'col-resize', flexShrink: 0,
}
const hDividerStyle: React.CSSProperties = {
  height: 4, background: '#e0e0e0', cursor: 'row-resize', flexShrink: 0,
}

export function Layout() {
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)

  return (
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
            <Panel defaultSize={20} minSize={15} style={{ overflow: 'auto' }}>
              <ActorList />
            </Panel>
            <PanelResizeHandle style={dividerStyle} />
            <Panel defaultSize={55} minSize={20} style={{ overflow: 'auto' }}>
              <MachineTree />
            </Panel>
            <PanelResizeHandle style={dividerStyle} />
            <Panel defaultSize={25} minSize={15} style={{ overflow: 'auto' }}>
              <SidePanel />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle style={hDividerStyle} />
        <Panel defaultSize={30} minSize={10} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <EventLog />
        </Panel>
      </PanelGroup>
    </div>
  )
}
