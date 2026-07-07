// packages/chrome-extension/src/panel/store.ts
// The inspector store definition lives in the shared @xstate-devtools/panel-core
// package (framework-agnostic). Here we bind it to React via zustand's `create`.
import { create } from 'zustand'
import { inspectorStoreInitializer, type InspectorStore } from '@xstate-devtools/panel-core'

export { getDisplaySnapshot, type InspectorStore, type PersistedEntry } from '@xstate-devtools/panel-core'

export const useStore = create<InspectorStore>(inspectorStoreInitializer)
