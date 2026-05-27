import React, { useCallback, useEffect, useState } from 'react'

export interface PanelContextMenuItem {
  label: string
  onSelect: () => void | Promise<void>
  disabled?: boolean
}

export interface PanelContextMenuState {
  x: number
  y: number
  items: PanelContextMenuItem[]
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to the legacy copy path below.
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

type Subscriber = (state: PanelContextMenuState | null) => void
const subscribers = new Set<Subscriber>()

function setMenuState(state: PanelContextMenuState | null) {
  for (const sub of subscribers) {
    sub(state)
  }
}

export function usePanelContextMenu() {
  const closeMenu = useCallback(() => {
    setMenuState(null)
  }, [])

  const openMenu = useCallback((event: React.MouseEvent, items: PanelContextMenuItem[]) => {
    event.preventDefault()
    event.stopPropagation()

    // Calculate position so it doesn't run off screen
    let x = event.clientX
    let y = event.clientY

    setMenuState({ x, y, items })
  }, [])

  return {
    openMenu,
    closeMenu,
  }
}

export function shouldCloseMenuOnScrollEvent(event: Event): boolean {
  // Ignore programmatic scroll updates (for example event log auto-scroll).
  return event.isTrusted
}

export function PanelContextMenu() {
  const [menu, setMenu] = useState<PanelContextMenuState | null>(null)

  useEffect(() => {
    subscribers.add(setMenu)
    return () => {
      subscribers.delete(setMenu)
    }
  }, [])

  useEffect(() => {
    if (!menu) return

    const handleWindowClick = () => setMenuState(null)
    const handleWindowScroll = (event: Event) => {
      if (shouldCloseMenuOnScrollEvent(event)) {
        setMenuState(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuState(null)
    }

    window.addEventListener('click', handleWindowClick)
    window.addEventListener('scroll', handleWindowScroll, { capture: true })
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('click', handleWindowClick)
      window.removeEventListener('scroll', handleWindowScroll, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menu])

  const menuRef = React.useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x: menu?.x ?? 0, y: menu?.y ?? 0 })

  useEffect(() => {
    if (menuRef.current && menu) {
      const rect = menuRef.current.getBoundingClientRect()
      let newX = menu.x
      let newY = menu.y

      if (newX + rect.width > window.innerWidth) {
        newX = window.innerWidth - rect.width - 4
      }
      if (newY + rect.height > window.innerHeight) {
        newY = window.innerHeight - rect.height - 4
      }

      setAdjustedPos({ x: newX, y: newY })
    }
  }, [menu?.x, menu?.y, menu])

  if (!menu) return null

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: adjustedPos.y,
        left: adjustedPos.x,
        background: '#fff',
        border: '1px solid #d9d9d9',
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        padding: '4px 0',
        zIndex: 9999,
        minWidth: 160,
        fontFamily: 'sans-serif',
        fontSize: 12,
        color: '#333',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, index) => (
        <div
          key={index}
          onClick={(e) => {
            e.stopPropagation()
            if (item.disabled) return
            void Promise.resolve(item.onSelect())
            setMenuState(null)
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = '#f5f5f5'
          }}
          onMouseLeave={(e) => {
            if (!item.disabled) e.currentTarget.style.background = 'transparent'
          }}
          style={{
            padding: '5px 12px',
            cursor: item.disabled ? 'default' : 'pointer',
            color: item.disabled ? '#aaa' : 'inherit',
            background: 'transparent',
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  )
}
