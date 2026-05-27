function normalizeFilePath(filePath: string): string | null {
  const trimmed = filePath.trim()
  if (!trimmed) return null

  const normalizedPlaceholder = trimmed.toLowerCase()
  const slashlessPlaceholder = normalizedPlaceholder.replace(/^[./\\]+/, '')
  if (
    slashlessPlaceholder === '<anonymous>' ||
    slashlessPlaceholder === 'anonymous' ||
    slashlessPlaceholder === '(anonymous)' ||
    slashlessPlaceholder === 'eval' ||
    slashlessPlaceholder === '<eval>' ||
    slashlessPlaceholder === '[native code]'
  ) {
    return null
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return trimmed.replace(/\\/g, '/')
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const pathname = decodeURIComponent(url.pathname)

      if (url.protocol === 'file:') {
        return pathname || null
      }

      if (pathname.startsWith('/@fs/')) {
        return pathname.slice('/@fs'.length)
      }

      // Non-file URLs without /@fs/ are browser paths, not local filesystem paths.
      return null
    } catch {
      return null
    }
  }

  // Ignore stack frames that point at protocol-like internals (e.g. node:events).
  // Only filesystem-like paths should produce VS Code file links.
  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed) &&
    !trimmed.startsWith('/') &&
    !trimmed.startsWith('./') &&
    !trimmed.startsWith('../')
  ) {
    return null
  }

  // Strip cache-busting query/hash fragments from stack-like paths.
  return trimmed.replace(/[?#].*$/, '')
}

function parseSourceLocation(sourceLocation: string) {
  const trimmed = sourceLocation.trim()
  const unwrapped = trimmed.match(/\((.*)\)$/)?.[1] ?? trimmed
  const normalizedFrame = unwrapped
    .replace(/^at\s+/, '')
    .replace(/^[^@\s]+@(?=[a-zA-Z][a-zA-Z\d+.-]*:\/\/)/, '')
  const match = normalizedFrame.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/)

  if (!match) return null

  const [, rawFilePath, line, column] = match
  const filePath = rawFilePath ? normalizeFilePath(rawFilePath) : null
  if (!filePath) return null

  return {
    filePath,
    line: line ? Number(line) : undefined,
    column: column ? Number(column) : undefined,
  }
}

export function getSourceHref(sourceLocation: string): string | null {
  const parsed = parseSourceLocation(sourceLocation)
  if (!parsed) return null

  const encodedPath = encodeURI(parsed.filePath)
  const pathPrefix = parsed.filePath.startsWith('/') ? '' : '/'
  const suffix = parsed.line ? `:${parsed.line}${parsed.column ? `:${parsed.column}` : ''}` : ''

  return `vscode://file${pathPrefix}${encodedPath}${suffix}`
}

export function canOpenSourceLocation(sourceLocation: string | undefined): boolean {
  if (!sourceLocation) return false
  return getSourceHref(sourceLocation) !== null
}

let _backgroundPort: chrome.runtime.Port | null = null

export function setBackgroundPort(port: chrome.runtime.Port): void {
  _backgroundPort = port
}

export function openSourceLocation(sourceLocation: string): boolean {
  if (!sourceLocation.trim()) {
    console.warn('[xstate-devtools] empty source location')
    return false
  }

  const href = getSourceHref(sourceLocation)
  if (!href) {
    console.warn('[xstate-devtools] could not parse source location', { sourceLocation })
    return false
  }

  try {
    chrome.runtime.sendMessage({
      type: 'XSTATE_OPEN_SOURCE',
      sourceLocation,
    })
    return true
  } catch {
    // Fall through to persistent port fallback.
  }

  try {
    _backgroundPort?.postMessage({
      type: 'XSTATE_OPEN_SOURCE',
      sourceLocation,
    })
    return true
  } catch {
    console.warn('[xstate-devtools] failed to send source-open message', { href, sourceLocation })
    return false
  }
}
