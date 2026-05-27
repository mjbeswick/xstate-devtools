import { createAdapter } from '@xstate-devtools/adapter'

declare const __XSTATE_DEVTOOLS_SOURCE_ROOT__: string

const adapter = createAdapter({ webSourceRoot: __XSTATE_DEVTOOLS_SOURCE_ROOT__ })

export const { inspect } = adapter
