// Inline Material-style SVG icons. No font/CSP dependencies.
import React from 'react'

interface IconProps {
  size?: number
  color?: string
  style?: React.CSSProperties
}

function svgProps({ size = 16, color = 'currentColor', style }: IconProps) {
  return {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style, 'aria-hidden': true,
  }
}

export function ChevronDown(p: IconProps = {}) {
  return <svg {...svgProps(p)}><polyline points="6 9 12 15 18 9" /></svg>
}
export function ChevronRight(p: IconProps = {}) {
  return <svg {...svgProps(p)}><polyline points="9 6 15 12 9 18" /></svg>
}
export function ChevronLeft(p: IconProps = {}) {
  return <svg {...svgProps(p)}><polyline points="15 6 9 12 15 18" /></svg>
}
export function ChevronUp(p: IconProps = {}) {
  return <svg {...svgProps(p)}><polyline points="6 15 12 9 18 15" /></svg>
}

export function Close(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

export function History(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 9 8 9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  )
}

export function ExternalLink(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <path d="M14 4h6v6" />
      <line x1="20" y1="4" x2="11" y2="13" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

export function Settings(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}

export function PanelToggle({ side, collapsed, ...p }: IconProps & { side: 'left' | 'right' | 'bottom'; collapsed: boolean }) {
  if (side === 'bottom') {
    const flip = collapsed
    return (
      <svg {...svgProps(p)}>
        <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <polyline points={flip ? '9,12 12,10 15,12' : '9,10 12,12 15,10'} />
      </svg>
    )
  }
  const flip = (side === 'left') !== collapsed
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
      <line
        x1={side === 'left' ? '8' : '16'} x2={side === 'left' ? '8' : '16'}
        y1="4" y2="20"
      />
      <polyline points={flip ? '13,9 11,12 13,15' : '11,9 13,12 11,15'} />
    </svg>
  )
}
