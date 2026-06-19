// packages/panel-core/src/index.ts
//
// Framework-agnostic debug-panel core shared by the chrome-extension panel and
// the vscode-extension debugger: the inspector store, active-node computation,
// and session serialization. No React, no chrome, no vscode imports here.

export {
  MAX_EVENTS,
  getDisplaySnapshot,
  inspectorStoreInitializer,
  createInspectorStore,
  type InspectorStore,
  type PersistedEntry,
} from './store.js'

export { getActivePaths, getActiveNodeIds } from './active-nodes.js'

export { exportSession, importSession } from './session-io.js'
