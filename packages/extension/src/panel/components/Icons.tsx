// Inline Material-style SVG icons. No font/CSP dependencies.
import type React from 'react'

interface IconProps {
  size?: number
  color?: string
  style?: React.CSSProperties
}

function svgProps({ size = 16, color = 'currentColor', style }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
    'aria-hidden': true,
  }
}

export function ChevronDown(p: IconProps = {}) {
  const { size = 16, color = 'currentColor', style } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      aria-hidden="true"
    >
      <polygon points="6,9 18,9 12,16" fill={color} />
    </svg>
  )
}
export function ChevronRight(p: IconProps = {}) {
  const { size = 16, color = 'currentColor', style } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      aria-hidden="true"
    >
      <polygon points="9,6 16,12 9,18" fill={color} />
    </svg>
  )
}
export function ChevronLeft(p: IconProps = {}) {
  const { size = 16, color = 'currentColor', style } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      aria-hidden="true"
    >
      <polygon points="15,6 8,12 15,18" fill={color} />
    </svg>
  )
}
export function ChevronUp(p: IconProps = {}) {
  const { size = 16, color = 'currentColor', style } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      aria-hidden="true"
    >
      <polygon points="6,15 18,15 12,8" fill={color} />
    </svg>
  )
}

export function DisclosureTriangle({
  expanded = false,
  size = 11,
  color = 'currentColor',
  style,
}: IconProps & { expanded?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{
        display: 'block',
        transform: expanded ? 'rotate(90deg)' : 'none',
        transformOrigin: 'center',
        ...style,
      }}
    >
      <polygon points="3,2 9,6 3,10" fill={color} />
    </svg>
  )
}

export function Close(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

export function Trash(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="9 6 9 4 15 4 15 6" />
      <rect x="7" y="6" width="10" height="14" rx="1.5" ry="1.5" />
      <line x1="10" y1="9" x2="10" y2="17" />
      <line x1="14" y1="9" x2="14" y2="17" />
      <line x1="5" y1="6" x2="19" y2="6" />
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

export function EventLog(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <rect x="4" y="5" width="16" height="14" rx="2" ry="2" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="15" x2="13" y2="15" />
      <circle cx="6.5" cy="9" r="0.7" fill={p.color ?? 'currentColor'} stroke="none" />
      <circle cx="6.5" cy="12" r="0.7" fill={p.color ?? 'currentColor'} stroke="none" />
      <circle cx="6.5" cy="15" r="0.7" fill={p.color ?? 'currentColor'} stroke="none" />
    </svg>
  )
}

export function ClearLog(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export function AtomicState(p: IconProps = {}) {
  const { size = 16, color = 'currentColor', style } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" fill={color} />
    </svg>
  )
}

export function CompoundState(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <rect x="5" y="5" width="14" height="14" rx="2" ry="2" />
      <path d="M9 5v14" />
      <path d="M5 9h14" />
    </svg>
  )
}

export function ParallelState(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <rect x="4" y="5" width="16" height="14" rx="2" ry="2" />
      <path d="M12 5v14" />
      <path d="M4 12h16" />
    </svg>
  )
}

export function FinalState(p: IconProps = {}) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
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

export function PanelToggle({
  side,
  collapsed,
  ...p
}: IconProps & { side: 'left' | 'right' | 'bottom'; collapsed: boolean }) {
  const indicatorColor = p.color ?? 'currentColor'
  if (side === 'bottom') {
    const flip = collapsed
    return (
      <svg {...svgProps(p)}>
        <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <polygon
          points={flip ? '9,11 12,8 15,11' : '9,13 12,16 15,13'}
          fill={indicatorColor}
          stroke="none"
        />
      </svg>
    )
  }
  const flip = (side === 'left') !== collapsed
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
      <line x1={side === 'left' ? '8' : '16'} x2={side === 'left' ? '8' : '16'} y1="4" y2="20" />
      <polygon
        points={flip ? '14,9 10,12 14,15' : '10,9 14,12 10,15'}
        fill={indicatorColor}
        stroke="none"
      />
    </svg>
  )
}
