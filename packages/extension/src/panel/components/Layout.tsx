// packages/extension/src/panel/components/Layout.tsx
import React, { useRef, useState } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import type { ImperativePanelHandle } from 'react-resizable-panels'
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

const collapseBtnStyle: React.CSSProperties = {
  position: 'absolute', zIndex: 2,
  background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4,
  width: 18, height: 18, padding: 0, fontSize: 10, lineHeight: '16px',
  cursor: 'pointer', color: '#666', userSelect: 'none',
}

function CollapseToggle({
  collapsed, onClick, side,
}: {
  collapsed: boolean
  onClick: () => void
  /** Which edge of the surrounding container the button sits on. */
  side: 'left' | 'right' | 'top'
}) {
  const positional: React.CSSProperties =
    side === 'left' ? { top: 6, left: 6 }
    : side === 'right' ? { top: 6, right: 6 }
    : { left: 6, top: -22 }
  const arrow =
    side === 'left' ? (collapsed ? '▶' : '◀')
    : side === 'right' ? (collapsed ? '◀' : '▶')
    : (collapsed ? '▲' : '▼')
  return (
    <button
      onClick={onClick}
      style={{ ...collapseBtnStyle, ...positional }}
      title={collapsed ? 'Expand' : 'Collapse'}
    >
      {arrow}
    </button>
  )
}

export function Layout() {
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)

  const actorListRef = useRef<ImperativePanelHandle>(null)
  const sideRef = useRef<ImperativePanelHandle>(null)
  const logRef = useRef<ImperativePanelHandle>(null)

  const [actorListCollapsed, setActorListCollapsed] = useState(false)
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [logCollapsed, setLogCollapsed] = useState(false)

  const toggle = (
    ref: React.RefObject<ImperativePanelHandle>,
    collapsed: boolean,
  ) => {
    if (collapsed) ref.current?.expand()
    else ref.current?.collapse()
  }

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
            <Panel
              ref={actorListRef}
              defaultSize={20}
              minSize={12}
              collapsible
              collapsedSize={3}
              onCollapse={() => setActorListCollapsed(true)}
              onExpand={() => setActorListCollapsed(false)}
              style={{ overflow: 'auto', position: 'relative' }}
            >
              <CollapseToggle
                collapsed={actorListCollapsed}
                onClick={() => toggle(actorListRef, actorListCollapsed)}
                side="right"
              />
              {!actorListCollapsed && <ActorList />}
            </Panel>
            <PanelResizeHandle style={dividerStyle} />
            <Panel defaultSize={55} minSize={20} style={{ overflow: 'auto' }}>
              <MachineTree />
            </Panel>
            <PanelResizeHandle style={dividerStyle} />
            <Panel
              ref={sideRef}
              defaultSize={25}
              minSize={15}
              collapsible
              collapsedSize={3}
              onCollapse={() => setSideCollapsed(true)}
              onExpand={() => setSideCollapsed(false)}
              style={{ overflow: 'auto', position: 'relative' }}
            >
              <CollapseToggle
                collapsed={sideCollapsed}
                onClick={() => toggle(sideRef, sideCollapsed)}
                side="left"
              />
              {!sideCollapsed && <SidePanel />}
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle style={hDividerStyle} />
        <Panel
          ref={logRef}
          defaultSize={30}
          minSize={10}
          collapsible
          collapsedSize={3}
          onCollapse={() => setLogCollapsed(true)}
          onExpand={() => setLogCollapsed(false)}
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}
        >
          <CollapseToggle
            collapsed={logCollapsed}
            onClick={() => toggle(logRef, logCollapsed)}
            side="top"
          />
          {!logCollapsed && <EventLog />}
        </Panel>
      </PanelGroup>
    </div>
  )
}
