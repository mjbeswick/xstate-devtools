import { createServerAdapter } from '@xstate-devtools/adapter/server'

const KEY = '__xstate_devtools_inspect__'
const cached = (globalThis as Record<string, unknown>)[KEY] as
  | { inspect: (e: unknown) => void }
  | undefined

const adapter = cached ?? createServerAdapter()
;(globalThis as Record<string, unknown>)[KEY] = adapter

export const inspect = adapter.inspect
