// Chrome-DevTools-style stacked accordion section.
import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from './Icons.js'

export interface AccordionSectionProps {
  title: React.ReactNode
  /** Inline action buttons rendered on the right of the header. */
  actions?: React.ReactNode
  /** Default expanded? Defaults to true. */
  defaultOpen?: boolean
  /** Controlled expanded state — if provided, ignores internal state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

export function AccordionSection({
  title, actions, defaultOpen = true, open, onOpenChange, children,
}: AccordionSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open ?? internalOpen
  const setOpen = (v: boolean) => {
    if (open === undefined) setInternalOpen(v)
    onOpenChange?.(v)
  }

  return (
    <div style={{ borderBottom: '1px solid #e8e8e8' }}>
      <div
        onClick={() => setOpen(!isOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px', background: '#f5f5f5',
          fontSize: 11, fontWeight: 600, color: '#444',
          cursor: 'pointer', userSelect: 'none',
          borderTop: '1px solid #e8e8e8',
        }}
      >
        <span style={{ display: 'inline-flex', color: '#888', width: 14 }}>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        {actions && (
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {actions}
          </span>
        )}
      </div>
      {isOpen && (
        <div style={{ padding: '8px 10px' }}>
          {children}
        </div>
      )}
    </div>
  )
}
