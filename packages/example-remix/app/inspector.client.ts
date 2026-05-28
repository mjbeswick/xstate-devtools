import { createAdapter } from '@xstate-devtools/adapter'

declare const __XSTATE_DEVTOOLS_SOURCE_ROOT__: string | undefined

const adapter = createAdapter({
  webSourceRoot:
    typeof __XSTATE_DEVTOOLS_SOURCE_ROOT__ !== 'undefined'
      ? __XSTATE_DEVTOOLS_SOURCE_ROOT__
      : undefined,
})

export const { inspect } = adapter
