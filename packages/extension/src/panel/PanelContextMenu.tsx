import { useCallback, useEffect, useState } from 'react'

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

const MENU_WIDTH = 220
const MENU_GUTTER = 8

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

export function usePanelContextMenu() {
  const [menu, setMenu] = useState<PanelContextMenuState | null>(null)

  const closeMenu = useCallback(() => {
    setMenu(null)
  }, [])

  const openMenu = useCallback(
    (event: React.MouseEvent, items: PanelContextMenuItem[]) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items,
      })
    },
    [],
  )

  useEffect(() => {
    if (!menu) return undefined

    const handleDismiss = () => closeMenu()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('contextmenu', handleDismiss)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleDismiss, true)

    return () => {
      window.removeEventListener('contextmenu', handleDismiss)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleDismiss, true)
    }
  }, [closeMenu, menu])

  return { menu, openMenu, closeMenu }
}

function getMenuPosition(menu: PanelContextMenuState) {
  if (typeof window === 'undefined') {
    return { left: menu.x, top: menu.y }
  }

  const left = Math.min(menu.x, window.innerWidth - MENU_WIDTH - MENU_GUTTER)
  const top = Math.min(menu.y, window.innerHeight - MENU_GUTTER)

  return {
    left: Math.max(MENU_GUTTER, left),
    top: Math.max(MENU_GUTTER, top),
  }
}

export function PanelContextMenu({
  menu,
  onClose,
}: {
  menu: PanelContextMenuState | null
  onClose: () => void
}) {
  if (!menu) return null

  const position = getMenuPosition(menu)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
      }}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
        }}
      />
      <div
        role="menu"
        onContextMenu={(event) => event.preventDefault()}
        style={{
          position: 'absolute',
          left: position.left,
          top: position.top,
          minWidth: MENU_WIDTH,
          maxWidth: 280,
          padding: 4,
          background: '#fff',
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
          overflow: 'hidden',
        }}
      >
        {menu.items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              void Promise.resolve(item.onSelect()).finally(onClose)
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 10px',
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              textAlign: 'left',
              fontSize: 11,
              cursor: item.disabled ? 'default' : 'pointer',
              color: item.disabled ? '#bfbfbf' : '#262626',
            }}
            onMouseEnter={(event) => {
              if (!item.disabled) event.currentTarget.style.background = '#f5f5f5'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent'
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}