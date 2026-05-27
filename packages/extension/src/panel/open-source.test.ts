import { describe, expect, it } from 'vitest'
import { canOpenSourceLocation, getSourceHref } from './open-source.js'

describe('getSourceHref', () => {
  it('builds a vscode href for an absolute path stack frame', () => {
    expect(getSourceHref('createMachine (/Users/me/project/app/machine.ts:12:3)')).toBe(
      'vscode://file/Users/me/project/app/machine.ts:12:3',
    )
  })

  it('unwraps file urls from stack frames', () => {
    expect(getSourceHref('file:///Users/me/project/app/machine.ts:12:3')).toBe(
      'vscode://file/Users/me/project/app/machine.ts:12:3',
    )
  })

  it('maps vite /@fs/ urls back to filesystem paths', () => {
    expect(
      getSourceHref('http://localhost:5173/@fs/Users/me/project/app/machine.ts?t=123:12:3'),
    ).toBe('vscode://file/Users/me/project/app/machine.ts:12:3')
  })

  it('ignores plain browser urls that are not filesystem-backed', () => {
    expect(getSourceHref('http://localhost:5173/app/machines/auth.machine.ts:12:3')).toBeNull()
  })

  it('keeps a leading slash for root-relative paths', () => {
    expect(getSourceHref('/Users/me/project/app/machine.ts:12:3')).toBe(
      'vscode://file/Users/me/project/app/machine.ts:12:3',
    )
  })

  it('strips query/hash fragments from raw stack-like filesystem paths', () => {
    expect(getSourceHref('/Users/me/project/app/machine.ts?t=123#hmr:12:3')).toBe(
      'vscode://file/Users/me/project/app/machine.ts:12:3',
    )
  })

  it('ignores node internal stack frames', () => {
    expect(getSourceHref('node:events:508:28')).toBeNull()
  })

  it('ignores anonymous stack frames', () => {
    expect(getSourceHref('<anonymous>:1:1')).toBeNull()
    expect(getSourceHref('at <anonymous>:1:1')).toBeNull()
    expect(getSourceHref('/<anonymous>:1:1')).toBeNull()
    expect(getSourceHref('./<anonymous>:1:1')).toBeNull()
  })
})

describe('canOpenSourceLocation', () => {
  it('returns true for a filesystem-backed source location', () => {
    expect(canOpenSourceLocation('/Users/me/project/app/machine.ts:12:3')).toBe(true)
  })

  it('returns false for non-openable source locations', () => {
    expect(canOpenSourceLocation('WebSocket.emit (node:events:508:28)')).toBe(false)
    expect(canOpenSourceLocation('Map.forEach (<anonymous>)')).toBe(false)
    expect(canOpenSourceLocation(undefined)).toBe(false)
  })
})
