import { afterEach, describe, expect, it, vi } from 'vitest'
import { debugLog, infoLog, isLoggingEnabled, warnLog } from './logging.js'

describe('adapter logging', () => {
  afterEach(() => {
    delete globalThis.__XSTATE_DEVTOOLS_LOGGING__
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is disabled by default', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(isLoggingEnabled()).toBe(false)

    debugLog('web:adapter', 'debug message')
    infoLog('web:adapter', 'info message')
    warnLog('web:adapter', 'warn message')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('can be enabled explicitly', () => {
    vi.stubEnv('XSTATE_DEVTOOLS_LOGGING', 'true')
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    expect(isLoggingEnabled()).toBe(true)

    debugLog('web:adapter', 'debug message', { enabled: true })

    expect(debugSpy).toHaveBeenCalledWith('[xstate-devtools:web:adapter] debug message', {
      enabled: true,
    })
  })
})
