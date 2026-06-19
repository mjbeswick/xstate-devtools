// packages/chrome-extension/src/shared/types.ts
//
// The wire protocol now lives in the shared @xstate-devtools/protocol package so
// the adapter, this panel, and the vscode-extension debugger all consume one
// source of truth. This module re-exports it for the panel's existing imports.

export * from '@xstate-devtools/protocol'
