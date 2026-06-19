import { createAdapter } from '@xstate-devtools/adapter'

// Single browser adapter shared by every machine on the page. Components can
// either pass `inspect` to `useMachine`, or go through `InspectorProvider` +
// the inspected hooks — both use this same instance.
export const adapter = createAdapter()
export const inspect = adapter.inspect
