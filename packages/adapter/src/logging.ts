type LogLevel = 'debug' | 'info' | 'warn'

declare global {
  var __XSTATE_DEVTOOLS_LOGGING__: boolean | undefined
}

function hasProcessEnv() {
  return typeof process !== 'undefined' && typeof process.env !== 'undefined'
}

export function isLoggingEnabled() {
  if (globalThis.__XSTATE_DEVTOOLS_LOGGING__ === true) return true
  if (!hasProcessEnv()) return false

  const value = process.env.XSTATE_DEVTOOLS_LOGGING
  return value === '1' || value === 'true'
}

function log(level: LogLevel, scope: string, message: string, details?: unknown) {
  if (!isLoggingEnabled()) return

  if (details === undefined) {
    console[level](`[xstate-devtools:${scope}] ${message}`)
    return
  }

  console[level](`[xstate-devtools:${scope}] ${message}`, details)
}

export function debugLog(scope: string, message: string, details?: unknown) {
  log('debug', scope, message, details)
}

export function infoLog(scope: string, message: string, details?: unknown) {
  log('info', scope, message, details)
}

export function warnLog(scope: string, message: string, details?: unknown) {
  log('warn', scope, message, details)
}