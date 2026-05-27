// packages/extension/src/panel/components/Layout.tsx
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { PanelCollapseContext } from '../panel-collapse-context.js'
import { useStore } from '../store.js'
import { ActorList } from './ActorList.js'
import { EventLog } from './EventLog.js'
import { History } from './Icons.js'
import { MachineTree } from './MachineTree.js'
import { SelectedEventPanel } from './SelectedEventPanel.js'
import { SidePanel } from './SidePanel.js'

const PANEL_COLLAPSE_LEFT_KEY = 'xstate-devtools.panel.leftCollapsed'
const PANEL_COLLAPSE_RIGHT_KEY = 'xstate-devtools.panel.rightCollapsed'
const PANEL_COLLAPSE_SELECTED_EVENT_KEY = 'xstate-devtools.panel.selectedEventCollapsed'
const PANEL_COLLAPSE_BOTTOM_KEY = 'xstate-devtools.panel.bottomCollapsed'

const DEFAULT_PANEL_COLLAPSE_STATE = {
  leftCollapsed: false,
  rightCollapsed: false,
  selectedEventCollapsed: false,
  bottomCollapsed: false,
}

export function getInitialPanelCollapseState(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): typeof DEFAULT_PANEL_COLLAPSE_STATE {
  try {
    return {
      leftCollapsed: storage?.getItem(PANEL_COLLAPSE_LEFT_KEY) === '1',
      rightCollapsed: storage?.getItem(PANEL_COLLAPSE_RIGHT_KEY) === '1',
      selectedEventCollapsed: storage?.getItem(PANEL_COLLAPSE_SELECTED_EVENT_KEY) === '1',
      bottomCollapsed: storage?.getItem(PANEL_COLLAPSE_BOTTOM_KEY) === '1',
    }
  } catch {
    return DEFAULT_PANEL_COLLAPSE_STATE
  }
}

function persistPanelCollapseState(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  state: typeof DEFAULT_PANEL_COLLAPSE_STATE,
) {
  try {
    storage?.setItem(PANEL_COLLAPSE_LEFT_KEY, state.leftCollapsed ? '1' : '0')
    storage?.setItem(PANEL_COLLAPSE_RIGHT_KEY, state.rightCollapsed ? '1' : '0')
    storage?.setItem(PANEL_COLLAPSE_SELECTED_EVENT_KEY, state.selectedEventCollapsed ? '1' : '0')
    storage?.setItem(PANEL_COLLAPSE_BOTTOM_KEY, state.bottomCollapsed ? '1' : '0')
  } catch {
    // Ignore storage failures so the panel still works in restricted environments.
  }
}

// Thin Chrome-DevTools-style dividers: 1px visible border with a wider
// invisible hit area for easier grabbing.
const dividerStyle: React.CSSProperties = {
  width: 1,
  background: '#d0d7de',
  cursor: 'col-resize',
  flexShrink: 0,
  outline: '2px solid transparent',
  outlineOffset: -1,
}
const hDividerStyle: React.CSSProperties = {
  height: 1,
  background: '#d0d7de',
  cursor: 'row-resize',
  flexShrink: 0,
  outline: '2px solid transparent',
  outlineOffset: -1,
}

export function Layout() {
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)

  const actorListRef = useRef<ImperativePanelHandle>(null)
  const sideRef = useRef<ImperativePanelHandle>(null)
  const selectedEventRef = useRef<ImperativePanelHandle>(null)
  const logRef = useRef<ImperativePanelHandle>(null)
  // Prevents onResize feedback loops when syncing the two right panels.
  const syncingRightRef = useRef(false)

  const initialCollapseState = useMemo(
    () => getInitialPanelCollapseState(typeof localStorage === 'undefined' ? null : localStorage),
    [],
  )

  const [leftCollapsed, setLeftCollapsed] = useState(initialCollapseState.leftCollapsed)
  const [rightCollapsed, setRightCollapsed] = useState(initialCollapseState.rightCollapsed)
  const [selectedEventCollapsed, setSelectedEventCollapsed] = useState(
    initialCollapseState.selectedEventCollapsed,
  )
  const [bottomCollapsed, setBottomCollapsed] = useState(initialCollapseState.bottomCollapsed)

  useEffect(() => {
    persistPanelCollapseState(typeof localStorage === 'undefined' ? null : localStorage, {
      leftCollapsed,
      rightCollapsed,
      selectedEventCollapsed,
      bottomCollapsed,
    })
  }, [leftCollapsed, rightCollapsed, selectedEventCollapsed, bottomCollapsed])

  const collapseControls = useMemo(
    () => ({
      leftCollapsed,
      rightCollapsed,
      selectedEventCollapsed,
      bottomCollapsed,
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
      toggleSelectedEvent: () => {
        const ref = selectedEventRef.current
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
    }),
    [leftCollapsed, rightCollapsed, selectedEventCollapsed, bottomCollapsed],
  )

  return (
    <PanelCollapseContext.Provider value={collapseControls}>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
      >
        {timeTravelSeq !== null && (
          <div
            style={{
              background: '#fffbe6',
              borderBottom: '1px solid #ffe58f',
              height: 32,
              padding: '0 8px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1 }}>
              <History size={14} />
              Time travel — seq {timeTravelSeq}
            </span>
            <button
              onClick={() => timeTravel(null)}
              style={{
                marginLeft: 'auto',
                cursor: 'pointer',
                padding: '3px 10px',
                fontSize: 11,
                fontFamily: 'inherit',
                background: '#fff',
                color: '#444',
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                verticalAlign: 'middle',
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
                onResize={(size) => {
                  if (size <= 0) return
                  if (syncingRightRef.current) return
                  syncingRightRef.current = true
                  selectedEventRef.current?.resize(size)
                  syncingRightRef.current = false
                }}
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
            {bottomCollapsed ? (
              <EventLog collapsed onExpand={() => logRef.current?.expand()} />
            ) : (
              <PanelGroup direction="horizontal" style={{ height: '100%' }}>
                <Panel defaultSize={70} minSize={30} style={{ overflow: 'hidden' }}>
                  <EventLog onExpand={() => logRef.current?.expand()} />
                </Panel>
                <PanelResizeHandle style={dividerStyle} />
                <Panel
                  ref={selectedEventRef}
                  defaultSize={25}
                  minSize={15}
                  collapsible
                  collapsedSize={0}
                  onCollapse={() => setSelectedEventCollapsed(true)}
                  onExpand={() => setSelectedEventCollapsed(false)}
                  onResize={(size) => {
                    if (size <= 0) return
                    if (syncingRightRef.current) return
                    syncingRightRef.current = true
                    sideRef.current?.resize(size)
                    syncingRightRef.current = false
                  }}
                  style={{ overflow: 'hidden' }}
                >
                  {!selectedEventCollapsed && <SelectedEventPanel />}
                </Panel>
              </PanelGroup>
            )}
          </Panel>
        </PanelGroup>
      </div>
    </PanelCollapseContext.Provider>
  )
}
