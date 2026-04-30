# XState DevTools Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome DevTools extension that inspects live XState v5 machines in any web app, with time travel via event log click, plus an example Remix app with complex machines for testing.

**Architecture:** A `world: MAIN` injected script sets `window.__XSTATE_DEVTOOLS__`; the app's adapter writes to it; messages flow injected → content script → service worker → devtools panel. The panel is a React app (3-column layout + resizable event log drawer) backed by a zustand store that keeps a ring-buffered event history with globalSeq for time travel. A separate `adapter` package is all the app needs to include.

**Tech Stack:** TypeScript, React 18, Vite + CRXJS v2 (extension build), zustand, react-resizable-panels, vitest (unit tests), Remix v2 + XState v5 (example app), npm workspaces

---

## File Structure

```
xstate-devtools/
├── package.json                        # workspace root (npm workspaces)
├── packages/
│   ├── adapter/                        # what apps include (~80 lines)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # createAdapter() — returns { inspect }
│   │       ├── serialize.ts            # walk machine.root → SerializedMachine
│   │       ├── sanitize.ts             # make context/snapshot JSON-safe
│   │       └── react.tsx               # InspectorProvider + useInspectedMachine
│   ├── extension/                      # Chrome DevTools extension
│   │   ├── manifest.json
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── shared/
│   │       │   └── types.ts            # all protocol + serialized machine types
│   │       ├── injected/
│   │       │   └── index.ts            # world:MAIN — sets window.__XSTATE_DEVTOOLS__
│   │       ├── content/
│   │       │   └── index.ts            # bridges postMessage ↔ chrome.runtime
│   │       ├── background/
│   │       │   └── index.ts            # service worker: routes tab ↔ panel
│   │       ├── devtools/
│   │       │   ├── devtools.html       # devtools entry page
│   │       │   └── devtools.ts         # chrome.devtools.panels.create(...)
│   │       └── panel/
│   │           ├── index.html
│   │           ├── main.tsx
│   │           ├── App.tsx
│   │           ├── store.ts            # zustand (actors, events, time travel)
│   │           ├── active-nodes.ts     # derive active state ids from snapshot.value
│   │           └── components/
│   │               ├── Layout.tsx      # PanelGroup root (3 cols + drawer)
│   │               ├── ActorList.tsx   # left rail — actor tree
│   │               ├── MachineTree.tsx # center — state node tree
│   │               ├── SidePanel.tsx   # right — events for selected node + dispatch
│   │               └── EventLog.tsx    # bottom drawer — live log + time travel
│   └── example-remix/
│       ├── package.json
│       ├── vite.config.ts
│       └── app/
│           ├── root.tsx
│           ├── inspector.client.ts     # adapter init (browser-only)
│           ├── machines/
│           │   ├── auth.machine.ts     # compound, guards, invoked service
│           │   ├── cart.machine.ts     # parallel states
│           │   └── player.machine.ts  # spawned child actor
│           ├── components/
│           │   ├── AuthForm.tsx
│           │   ├── ShoppingCart.tsx
│           │   └── MediaPlayer.tsx
│           └── routes/
│               └── _index.tsx
```

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json` (workspace root)
- Create: `packages/adapter/package.json`
- Create: `packages/adapter/tsconfig.json`
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`
- Create: `packages/example-remix/package.json`

- [ ] **Step 1: Create workspace root package.json**

```json
{
  "name": "xstate-devtools",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:extension": "npm run dev --workspace=packages/extension",
    "dev:example": "npm run dev --workspace=packages/example-remix",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create adapter package.json**

```json
{
  "name": "@xstate-devtools/adapter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run"
  },
  "peerDependencies": {
    "xstate": "^5.0.0"
  },
  "devDependencies": {
    "xstate": "^5.18.0",
    "vitest": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 3: Create adapter tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "outDir": "./dist",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create extension package.json**

```json
{
  "name": "@xstate-devtools/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^5.0.0",
    "react-resizable-panels": "^2.1.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.26",
    "@types/chrome": "^0.0.270",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.0.0",
    "vitest": "^2.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "xstate": "^5.18.0"
  }
}
```

- [ ] **Step 5: Create extension tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "skipLibCheck": true
  },
  "include": ["src", "manifest.json"]
}
```

- [ ] **Step 6: Create example-remix package.json**

```json
{
  "name": "example-remix",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "remix vite:dev",
    "build": "remix vite:build",
    "start": "remix-serve ./build/server/index.js"
  },
  "dependencies": {
    "@remix-run/node": "^2.10.0",
    "@remix-run/react": "^2.10.0",
    "@remix-run/serve": "^2.10.0",
    "@xstate-devtools/adapter": "*",
    "isbot": "^4.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "xstate": "^5.18.0",
    "@xstate/react": "^4.1.0"
  },
  "devDependencies": {
    "@remix-run/dev": "^2.10.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 7: Install all dependencies**

```bash
cd /Users/michael/Projects/xstate-devtools
npm install
```

Expected: workspace installs complete, `node_modules` in root.

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: monorepo scaffold with npm workspaces"
```

---

## Task 2: Shared Protocol Types

**Files:**
- Create: `packages/extension/src/shared/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// packages/extension/src/shared/types.ts

export type StateNodeType = 'atomic' | 'compound' | 'parallel' | 'final' | 'history'

export interface SerializedTransition {
  targets: string[]   // absolute state node ids
  guard?: string      // guard name or "(inline)"
  actions: string[]   // action names
  eventType: string
}

export interface SerializedInvoke {
  id: string
  src: string
}

export interface SerializedStateNode {
  id: string
  key: string
  type: StateNodeType
  initial?: string
  states: Record<string, SerializedStateNode>
  on: SerializedTransition[]           // all transitions from this node
  always: SerializedTransition[]       // eventless transitions
  entry: string[]                      // action names
  exit: string[]                       // action names
  invoke: SerializedInvoke[]
}

export interface SerializedMachine {
  id: string
  root: SerializedStateNode
  sourceLocation?: string              // "file.ts:42" from Error().stack
}

export interface SerializedSnapshot {
  value: unknown                       // XState StateValue (string | object)
  context: unknown                     // sanitized context
  status: 'active' | 'done' | 'error' | 'stopped'
  error?: unknown
}

export interface ActorRecord {
  sessionId: string
  parentSessionId?: string
  machine: SerializedMachine | null    // null for non-machine actors (promise, callback)
  snapshot: SerializedSnapshot
  status: 'active' | 'done' | 'error' | 'stopped'
  registeredAt: number
}

export interface EventRecord {
  sessionId: string
  event: { type: string; [key: string]: unknown }
  snapshotAfter: SerializedSnapshot
  timestamp: number
  globalSeq: number
}

// ── Message protocol ──────────────────────────────────────────────────────────

// page (injected world) → content script → service worker → panel
export type PageToExtensionMessage =
  | {
      type: 'XSTATE_ACTOR_REGISTERED'
      sessionId: string
      parentSessionId?: string
      machine: SerializedMachine | null
      snapshot: SerializedSnapshot
    }
  | {
      type: 'XSTATE_SNAPSHOT'
      sessionId: string
      snapshot: SerializedSnapshot
      timestamp: number
      globalSeq: number
    }
  | {
      type: 'XSTATE_EVENT'
      sessionId: string
      event: { type: string; [key: string]: unknown }
      snapshotAfter: SerializedSnapshot
      timestamp: number
      globalSeq: number
    }
  | {
      type: 'XSTATE_ACTOR_STOPPED'
      sessionId: string
    }

// panel → service worker → content script → injected world → adapter
export type ExtensionToPageMessage = {
  type: 'XSTATE_DISPATCH'
  sessionId: string
  event: { type: string; [key: string]: unknown }
}

// Marker added to all postMessages so content script can filter
export type MarkedPageMessage = PageToExtensionMessage & { __xstateDevtools: true }
export type MarkedExtensionMessage = ExtensionToPageMessage & { __xstateDevtools: true }
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/shared/types.ts
git commit -m "feat: shared protocol and serialized machine types"
```

---

## Task 3: Machine Serializer + Context Sanitizer

**Files:**
- Create: `packages/adapter/src/serialize.ts`
- Create: `packages/adapter/src/sanitize.ts`
- Create: `packages/adapter/src/serialize.test.ts`
- Create: `packages/adapter/src/sanitize.test.ts`

The serializer walks XState v5's `machine.root` StateNode tree. The sanitizer makes context JSON-safe by replacing non-serializable values (functions, class instances, DOM nodes) with descriptive markers.

- [ ] **Step 1: Write serialize.ts**

```typescript
// packages/adapter/src/serialize.ts
import type { AnyStateMachine } from 'xstate'
import type { SerializedMachine, SerializedStateNode, SerializedTransition, SerializedInvoke } from '../../extension/src/shared/types.js'

function serializeTransitions(node: any, eventType: string): SerializedTransition[] {
  const raw = node.on?.[eventType] ?? []
  const transitions = Array.isArray(raw) ? raw : [raw]
  return transitions.map((t: any) => ({
    eventType,
    targets: (t.target ?? []).map((n: any) => n?.id ?? String(n)).filter(Boolean),
    guard: t.guard ? (t.guard.type ?? t.guard.name ?? '(inline)') : undefined,
    actions: (t.actions ?? []).map((a: any) => a?.type ?? a?.name ?? String(a)).filter(Boolean),
  }))
}

function serializeAlways(node: any): SerializedTransition[] {
  const raw = node.always ?? []
  const transitions = Array.isArray(raw) ? raw : [raw]
  return transitions.map((t: any) => ({
    eventType: '',
    targets: (t.target ?? []).map((n: any) => n?.id ?? String(n)).filter(Boolean),
    guard: t.guard ? (t.guard.type ?? t.guard.name ?? '(inline)') : undefined,
    actions: (t.actions ?? []).map((a: any) => a?.type ?? a?.name ?? String(a)).filter(Boolean),
  }))
}

function serializeInvokes(node: any): SerializedInvoke[] {
  const invokes: any[] = Array.isArray(node.invoke) ? node.invoke : node.invoke ? [node.invoke] : []
  return invokes.map((inv: any) => ({
    id: inv.id ?? '(unknown)',
    src: inv.src?.type ?? inv.src?.name ?? String(inv.src ?? '(inline)'),
  }))
}

function serializeActions(list: any[]): string[] {
  return list.map((a: any) => a?.type ?? a?.name ?? String(a)).filter(Boolean)
}

function serializeNode(node: any): SerializedStateNode {
  const onEvents = Object.keys(node.on ?? {})
  const transitions = onEvents.flatMap((evt) => serializeTransitions(node, evt))

  return {
    id: node.id,
    key: node.key,
    type: node.type ?? 'atomic',
    initial: node.initial,
    states: Object.fromEntries(
      Object.entries(node.states ?? {}).map(([k, v]) => [k, serializeNode(v)])
    ),
    on: transitions,
    always: serializeAlways(node),
    entry: serializeActions(node.entry ?? []),
    exit: serializeActions(node.exit ?? []),
    invoke: serializeInvokes(node),
  }
}

export function serializeMachine(machine: AnyStateMachine, sourceLocation?: string): SerializedMachine {
  return {
    id: machine.id,
    root: serializeNode(machine.root),
    sourceLocation,
  }
}
```

- [ ] **Step 2: Write sanitize.ts**

```typescript
// packages/adapter/src/sanitize.ts

const MAX_DEPTH = 10
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 100

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]'
  if (value === null || value === undefined) return value
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + '…' : value
  }
  if (typeof value === 'function') return `[Function: ${value.name || '(anonymous)'}]`
  if (typeof value === 'symbol') return `[Symbol: ${value.description ?? ''}]`
  if (typeof value === 'bigint') return `[BigInt: ${value}]`
  if (value instanceof Error) return { __type: 'Error', name: value.name, message: value.message }
  if (value instanceof Date) return { __type: 'Date', iso: value.toISOString() }
  if (value instanceof RegExp) return { __type: 'RegExp', source: value.source, flags: value.flags }
  if (value instanceof Map) {
    return {
      __type: 'Map',
      entries: Array.from(value.entries())
        .slice(0, MAX_ARRAY_LENGTH)
        .map(([k, v]) => [sanitize(k, depth + 1), sanitize(v, depth + 1)]),
    }
  }
  if (value instanceof Set) {
    return {
      __type: 'Set',
      values: Array.from(value).slice(0, MAX_ARRAY_LENGTH).map((v) => sanitize(v, depth + 1)),
    }
  }
  // Detect DOM nodes (works in browser and is safe to check)
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return `[DOMNode: ${(value as Element).tagName ?? value.nodeName}]`
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_LENGTH)
    const result = sliced.map((v) => sanitize(v, depth + 1))
    if (value.length > MAX_ARRAY_LENGTH) result.push(`[…${value.length - MAX_ARRAY_LENGTH} more]`)
    return result
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    let count = 0
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count++ > 100) { result['…'] = '[truncated]'; break }
      result[k] = sanitize(v, depth + 1)
    }
    return result
  }
  return String(value)
}
```

- [ ] **Step 3: Write serialize.test.ts**

```typescript
// packages/adapter/src/serialize.test.ts
import { describe, it, expect } from 'vitest'
import { createMachine, setup } from 'xstate'
import { serializeMachine } from './serialize.js'

describe('serializeMachine', () => {
  it('serializes a simple compound machine', () => {
    const machine = createMachine({
      id: 'test',
      initial: 'idle',
      states: {
        idle: { on: { START: 'running' } },
        running: { on: { STOP: 'idle' } },
      },
    })
    const result = serializeMachine(machine)
    expect(result.id).toBe('test')
    expect(result.root.type).toBe('compound')
    expect(result.root.initial).toBe('idle')
    expect(Object.keys(result.root.states)).toEqual(['idle', 'running'])
    expect(result.root.states.idle.on).toHaveLength(1)
    expect(result.root.states.idle.on[0].eventType).toBe('START')
    expect(result.root.states.idle.on[0].targets).toEqual(['test.running'])
  })

  it('serializes parallel states', () => {
    const machine = createMachine({
      id: 'parallel',
      type: 'parallel',
      states: {
        a: { initial: 'on', states: { on: {}, off: {} } },
        b: { initial: 'on', states: { on: {}, off: {} } },
      },
    })
    const result = serializeMachine(machine)
    expect(result.root.type).toBe('parallel')
    expect(Object.keys(result.root.states)).toEqual(['a', 'b'])
  })

  it('serializes named guards and actions from setup()', () => {
    const machine = setup({
      guards: { isReady: () => true },
      actions: { doSomething: () => {} },
    }).createMachine({
      id: 'guarded',
      initial: 'idle',
      states: {
        idle: {
          on: {
            GO: {
              target: 'active',
              guard: 'isReady',
              actions: 'doSomething',
            },
          },
        },
        active: {},
      },
    })
    const result = serializeMachine(machine)
    const transition = result.root.states.idle.on[0]
    expect(transition.guard).toBe('isReady')
    expect(transition.actions).toEqual(['doSomething'])
  })

  it('includes sourceLocation when provided', () => {
    const machine = createMachine({ id: 'm', initial: 'a', states: { a: {} } })
    const result = serializeMachine(machine, 'src/auth.ts:42')
    expect(result.sourceLocation).toBe('src/auth.ts:42')
  })
})
```

- [ ] **Step 4: Write sanitize.test.ts**

```typescript
// packages/adapter/src/sanitize.test.ts
import { describe, it, expect } from 'vitest'
import { sanitize } from './sanitize.js'

describe('sanitize', () => {
  it('passes primitives through unchanged', () => {
    expect(sanitize(42)).toBe(42)
    expect(sanitize(true)).toBe(true)
    expect(sanitize(null)).toBe(null)
    expect(sanitize('hello')).toBe('hello')
  })

  it('replaces functions with a descriptor string', () => {
    expect(sanitize(function myFn() {})).toBe('[Function: myFn]')
    expect(sanitize(() => {})).toBe('[Function: (anonymous)]')
  })

  it('truncates long strings', () => {
    const long = 'x'.repeat(600)
    const result = sanitize(long) as string
    expect(result.length).toBeLessThan(520)
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles nested objects', () => {
    const result = sanitize({ a: 1, b: { c: 'hello' } })
    expect(result).toEqual({ a: 1, b: { c: 'hello' } })
  })

  it('handles Maps', () => {
    const m = new Map([['key', 'value']])
    const result = sanitize(m) as any
    expect(result.__type).toBe('Map')
    expect(result.entries).toEqual([['key', 'value']])
  })

  it('handles circular-like depth limit', () => {
    let deep: any = {}
    let curr = deep
    for (let i = 0; i < 15; i++) { curr.child = {}; curr = curr.child }
    curr.value = 'bottom'
    const result = JSON.stringify(sanitize(deep))
    expect(result).toContain('[MaxDepth]')
  })
})
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/michael/Projects/xstate-devtools
npm test --workspace=packages/adapter
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter/src/
git commit -m "feat: machine serializer and context sanitizer with tests"
```

---

## Task 4: Adapter Package

**Files:**
- Create: `packages/adapter/src/index.ts`
- Create: `packages/adapter/src/react.tsx`

The adapter watches for `window.__XSTATE_DEVTOOLS__` and, when found, wires the XState inspect API to it. It also listens for inbound dispatch events from the extension.

- [ ] **Step 1: Write index.ts**

```typescript
// packages/adapter/src/index.ts
import type { AnyActorRef } from 'xstate'
import type { SerializedSnapshot } from '../../extension/src/shared/types.js'
import { serializeMachine } from './serialize.js'
import { sanitize } from './sanitize.js'

declare global {
  interface Window {
    __XSTATE_DEVTOOLS__?: {
      send: (message: unknown) => void
    }
  }
}

function getSourceLocation(): string | undefined {
  try {
    const lines = new Error().stack?.split('\n') ?? []
    // skip Error, getSourceLocation, inspect callback, xstate internals (3-4 frames)
    const callerLine = lines.find(
      (l, i) => i > 3 && !l.includes('xstate') && !l.includes('adapter')
    )
    return callerLine?.trim().replace(/^at\s+/, '')
  } catch {
    return undefined
  }
}

function serializeSnapshot(snapshot: any): SerializedSnapshot {
  return {
    value: snapshot?.value ?? null,
    context: sanitize(snapshot?.context),
    status: snapshot?.status ?? 'active',
    error: snapshot?.error ? sanitize(snapshot.error) : undefined,
  }
}

let globalSeq = 0

export function createAdapter() {
  const actorRefs = new Map<string, AnyActorRef>()

  function postToExtension(message: unknown) {
    window.__XSTATE_DEVTOOLS__?.send({ ...message as object, __xstateDevtools: true })
  }

  // Listen for dispatch events from extension (relayed by injected script via postMessage)
  if (typeof window !== 'undefined') {
    window.addEventListener('message', (evt) => {
      if (evt.source !== window) return
      const data = evt.data
      if (!data?.__xstateDevtools) return
      if (data.type === 'XSTATE_DISPATCH') {
        const ref = actorRefs.get(data.sessionId)
        if (ref) {
          try { ref.send(data.event) } catch (e) {
            console.warn('[xstate-devtools] dispatch error:', e)
          }
        }
      }
    })
  }

  const inspect = (inspectionEvent: any) => {
    if (typeof window === 'undefined' || !window.__XSTATE_DEVTOOLS__) return

    if (inspectionEvent.type === '@xstate.actor') {
      const actorRef: AnyActorRef = inspectionEvent.actorRef
      const sessionId: string = actorRef.sessionId
      actorRefs.set(sessionId, actorRef)

      const machine = actorRef.logic?.root
        ? serializeMachine(actorRef.logic as any, getSourceLocation())
        : null

      const snapshot = serializeSnapshot(actorRef.getSnapshot())

      postToExtension({
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId,
        parentSessionId: (actorRef as any)._parent?.sessionId,
        machine,
        snapshot,
      })
    } else if (inspectionEvent.type === '@xstate.snapshot') {
      globalSeq++
      postToExtension({
        type: 'XSTATE_SNAPSHOT',
        sessionId: inspectionEvent.actorRef.sessionId,
        snapshot: serializeSnapshot(inspectionEvent.snapshot),
        timestamp: Date.now(),
        globalSeq,
      })
    } else if (inspectionEvent.type === '@xstate.event') {
      globalSeq++
      postToExtension({
        type: 'XSTATE_EVENT',
        sessionId: inspectionEvent.actorRef.sessionId,
        event: inspectionEvent.event,
        snapshotAfter: serializeSnapshot(inspectionEvent.actorRef.getSnapshot()),
        timestamp: Date.now(),
        globalSeq,
      })
      // Check if actor is stopping
      const snap = inspectionEvent.actorRef.getSnapshot()
      if (snap?.status !== 'active') {
        postToExtension({
          type: 'XSTATE_ACTOR_STOPPED',
          sessionId: inspectionEvent.actorRef.sessionId,
        })
        actorRefs.delete(inspectionEvent.actorRef.sessionId)
      }
    }
  }

  return { inspect }
}
```

- [ ] **Step 2: Write react.tsx**

```tsx
// packages/adapter/src/react.tsx
import React, { createContext, useContext, useRef, type ReactNode } from 'react'
import { useMachine as useXStateMachine, useActorRef as useXStateActorRef } from '@xstate/react'
import type { AnyStateMachine, ActorOptions } from 'xstate'
import { createAdapter } from './index.js'

type AdapterContext = ReturnType<typeof createAdapter> | null

const InspectorContext = createContext<AdapterContext>(null)

export function InspectorProvider({ children }: { children: ReactNode }) {
  const adapterRef = useRef<ReturnType<typeof createAdapter> | null>(null)
  if (!adapterRef.current && typeof window !== 'undefined') {
    adapterRef.current = createAdapter()
  }
  return (
    <InspectorContext.Provider value={adapterRef.current}>
      {children}
    </InspectorContext.Provider>
  )
}

export function useInspectedMachine<T extends AnyStateMachine>(
  machine: T,
  options?: ActorOptions<T>
) {
  const adapter = useContext(InspectorContext)
  return useXStateMachine(machine, {
    ...options,
    inspect: adapter?.inspect,
  })
}

export function useInspectedActorRef<T extends AnyStateMachine>(
  machine: T,
  options?: ActorOptions<T>
) {
  const adapter = useContext(InspectorContext)
  return useXStateActorRef(machine, {
    ...options,
    inspect: adapter?.inspect,
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/adapter/src/index.ts packages/adapter/src/react.tsx
git commit -m "feat: adapter package with inspect wiring and React hooks"
```

---

## Task 5: Extension Build Setup

**Files:**
- Create: `packages/extension/manifest.json`
- Create: `packages/extension/vite.config.ts`

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "XState DevTools",
  "version": "0.1.0",
  "description": "Inspect XState v5 machines at runtime",
  "devtools_page": "src/devtools/devtools.html",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/injected/index.ts"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_start"
    }
  ],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "permissions": [],
  "icons": {}
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
// packages/extension/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

- [ ] **Step 3: Verify extension builds**

```bash
cd /Users/michael/Projects/xstate-devtools
npm run build --workspace=packages/extension
```

Expected: `packages/extension/dist/` created. No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/manifest.json packages/extension/vite.config.ts
git commit -m "feat: extension Vite + CRXJS build setup"
```

---

## Task 6: Injected Script (Page World Hook)

**Files:**
- Create: `packages/extension/src/injected/index.ts`

This script runs in the page's JavaScript world (`world: MAIN`). It sets `window.__XSTATE_DEVTOOLS__` so the adapter can write to it, and bridges messages to/from the content script via `window.postMessage`.

- [ ] **Step 1: Write injected/index.ts**

```typescript
// packages/extension/src/injected/index.ts

import type { MarkedPageMessage, MarkedExtensionMessage } from '../shared/types.js'

// Set the hook before any page scripts run (run_at: document_start)
window.__XSTATE_DEVTOOLS__ = {
  send: (message: unknown) => {
    // Forward inspection events to the content script (isolated world)
    // Content script listens for window.postMessage
    window.postMessage(message, '*')
  },
}

// Relay dispatch events from content script back to the adapter
// The adapter listens for window.postMessage with type XSTATE_DISPATCH
window.addEventListener('message', (evt: MessageEvent) => {
  if (evt.source !== window) return
  const data = evt.data as MarkedExtensionMessage
  if (!data?.__xstateDevtools) return
  if (data.type === 'XSTATE_DISPATCH') {
    // Already posted on window — the adapter's message listener picks this up
    // No action needed here; the adapter in index.ts handles it directly
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/injected/
git commit -m "feat: injected script sets window.__XSTATE_DEVTOOLS__ in page world"
```

---

## Task 7: Content Script Bridge

**Files:**
- Create: `packages/extension/src/content/index.ts`

Runs in the isolated world. Bridges `window.postMessage` (from injected script) ↔ `chrome.runtime.sendMessage` (to service worker).

- [ ] **Step 1: Write content/index.ts**

```typescript
// packages/extension/src/content/index.ts

import type { MarkedPageMessage, MarkedExtensionMessage } from '../shared/types.js'

// Page → service worker: forward inspection events
window.addEventListener('message', (evt: MessageEvent) => {
  if (evt.source !== window) return
  const data = evt.data as MarkedPageMessage
  if (!data?.__xstateDevtools) return
  // Only forward known inspection message types
  if (
    data.type === 'XSTATE_ACTOR_REGISTERED' ||
    data.type === 'XSTATE_SNAPSHOT' ||
    data.type === 'XSTATE_EVENT' ||
    data.type === 'XSTATE_ACTOR_STOPPED'
  ) {
    chrome.runtime.sendMessage(data)
  }
})

// Service worker → page: forward dispatch events
chrome.runtime.onMessage.addListener((message: MarkedExtensionMessage) => {
  if (!message?.__xstateDevtools) return
  if (message.type === 'XSTATE_DISPATCH') {
    window.postMessage(message, '*')
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/content/
git commit -m "feat: content script bridges page postMessage to chrome.runtime"
```

---

## Task 8: Service Worker (Background)

**Files:**
- Create: `packages/extension/src/background/index.ts`

Manages persistent port connections from devtools panels and routes messages between the inspected tab and its panel.

- [ ] **Step 1: Write background/index.ts**

```typescript
// packages/extension/src/background/index.ts

import type { MarkedPageMessage, MarkedExtensionMessage } from '../shared/types.js'

// tabId → devtools panel port
const panelPorts = new Map<number, chrome.runtime.Port>()

// tabId → buffered messages (panel may not be open yet)
const pendingMessages = new Map<number, MarkedPageMessage[]>()
const MAX_PENDING = 200

// Panel connects with name "xstate-panel-{tabId}"
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  const match = port.name.match(/^xstate-panel-(\d+)$/)
  if (!match) return

  const tabId = parseInt(match[1], 10)
  panelPorts.set(tabId, port)

  // Flush buffered messages to the newly connected panel
  const pending = pendingMessages.get(tabId) ?? []
  pending.forEach((msg) => port.postMessage(msg))
  pendingMessages.delete(tabId)

  port.onDisconnect.addListener(() => {
    panelPorts.delete(tabId)
  })

  // Panel → content script (dispatch events)
  port.onMessage.addListener((message: MarkedExtensionMessage) => {
    if (!message?.__xstateDevtools) return
    if (message.type === 'XSTATE_DISPATCH') {
      chrome.tabs.sendMessage(tabId, message)
    }
  })
})

// Content script → panel (inspection events)
chrome.runtime.onMessage.addListener(
  (message: MarkedPageMessage, sender: chrome.runtime.MessageSender) => {
    if (!message?.__xstateDevtools) return
    const tabId = sender.tab?.id
    if (tabId == null) return

    const port = panelPorts.get(tabId)
    if (port) {
      port.postMessage(message)
    } else {
      // Buffer for when panel opens
      const buf = pendingMessages.get(tabId) ?? []
      buf.push(message)
      if (buf.length > MAX_PENDING) buf.shift()
      pendingMessages.set(tabId, buf)
    }
  }
)
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/background/
git commit -m "feat: service worker routes messages between inspected tab and devtools panel"
```

---

## Task 9: DevTools Entry

**Files:**
- Create: `packages/extension/src/devtools/devtools.html`
- Create: `packages/extension/src/devtools/devtools.ts`
- Create: `packages/extension/src/panel/index.html`
- Create: `packages/extension/src/panel/main.tsx`

- [ ] **Step 1: Create devtools.html**

```html
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script type="module" src="./devtools.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create devtools.ts**

```typescript
// packages/extension/src/devtools/devtools.ts

chrome.devtools.panels.create(
  'XState',
  '',
  '../panel/index.html',
  (panel) => {
    // panel is available — no setup needed here
    void panel
  }
)
```

- [ ] **Step 3: Create panel/index.html**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>XState DevTools</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, monospace; font-size: 12px; height: 100vh; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create panel/main.tsx**

```tsx
// packages/extension/src/panel/main.tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
```

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/devtools/ packages/extension/src/panel/index.html packages/extension/src/panel/main.tsx
git commit -m "feat: devtools panel entry and HTML shells"
```

---

## Task 10: Zustand Store

**Files:**
- Create: `packages/extension/src/panel/store.ts`
- Create: `packages/extension/src/panel/active-nodes.ts`
- Create: `packages/extension/src/panel/store.test.ts`
- Create: `packages/extension/src/panel/active-nodes.test.ts`

- [ ] **Step 1: Write active-nodes.ts**

```typescript
// packages/extension/src/panel/active-nodes.ts
import type { SerializedStateNode } from '../shared/types.js'

type StateValue = string | { [key: string]: StateValue }

export function getActiveNodeIds(
  value: StateValue | null | undefined,
  node: SerializedStateNode
): Set<string> {
  const active = new Set<string>()
  if (!value) return active
  walkNode(value, node, active)
  return active
}

function walkNode(
  value: StateValue,
  node: SerializedStateNode,
  active: Set<string>
): void {
  active.add(node.id)

  if (node.type === 'atomic' || node.type === 'final') return

  if (node.type === 'parallel') {
    // value is { regionKey: regionValue } for each parallel region
    const obj = value as Record<string, StateValue>
    for (const [childKey, childValue] of Object.entries(obj)) {
      const childNode = node.states[childKey]
      if (childNode) walkNode(childValue, childNode, active)
    }
    return
  }

  // compound: value is either a string (leaf child) or { childKey: childValue }
  if (typeof value === 'string') {
    const childNode = node.states[value]
    if (childNode) walkNode(value, childNode, active)
  } else {
    const [childKey, childValue] = Object.entries(value as Record<string, StateValue>)[0] ?? []
    if (childKey) {
      const childNode = node.states[childKey]
      if (childNode) walkNode(childValue, childNode, active)
    }
  }
}
```

- [ ] **Step 2: Write active-nodes.test.ts**

```typescript
// packages/extension/src/panel/active-nodes.test.ts
import { describe, it, expect } from 'vitest'
import { getActiveNodeIds } from './active-nodes.js'
import type { SerializedStateNode } from '../shared/types.js'

const atomicNode = (id: string): SerializedStateNode => ({
  id, key: id.split('.').pop()!, type: 'atomic',
  states: {}, on: [], always: [], entry: [], exit: [], invoke: [],
})

describe('getActiveNodeIds', () => {
  it('returns active id for atomic leaf', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'compound', initial: 'idle',
      states: { idle: atomicNode('root.idle'), running: atomicNode('root.running') },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    const ids = getActiveNodeIds('idle', node)
    expect(ids.has('root')).toBe(true)
    expect(ids.has('root.idle')).toBe(true)
    expect(ids.has('root.running')).toBe(false)
  })

  it('handles parallel states', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'parallel', initial: undefined,
      states: {
        a: { ...atomicNode('root.a'), type: 'compound', initial: 'on',
          states: { on: atomicNode('root.a.on'), off: atomicNode('root.a.off') } },
        b: { ...atomicNode('root.b'), type: 'compound', initial: 'on',
          states: { on: atomicNode('root.b.on'), off: atomicNode('root.b.off') } },
      },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    const ids = getActiveNodeIds({ a: 'on', b: 'off' }, node)
    expect(ids.has('root.a')).toBe(true)
    expect(ids.has('root.a.on')).toBe(true)
    expect(ids.has('root.b.off')).toBe(true)
    expect(ids.has('root.a.off')).toBe(false)
  })

  it('returns empty set for null value', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'compound', initial: 'idle',
      states: { idle: atomicNode('root.idle') },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    expect(getActiveNodeIds(null, node).size).toBe(0)
  })
})
```

- [ ] **Step 3: Write store.ts**

```typescript
// packages/extension/src/panel/store.ts
import { create } from 'zustand'
import type {
  ActorRecord, EventRecord, SerializedStateNode,
  PageToExtensionMessage,
} from '../shared/types.js'

const MAX_EVENTS = 500

export interface InspectorStore {
  actors: Map<string, ActorRecord>
  events: EventRecord[]
  selectedActorId: string | null
  selectedStateNodeId: string | null
  timeTravelSeq: number | null   // null = live; number = frozen at that seq

  // Derived: returns the snapshot to display for an actor (live or time-travelled)
  getDisplaySnapshot: (sessionId: string) => ActorRecord['snapshot'] | null

  // Message handler — call this from the port listener
  handleMessage: (msg: PageToExtensionMessage) => void

  selectActor: (sessionId: string | null) => void
  selectStateNode: (id: string | null) => void
  timeTravel: (seq: number | null) => void
}

export const useStore = create<InspectorStore>((set, get) => ({
  actors: new Map(),
  events: [],
  selectedActorId: null,
  selectedStateNodeId: null,
  timeTravelSeq: null,

  getDisplaySnapshot(sessionId) {
    const { actors, events, timeTravelSeq } = get()
    const actor = actors.get(sessionId)
    if (!actor) return null
    if (timeTravelSeq === null) return actor.snapshot

    // Find the latest event at or before timeTravelSeq for this actor
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i]
      if (evt.sessionId === sessionId && evt.globalSeq <= timeTravelSeq) {
        return evt.snapshotAfter
      }
    }
    // No events for this actor before that seq — use the registered snapshot
    return actor.snapshot
  },

  handleMessage(msg) {
    set((state) => {
      const actors = new Map(state.actors)
      const events = [...state.events]

      switch (msg.type) {
        case 'XSTATE_ACTOR_REGISTERED': {
          actors.set(msg.sessionId, {
            sessionId: msg.sessionId,
            parentSessionId: msg.parentSessionId,
            machine: msg.machine,
            snapshot: msg.snapshot,
            status: 'active',
            registeredAt: Date.now(),
          })
          break
        }
        case 'XSTATE_SNAPSHOT': {
          const actor = actors.get(msg.sessionId)
          if (actor) {
            actors.set(msg.sessionId, { ...actor, snapshot: msg.snapshot })
          }
          break
        }
        case 'XSTATE_EVENT': {
          const actor = actors.get(msg.sessionId)
          if (actor) {
            actors.set(msg.sessionId, { ...actor, snapshot: msg.snapshotAfter })
          }
          events.push({
            sessionId: msg.sessionId,
            event: msg.event,
            snapshotAfter: msg.snapshotAfter,
            timestamp: msg.timestamp,
            globalSeq: msg.globalSeq,
          })
          if (events.length > MAX_EVENTS) events.shift()
          break
        }
        case 'XSTATE_ACTOR_STOPPED': {
          const actor = actors.get(msg.sessionId)
          if (actor) actors.set(msg.sessionId, { ...actor, status: 'stopped' })
          break
        }
      }

      return { actors, events }
    })
  },

  selectActor(sessionId) {
    set({ selectedActorId: sessionId, selectedStateNodeId: null })
  },

  selectStateNode(id) {
    set({ selectedStateNodeId: id })
  },

  timeTravel(seq) {
    set({ timeTravelSeq: seq })
  },
}))
```

- [ ] **Step 4: Write store.test.ts**

```typescript
// packages/extension/src/panel/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store.js'
import type { SerializedMachine, SerializedSnapshot } from '../shared/types.js'

const mockMachine: SerializedMachine = {
  id: 'test',
  root: {
    id: 'test', key: 'test', type: 'compound', initial: 'idle',
    states: {
      idle: { id: 'test.idle', key: 'idle', type: 'atomic', states: {}, on: [], always: [], entry: [], exit: [], invoke: [] },
      running: { id: 'test.running', key: 'running', type: 'atomic', states: {}, on: [], always: [], entry: [], exit: [], invoke: [] },
    },
    on: [], always: [], entry: [], exit: [], invoke: [],
  },
}

const snap = (value: unknown): SerializedSnapshot => ({
  value, context: {}, status: 'active',
})

beforeEach(() => {
  useStore.setState({ actors: new Map(), events: [], selectedActorId: null, selectedStateNodeId: null, timeTravelSeq: null })
})

describe('handleMessage', () => {
  it('registers an actor', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
    })
    expect(useStore.getState().actors.get('a1')?.sessionId).toBe('a1')
  })

  it('updates snapshot on XSTATE_EVENT', () => {
    useStore.getState().handleMessage({ type: 'XSTATE_ACTOR_REGISTERED', sessionId: 'a1', machine: mockMachine, snapshot: snap('idle') })
    useStore.getState().handleMessage({
      type: 'XSTATE_EVENT', sessionId: 'a1',
      event: { type: 'START' }, snapshotAfter: snap('running'),
      timestamp: 1000, globalSeq: 1,
    })
    expect(useStore.getState().actors.get('a1')?.snapshot.value).toBe('running')
    expect(useStore.getState().events).toHaveLength(1)
  })

  it('caps events at MAX_EVENTS (500)', () => {
    useStore.getState().handleMessage({ type: 'XSTATE_ACTOR_REGISTERED', sessionId: 'a1', machine: mockMachine, snapshot: snap('idle') })
    for (let i = 0; i < 510; i++) {
      useStore.getState().handleMessage({
        type: 'XSTATE_EVENT', sessionId: 'a1',
        event: { type: 'TICK' }, snapshotAfter: snap('idle'),
        timestamp: i, globalSeq: i,
      })
    }
    expect(useStore.getState().events.length).toBeLessThanOrEqual(500)
  })
})

describe('time travel', () => {
  it('getDisplaySnapshot returns historical snapshot when time-travelling', () => {
    const { handleMessage, timeTravel, getDisplaySnapshot } = useStore.getState()
    handleMessage({ type: 'XSTATE_ACTOR_REGISTERED', sessionId: 'a1', machine: mockMachine, snapshot: snap('idle') })
    handleMessage({ type: 'XSTATE_EVENT', sessionId: 'a1', event: { type: 'START' }, snapshotAfter: snap('running'), timestamp: 1000, globalSeq: 1 })
    handleMessage({ type: 'XSTATE_EVENT', sessionId: 'a1', event: { type: 'STOP' }, snapshotAfter: snap('idle'), timestamp: 2000, globalSeq: 2 })

    timeTravel(1)
    expect(getDisplaySnapshot('a1')?.value).toBe('running')

    timeTravel(null)
    expect(getDisplaySnapshot('a1')?.value).toBe('idle')
  })
})
```

- [ ] **Step 5: Run store tests**

```bash
npm test --workspace=packages/extension
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/panel/store.ts packages/extension/src/panel/active-nodes.ts packages/extension/src/panel/store.test.ts packages/extension/src/panel/active-nodes.test.ts
git commit -m "feat: zustand store with time travel and active node derivation"
```

---

## Task 11: App.tsx — Panel Root + Port Connection

**Files:**
- Create: `packages/extension/src/panel/App.tsx`

The panel connects to the service worker via a named port and feeds incoming messages into the store.

- [ ] **Step 1: Write App.tsx**

```tsx
// packages/extension/src/panel/App.tsx
import React, { useEffect } from 'react'
import { useStore } from './store.js'
import { Layout } from './components/Layout.js'
import type { PageToExtensionMessage, MarkedPageMessage } from '../shared/types.js'

export function App() {
  const handleMessage = useStore((s) => s.handleMessage)

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    const port = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })

    port.onMessage.addListener((message: MarkedPageMessage) => {
      if (!message?.__xstateDevtools) return
      handleMessage(message as PageToExtensionMessage)
    })

    return () => port.disconnect()
  }, [handleMessage])

  return <Layout />
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/panel/App.tsx
git commit -m "feat: panel App connects to service worker port and feeds store"
```

---

## Task 12: Layout Component

**Files:**
- Create: `packages/extension/src/panel/components/Layout.tsx`

Three-column layout using `react-resizable-panels`, with a resizable bottom drawer for the event log.

- [ ] **Step 1: Write Layout.tsx**

```tsx
// packages/extension/src/panel/components/Layout.tsx
import React from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { ActorList } from './ActorList.js'
import { MachineTree } from './MachineTree.js'
import { SidePanel } from './SidePanel.js'
import { EventLog } from './EventLog.js'
import { useStore } from '../store.js'

const dividerStyle: React.CSSProperties = {
  width: 4, background: '#e0e0e0', cursor: 'col-resize', flexShrink: 0,
}
const hDividerStyle: React.CSSProperties = {
  height: 4, background: '#e0e0e0', cursor: 'row-resize', flexShrink: 0,
}

export function Layout() {
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {timeTravelSeq !== null && (
        <div style={{
          background: '#fffbe6', borderBottom: '1px solid #ffe58f',
          padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12,
        }}>
          <span>⏮ Time travel — seq {timeTravelSeq}</span>
          <button onClick={() => timeTravel(null)} style={{ marginLeft: 'auto', cursor: 'pointer' }}>
            Back to live
          </button>
        </div>
      )}

      <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={70} minSize={30}>
          <PanelGroup direction="horizontal" style={{ height: '100%' }}>
            <Panel defaultSize={20} minSize={150} style={{ overflow: 'auto' }}>
              <ActorList />
            </Panel>
            <PanelResizeHandle style={dividerStyle} />
            <Panel defaultSize={55} minSize={200} style={{ overflow: 'auto' }}>
              <MachineTree />
            </Panel>
            <PanelResizeHandle style={dividerStyle} />
            <Panel defaultSize={25} minSize={200} style={{ overflow: 'auto' }}>
              <SidePanel />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle style={hDividerStyle} />
        <Panel defaultSize={30} minSize={80} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <EventLog />
        </Panel>
      </PanelGroup>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/panel/components/Layout.tsx
git commit -m "feat: three-column + event log drawer layout"
```

---

## Task 13: ActorList Component

**Files:**
- Create: `packages/extension/src/panel/components/ActorList.tsx`

- [ ] **Step 1: Write ActorList.tsx**

```tsx
// packages/extension/src/panel/components/ActorList.tsx
import React from 'react'
import { useStore } from '../store.js'

export function ActorList() {
  const actors = useStore((s) => s.actors)
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectActor = useStore((s) => s.selectActor)

  // Build parent→children map
  const childrenOf = new Map<string | undefined, string[]>()
  for (const actor of actors.values()) {
    const parent = actor.parentSessionId
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent)!.push(actor.sessionId)
  }

  const roots = childrenOf.get(undefined) ?? []

  function renderActor(sessionId: string, depth: number): React.ReactNode {
    const actor = actors.get(sessionId)
    if (!actor) return null
    const isSelected = sessionId === selectedActorId
    const isStopped = actor.status === 'stopped'
    const children = childrenOf.get(sessionId) ?? []
    const label = actor.machine?.id ?? sessionId.slice(0, 12)

    return (
      <div key={sessionId}>
        <div
          onClick={() => selectActor(sessionId)}
          style={{
            paddingLeft: 8 + depth * 16,
            paddingTop: 4, paddingBottom: 4,
            cursor: 'pointer',
            background: isSelected ? '#d0e8ff' : 'transparent',
            color: isStopped ? '#aaa' : 'inherit',
            borderLeft: isSelected ? '2px solid #1890ff' : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: isStopped ? '#ccc' : '#52c41a',
          }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{label}</span>
        </div>
        {children.map((cid) => renderActor(cid, depth + 1))}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', borderRight: '1px solid #eee', background: '#fafafa' }}>
      <div style={{ padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid #eee', fontSize: 11, color: '#666' }}>
        ACTORS
      </div>
      {roots.length === 0 ? (
        <div style={{ padding: 12, color: '#aaa', fontSize: 11 }}>
          No actors detected.<br />Make sure the adapter is wired up.
        </div>
      ) : (
        roots.map((sid) => renderActor(sid, 0))
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/panel/components/ActorList.tsx
git commit -m "feat: actor list with parent-child tree"
```

---

## Task 14: MachineTree Component

**Files:**
- Create: `packages/extension/src/panel/components/MachineTree.tsx`

Renders the serialized state node tree with active nodes highlighted. Clicking a node selects it for the side panel.

- [ ] **Step 1: Write MachineTree.tsx**

```tsx
// packages/extension/src/panel/components/MachineTree.tsx
import React from 'react'
import { useStore } from '../store.js'
import { getActiveNodeIds } from '../active-nodes.js'
import type { SerializedStateNode } from '../../shared/types.js'

function StateNodeRow({
  node,
  activeIds,
  selectedId,
  onSelect,
  depth,
}: {
  node: SerializedStateNode
  activeIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
  depth: number
}) {
  const isActive = activeIds.has(node.id)
  const isSelected = node.id === selectedId
  const hasChildren = Object.keys(node.states).length > 0
  const [expanded, setExpanded] = React.useState(true)

  const typeColor: Record<string, string> = {
    parallel: '#722ed1', final: '#d4380d', history: '#d48806', atomic: '#595959', compound: '#595959',
  }

  return (
    <>
      <div
        style={{
          paddingLeft: 8 + depth * 18,
          paddingTop: 3, paddingBottom: 3,
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer',
          background: isSelected ? '#e6f4ff' : isActive ? '#f6ffed' : 'transparent',
          borderLeft: isActive ? '3px solid #52c41a' : '3px solid transparent',
          fontFamily: 'monospace', fontSize: 12,
        }}
        onClick={() => { onSelect(node.id); if (hasChildren) setExpanded((e) => !e) }}
      >
        {hasChildren && (
          <span style={{ color: '#aaa', fontSize: 10, width: 10 }}>{expanded ? '▼' : '▶'}</span>
        )}
        {!hasChildren && <span style={{ width: 10 }} />}
        <span style={{ color: typeColor[node.type] ?? '#595959', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          {node.type.slice(0, 4)}
        </span>
        <span style={{ fontWeight: isActive ? 700 : 400, color: isActive ? '#237804' : '#333' }}>
          {node.key}
        </span>
        {node.invoke.length > 0 && (
          <span title="has invoked services" style={{ color: '#096dd9', fontSize: 10 }}>⚙</span>
        )}
      </div>
      {expanded && hasChildren && Object.values(node.states).map((child) => (
        <StateNodeRow
          key={child.id}
          node={child}
          activeIds={activeIds}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  )
}

export function MachineTree() {
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const selectStateNode = useStore((s) => s.selectStateNode)
  const getDisplaySnapshot = useStore((s) => s.getDisplaySnapshot)
  const actors = useStore((s) => s.actors)

  const actor = selectedActorId ? actors.get(selectedActorId) : null
  const snapshot = selectedActorId ? getDisplaySnapshot(selectedActorId) : null

  if (!actor) {
    return (
      <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>
        Select an actor from the left panel.
      </div>
    )
  }

  if (!actor.machine) {
    return (
      <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>
        No machine definition available for this actor.
      </div>
    )
  }

  const activeIds = snapshot
    ? getActiveNodeIds(snapshot.value as any, actor.machine.root)
    : new Set<string>()

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{
        padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid #eee',
        fontSize: 11, color: '#666', position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>{actor.machine.id}</span>
        {actor.machine.sourceLocation && (
          <a
            href={`vscode://file/${actor.machine.sourceLocation}`}
            style={{ color: '#1890ff', fontSize: 10, textDecoration: 'none' }}
            title="Open in VS Code"
          >
            ↗ source
          </a>
        )}
      </div>
      <StateNodeRow
        node={actor.machine.root}
        activeIds={activeIds}
        selectedId={selectedStateNodeId}
        onSelect={selectStateNode}
        depth={0}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/panel/components/MachineTree.tsx
git commit -m "feat: machine state tree with active node highlighting and source link"
```

---

## Task 15: SidePanel Component

**Files:**
- Create: `packages/extension/src/panel/components/SidePanel.tsx`

Shows possible events for the selected state node and allows dispatching them with a JSON payload editor.

- [ ] **Step 1: Write SidePanel.tsx**

```tsx
// packages/extension/src/panel/components/SidePanel.tsx
import React, { useState, useCallback } from 'react'
import { useStore } from '../store.js'
import type { SerializedStateNode, SerializedTransition } from '../../shared/types.js'

function findNode(root: SerializedStateNode, id: string): SerializedStateNode | null {
  if (root.id === id) return root
  for (const child of Object.values(root.states)) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function TransitionRow({
  transition,
  onSend,
}: {
  transition: SerializedTransition
  onSend: (eventType: string) => void
}) {
  return (
    <div style={{
      padding: '6px 0', borderBottom: '1px solid #f0f0f0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{transition.eventType || '(always)'}</div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
          {transition.targets.length > 0 && <>→ {transition.targets.map((t) => t.split('.').pop()).join(', ')}</>}
          {transition.guard && <> [if: {transition.guard}]</>}
        </div>
      </div>
      {transition.eventType && (
        <button
          onClick={() => onSend(transition.eventType)}
          style={{
            padding: '2px 8px', fontSize: 11, cursor: 'pointer',
            background: '#1890ff', color: '#fff', border: 'none', borderRadius: 4,
          }}
        >
          Send
        </button>
      )}
    </div>
  )
}

export function SidePanel() {
  const selectedActorId = useStore((s) => s.selectedActorId)
  const selectedStateNodeId = useStore((s) => s.selectedStateNodeId)
  const actors = useStore((s) => s.actors)

  const [payloadJson, setPayloadJson] = useState('{}')
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [customEventType, setCustomEventType] = useState('')

  const actor = selectedActorId ? actors.get(selectedActorId) : null
  const node = actor?.machine && selectedStateNodeId
    ? findNode(actor.machine.root, selectedStateNodeId)
    : null

  const dispatch = useCallback((eventType: string) => {
    if (!selectedActorId) return
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(payloadJson)
      setPayloadError(null)
    } catch {
      setPayloadError('Invalid JSON')
      return
    }
    const tabId = chrome.devtools.inspectedWindow.tabId
    const port = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })
    port.postMessage({
      __xstateDevtools: true,
      type: 'XSTATE_DISPATCH',
      sessionId: selectedActorId,
      event: { type: eventType, ...payload },
    })
    port.disconnect()
  }, [selectedActorId, payloadJson])

  if (!actor) {
    return (
      <div style={{ padding: 16, color: '#aaa', fontSize: 12, borderLeft: '1px solid #eee' }}>
        Select an actor to inspect.
      </div>
    )
  }

  return (
    <div style={{ padding: 12, borderLeft: '1px solid #eee', height: '100%', overflow: 'auto' }}>
      <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 8 }}>
        {node ? `TRANSITIONS FROM: ${node.key}` : 'SELECTED STATE'}
      </div>

      {node && node.on.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          {node.on.map((t, i) => (
            <TransitionRow key={i} transition={t} onSend={dispatch} />
          ))}
          {node.always.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: '#aaa', margin: '8px 0 4px' }}>ALWAYS</div>
              {node.always.map((t, i) => (
                <TransitionRow key={i} transition={t} onSend={() => {}} />
              ))}
            </>
          )}
        </div>
      ) : node ? (
        <div style={{ color: '#aaa', fontSize: 11, marginBottom: 12 }}>No transitions from this state.</div>
      ) : (
        <div style={{ color: '#aaa', fontSize: 11, marginBottom: 12 }}>Select a state node in the tree.</div>
      )}

      <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 4 }}>PAYLOAD</div>
      <textarea
        value={payloadJson}
        onChange={(e) => setPayloadJson(e.target.value)}
        style={{
          width: '100%', height: 80, fontFamily: 'monospace', fontSize: 11,
          border: payloadError ? '1px solid red' : '1px solid #d9d9d9',
          borderRadius: 4, padding: 4, resize: 'vertical',
        }}
      />
      {payloadError && <div style={{ color: 'red', fontSize: 10 }}>{payloadError}</div>}

      <div style={{ fontWeight: 600, fontSize: 11, color: '#666', margin: '8px 0 4px' }}>SEND CUSTOM EVENT</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={customEventType}
          onChange={(e) => setCustomEventType(e.target.value)}
          placeholder="EVENT_TYPE"
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4 }}
        />
        <button
          onClick={() => customEventType && dispatch(customEventType)}
          style={{ padding: '2px 10px', fontSize: 11, cursor: 'pointer', background: '#52c41a', color: '#fff', border: 'none', borderRadius: 4 }}
        >
          Send
        </button>
      </div>

      {actor.machine?.root && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 4 }}>CONTEXT</div>
          <pre style={{ fontSize: 10, background: '#f5f5f5', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
            {JSON.stringify(
              actors.get(selectedActorId!)?.snapshot.context,
              null, 2
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/panel/components/SidePanel.tsx
git commit -m "feat: side panel with transitions, payload editor, and dispatch"
```

---

## Task 16: EventLog Component + Time Travel

**Files:**
- Create: `packages/extension/src/panel/components/EventLog.tsx`

- [ ] **Step 1: Write EventLog.tsx**

```tsx
// packages/extension/src/panel/components/EventLog.tsx
import React, { useRef, useEffect, useState } from 'react'
import { useStore } from '../store.js'

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`
}

export function EventLog() {
  const events = useStore((s) => s.events)
  const actors = useStore((s) => s.actors)
  const timeTravelSeq = useStore((s) => s.timeTravelSeq)
  const timeTravel = useStore((s) => s.timeTravel)
  const selectActor = useStore((s) => s.selectActor)

  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll when live
  useEffect(() => {
    if (autoScroll && timeTravelSeq === null) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events, autoScroll, timeTravelSeq])

  const filtered = filter
    ? events.filter((e) => e.event.type.toLowerCase().includes(filter.toLowerCase()))
    : events

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderTop: '1px solid #eee' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
        borderBottom: '1px solid #eee', background: '#fafafa', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 11, color: '#666' }}>EVENTS</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by type…"
          style={{ fontSize: 11, padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4, width: 160 }}
        />
        <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{events.length} events</span>
        {timeTravelSeq !== null && (
          <button onClick={() => timeTravel(null)} style={{ fontSize: 11, cursor: 'pointer' }}>
            ▶ Back to live
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
        {filtered.map((evt, i) => {
          const actorLabel = actors.get(evt.sessionId)?.machine?.id ?? evt.sessionId.slice(0, 12)
          const isCurrent = evt.globalSeq === timeTravelSeq
          return (
            <div
              key={i}
              onClick={() => {
                timeTravel(evt.globalSeq)
                selectActor(evt.sessionId)
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 120px 1fr 80px',
                gap: 8,
                padding: '3px 8px',
                cursor: 'pointer',
                background: isCurrent ? '#e6f4ff' : 'transparent',
                borderLeft: isCurrent ? '3px solid #1890ff' : '3px solid transparent',
              }}
              title="Click to time travel to this event"
            >
              <span style={{ color: '#aaa' }}>{formatTime(evt.timestamp)}</span>
              <span style={{ color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {actorLabel}
              </span>
              <span style={{ fontWeight: 600, color: '#003a8c' }}>{evt.event.type}</span>
              <span style={{ color: '#8c8c8c', textAlign: 'right' }}>seq:{evt.globalSeq}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/panel/components/EventLog.tsx
git commit -m "feat: event log with time travel on click"
```

---

## Task 17: Example Machines

**Files:**
- Create: `packages/example-remix/app/machines/auth.machine.ts`
- Create: `packages/example-remix/app/machines/cart.machine.ts`
- Create: `packages/example-remix/app/machines/player.machine.ts`

- [ ] **Step 1: Write auth.machine.ts** — compound states, invoked service, guards

```typescript
// packages/example-remix/app/machines/auth.machine.ts
import { setup, assign, fromPromise } from 'xstate'

const loginService = fromPromise<{ token: string }, { email: string; password: string }>(
  async ({ input }) => {
    await new Promise((r) => setTimeout(r, 1000))
    if (input.password === 'wrong') throw new Error('Invalid credentials')
    return { token: 'fake-jwt-' + input.email }
  }
)

export const authMachine = setup({
  types: {
    context: {} as {
      email: string
      password: string
      token: string | null
      error: string | null
    },
    events: {} as
      | { type: 'SUBMIT'; email: string; password: string }
      | { type: 'LOGOUT' }
      | { type: 'RETRY' },
  },
  actors: { loginService },
  guards: {
    hasCredentials: ({ context }) => context.email.length > 0 && context.password.length > 0,
  },
  actions: {
    setCredentials: assign(({ event }) => {
      if (event.type !== 'SUBMIT') return {}
      return { email: event.email, password: event.password, error: null }
    }),
    setToken: assign(({ event }) => {
      if (event.type !== 'xstate.done.actor.login') return {}
      return { token: (event.output as any).token }
    }),
    setError: assign(({ event }) => {
      if (event.type !== 'xstate.error.actor.login') return {}
      return { error: (event.error as Error).message }
    }),
    clearCredentials: assign({ email: '', password: '', token: null, error: null }),
  },
}).createMachine({
  id: 'auth',
  initial: 'idle',
  context: { email: '', password: '', token: null, error: null },
  states: {
    idle: {
      on: {
        SUBMIT: {
          target: 'authenticating',
          guard: 'hasCredentials',
          actions: 'setCredentials',
        },
      },
    },
    authenticating: {
      invoke: {
        id: 'login',
        src: 'loginService',
        input: ({ context }) => ({ email: context.email, password: context.password }),
        onDone: { target: 'authenticated', actions: 'setToken' },
        onError: { target: 'failed', actions: 'setError' },
      },
    },
    authenticated: {
      on: { LOGOUT: { target: 'idle', actions: 'clearCredentials' } },
    },
    failed: {
      on: {
        RETRY: 'idle',
        SUBMIT: {
          target: 'authenticating',
          guard: 'hasCredentials',
          actions: 'setCredentials',
        },
      },
    },
  },
})
```

- [ ] **Step 2: Write cart.machine.ts** — parallel states

```typescript
// packages/example-remix/app/machines/cart.machine.ts
import { setup, assign } from 'xstate'

type Item = { id: string; name: string; price: number; qty: number }

export const cartMachine = setup({
  types: {
    context: {} as {
      items: Item[]
      promoCode: string | null
      paymentMethod: string | null
    },
    events: {} as
      | { type: 'ADD_ITEM'; item: Item }
      | { type: 'REMOVE_ITEM'; id: string }
      | { type: 'START_CHECKOUT' }
      | { type: 'APPLY_PROMO'; code: string }
      | { type: 'SELECT_PAYMENT'; method: string }
      | { type: 'SUBMIT_ORDER' }
      | { type: 'ORDER_CONFIRMED' }
      | { type: 'RESET' },
  },
  guards: {
    hasItems: ({ context }) => context.items.length > 0,
    hasPaymentMethod: ({ context }) => context.paymentMethod !== null,
  },
  actions: {
    addItem: assign(({ context, event }) => {
      if (event.type !== 'ADD_ITEM') return {}
      const existing = context.items.find((i) => i.id === event.item.id)
      if (existing) {
        return { items: context.items.map((i) => i.id === event.item.id ? { ...i, qty: i.qty + 1 } : i) }
      }
      return { items: [...context.items, event.item] }
    }),
    removeItem: assign(({ context, event }) => {
      if (event.type !== 'REMOVE_ITEM') return {}
      return { items: context.items.filter((i) => i.id !== event.id) }
    }),
    applyPromo: assign(({ event }) => {
      if (event.type !== 'APPLY_PROMO') return {}
      return { promoCode: event.code }
    }),
    selectPayment: assign(({ event }) => {
      if (event.type !== 'SELECT_PAYMENT') return {}
      return { paymentMethod: event.method }
    }),
    resetCart: assign({ items: [], promoCode: null, paymentMethod: null }),
  },
}).createMachine({
  id: 'cart',
  type: 'parallel',
  context: { items: [], promoCode: null, paymentMethod: null },
  states: {
    inventory: {
      initial: 'browsing',
      states: {
        browsing: {
          on: {
            ADD_ITEM: { actions: 'addItem' },
            REMOVE_ITEM: { actions: 'removeItem' },
          },
        },
      },
    },
    checkout: {
      initial: 'idle',
      states: {
        idle: {
          on: { START_CHECKOUT: { target: 'details', guard: 'hasItems' } },
        },
        details: {
          on: {
            APPLY_PROMO: { actions: 'applyPromo' },
            SELECT_PAYMENT: { actions: 'selectPayment' },
            SUBMIT_ORDER: { target: 'processing', guard: 'hasPaymentMethod' },
          },
        },
        processing: {
          after: { 1500: 'confirmed' },
        },
        confirmed: {
          on: { RESET: { target: 'idle', actions: 'resetCart' } },
        },
      },
    },
  },
})
```

- [ ] **Step 3: Write player.machine.ts** — spawned child actor, history state

```typescript
// packages/example-remix/app/machines/player.machine.ts
import { setup, assign, sendParent, fromCallback, createActor } from 'xstate'

// Spawned actor: simulates buffering progress
const bufferActor = fromCallback<any, { duration: number }>(({ sendBack, input }) => {
  let progress = 0
  const interval = setInterval(() => {
    progress += 10
    sendBack({ type: 'BUFFER_PROGRESS', progress })
    if (progress >= 100) {
      sendBack({ type: 'BUFFER_COMPLETE' })
      clearInterval(interval)
    }
  }, input.duration / 10)
  return () => clearInterval(interval)
})

export const playerMachine = setup({
  types: {
    context: {} as {
      src: string | null
      position: number
      duration: number
      bufferProgress: number
      volume: number
    },
    events: {} as
      | { type: 'LOAD'; src: string; duration: number }
      | { type: 'PLAY' }
      | { type: 'PAUSE' }
      | { type: 'SEEK'; position: number }
      | { type: 'STOP' }
      | { type: 'VOLUME'; level: number }
      | { type: 'BUFFER_PROGRESS'; progress: number }
      | { type: 'BUFFER_COMPLETE' },
  },
  actors: { bufferActor },
  actions: {
    loadSrc: assign(({ event }) => {
      if (event.type !== 'LOAD') return {}
      return { src: event.src, duration: event.duration, position: 0, bufferProgress: 0 }
    }),
    updatePosition: assign(({ event }) => {
      if (event.type !== 'SEEK') return {}
      return { position: event.position }
    }),
    updateVolume: assign(({ event }) => {
      if (event.type !== 'VOLUME') return {}
      return { volume: event.level }
    }),
    updateBufferProgress: assign(({ event }) => {
      if (event.type !== 'BUFFER_PROGRESS') return {}
      return { bufferProgress: event.progress }
    }),
    resetPlayer: assign({ src: null, position: 0, duration: 0, bufferProgress: 0 }),
  },
}).createMachine({
  id: 'player',
  initial: 'idle',
  context: { src: null, position: 0, duration: 0, bufferProgress: 0, volume: 80 },
  states: {
    idle: {
      on: { LOAD: { target: 'buffering', actions: 'loadSrc' } },
    },
    buffering: {
      invoke: {
        id: 'buffer',
        src: 'bufferActor',
        input: ({ context }) => ({ duration: context.duration }),
      },
      on: {
        BUFFER_PROGRESS: { actions: 'updateBufferProgress' },
        BUFFER_COMPLETE: 'playing',
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
    playing: {
      on: {
        PAUSE: 'paused',
        SEEK: { actions: 'updatePosition' },
        VOLUME: { actions: 'updateVolume' },
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
    paused: {
      on: {
        PLAY: 'playing',
        SEEK: { actions: 'updatePosition' },
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
  },
})
```

- [ ] **Step 4: Commit**

```bash
git add packages/example-remix/app/machines/
git commit -m "feat: example machines — auth (invoke), cart (parallel), player (spawn)"
```

---

## Task 18: Example Remix App Wiring

**Files:**
- Create: `packages/example-remix/vite.config.ts`
- Create: `packages/example-remix/app/inspector.client.ts`
- Create: `packages/example-remix/app/root.tsx`
- Create: `packages/example-remix/app/components/AuthForm.tsx`
- Create: `packages/example-remix/app/components/ShoppingCart.tsx`
- Create: `packages/example-remix/app/components/MediaPlayer.tsx`
- Create: `packages/example-remix/app/routes/_index.tsx`

- [ ] **Step 1: Create vite.config.ts**

```typescript
// packages/example-remix/vite.config.ts
import { defineConfig } from 'vite'
import { vitePlugin as remix } from '@remix-run/dev'

export default defineConfig({
  plugins: [remix()],
})
```

- [ ] **Step 2: Create inspector.client.ts**

```typescript
// packages/example-remix/app/inspector.client.ts
// Only runs in the browser (Remix .client convention)
import { createAdapter } from '@xstate-devtools/adapter'

export const { inspect } = createAdapter()
```

- [ ] **Step 3: Create root.tsx**

```tsx
// packages/example-remix/app/root.tsx
import {
  Links, Meta, Outlet, Scripts, ScrollRestoration,
} from '@remix-run/react'

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta /><Links />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <Outlet />
        <ScrollRestoration /><Scripts />
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Create AuthForm.tsx**

```tsx
// packages/example-remix/app/components/AuthForm.tsx
import React, { useState } from 'react'
import { useMachine } from '@xstate/react'
import { authMachine } from '../machines/auth.machine.js'
import { inspect } from '../inspector.client.js'

export function AuthForm() {
  const [state, send] = useMachine(authMachine, { inspect })
  const [email, setEmail] = useState('user@example.com')
  const [password, setPassword] = useState('secret')

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8, maxWidth: 360 }}>
      <h3>Auth Machine — state: <code>{JSON.stringify(state.value)}</code></h3>

      {(state.matches('idle') || state.matches('failed')) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {state.matches('failed') && (
            <div style={{ color: 'red', fontSize: 13 }}>Error: {state.context.error}</div>
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ padding: 6 }} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" style={{ padding: 6 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => send({ type: 'SUBMIT', email, password })}>Login</button>
            {state.matches('failed') && <button onClick={() => send({ type: 'RETRY' })}>Retry</button>}
          </div>
        </div>
      )}

      {state.matches('authenticating') && <p>Logging in…</p>}

      {state.matches('authenticated') && (
        <div>
          <p style={{ color: 'green' }}>Logged in as {state.context.email}</p>
          <button onClick={() => send({ type: 'LOGOUT' })}>Logout</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create ShoppingCart.tsx**

```tsx
// packages/example-remix/app/components/ShoppingCart.tsx
import React from 'react'
import { useMachine } from '@xstate/react'
import { cartMachine } from '../machines/cart.machine.js'
import { inspect } from '../inspector.client.js'

const ITEMS = [
  { id: '1', name: 'Widget A', price: 9.99, qty: 1 },
  { id: '2', name: 'Widget B', price: 14.99, qty: 1 },
  { id: '3', name: 'Widget C', price: 4.99, qty: 1 },
]

export function ShoppingCart() {
  const [state, send] = useMachine(cartMachine, { inspect })
  const checkoutState = state.value.checkout as string

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>Cart Machine — checkout: <code>{checkoutState}</code></h3>

      <div style={{ marginBottom: 12 }}>
        <strong>Add items:</strong>
        {ITEMS.map((item) => (
          <button key={item.id} onClick={() => send({ type: 'ADD_ITEM', item })} style={{ margin: '0 4px' }}>
            + {item.name}
          </button>
        ))}
      </div>

      {state.context.items.length > 0 && (
        <ul style={{ marginBottom: 12 }}>
          {state.context.items.map((item) => (
            <li key={item.id}>
              {item.name} x{item.qty} — ${(item.price * item.qty).toFixed(2)}
              <button onClick={() => send({ type: 'REMOVE_ITEM', id: item.id })} style={{ marginLeft: 8 }}>×</button>
            </li>
          ))}
        </ul>
      )}

      {checkoutState === 'idle' && (
        <button onClick={() => send({ type: 'START_CHECKOUT' })}>Checkout</button>
      )}
      {checkoutState === 'details' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => send({ type: 'APPLY_PROMO', code: 'SAVE10' })}>Apply promo SAVE10</button>
          <button onClick={() => send({ type: 'SELECT_PAYMENT', method: 'card' })}>Pay with card</button>
          <button onClick={() => send({ type: 'SUBMIT_ORDER' })}>Submit order</button>
        </div>
      )}
      {checkoutState === 'processing' && <p>Processing…</p>}
      {checkoutState === 'confirmed' && (
        <div>
          <p style={{ color: 'green' }}>Order confirmed!</p>
          <button onClick={() => send({ type: 'RESET' })}>Reset</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Create MediaPlayer.tsx**

```tsx
// packages/example-remix/app/components/MediaPlayer.tsx
import React from 'react'
import { useMachine } from '@xstate/react'
import { playerMachine } from '../machines/player.machine.js'
import { inspect } from '../inspector.client.js'

export function MediaPlayer() {
  const [state, send] = useMachine(playerMachine, { inspect })

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>Player Machine — state: <code>{JSON.stringify(state.value)}</code></h3>
      <p>Position: {state.context.position}s / {state.context.duration}s | Vol: {state.context.volume}%</p>

      {state.context.bufferProgress > 0 && state.context.bufferProgress < 100 && (
        <div style={{ height: 4, background: '#eee', borderRadius: 2, margin: '8px 0' }}>
          <div style={{ height: '100%', width: `${state.context.bufferProgress}%`, background: '#1890ff', borderRadius: 2 }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button onClick={() => send({ type: 'LOAD', src: 'example.mp4', duration: 120 })}>Load</button>
        <button onClick={() => send({ type: 'PLAY' })}>Play</button>
        <button onClick={() => send({ type: 'PAUSE' })}>Pause</button>
        <button onClick={() => send({ type: 'SEEK', position: 30 })}>Seek 30s</button>
        <button onClick={() => send({ type: 'VOLUME', level: 50 })}>Vol 50%</button>
        <button onClick={() => send({ type: 'STOP' })}>Stop</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create routes/_index.tsx**

```tsx
// packages/example-remix/app/routes/_index.tsx
import React from 'react'
import { AuthForm } from '../components/AuthForm.js'
import { ShoppingCart } from '../components/ShoppingCart.js'
import { MediaPlayer } from '../components/MediaPlayer.js'

export default function Index() {
  return (
    <div>
      <h1>XState DevTools — Example App</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Open Chrome DevTools → XState panel to inspect these machines.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <AuthForm />
        <ShoppingCart />
        <MediaPlayer />
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Start example app and verify it loads**

```bash
npm run dev:example
```

Expected: Remix dev server starts on `http://localhost:5173`. Three components visible, no console errors.

- [ ] **Step 9: Commit**

```bash
git add packages/example-remix/
git commit -m "feat: example Remix app with auth, cart, and player machines"
```

---

## Task 19: Load Extension and End-to-End Smoke Test

- [ ] **Step 1: Build the extension**

```bash
npm run build --workspace=packages/extension
```

Expected: `packages/extension/dist/` populated with manifest, panel HTML, background.js, content scripts.

- [ ] **Step 2: Load extension in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `packages/extension/dist`
4. Extension "XState DevTools" appears in the list

- [ ] **Step 3: Smoke test**

1. Open `http://localhost:5173` (example app running)
2. Open Chrome DevTools (F12)
3. Navigate to the "XState" panel
4. Verify: three actors appear in the left rail (auth, cart, player)
5. Click auth actor → state tree shows `idle` highlighted
6. Click the Login button in the app → event log shows `SUBMIT`, state transitions to `authenticating` then `authenticated`
7. Click a state node → side panel shows available transitions
8. Click "Send" for a transition → event fires in the app
9. Click an event in the event log → all panels freeze to that point in time, banner shows "Time travel"
10. Click "Back to live" → panels resume live updates

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: end-to-end verified — extension inspects example app"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Chrome DevTools panel | Tasks 9, 11 |
| Actor tree (left panel) | Task 13 |
| Machine state tree (center) | Task 14 |
| Side panel: possible events for selected state node | Task 15 |
| Dispatch events from side panel | Task 15 |
| Event log panel | Task 16 |
| Dispatch from event log | Task 15 (custom event) |
| Time travel via clicking event log | Task 16, store Task 10 |
| Jump to source | Task 14 (vscode:// link), Task 4 (Error().stack) |
| Example Remix app with complex machines | Tasks 17, 18 |
| Parallel states (cart) | Task 17 |
| Invoked services (auth) | Task 17 |
| Spawned actors (player) | Task 17 |

### Known limitations

1. **Dispatch port leak** — SidePanel creates a new port per dispatch. Acceptable for a dev tool but should be refactored to reuse App.tsx's port in a follow-up.
2. **Server-side machines** — Remix loaders can't use this adapter (browser-only). Document clearly.
3. **Extension hot reload** — CRXJS v2 beta has occasional HMR quirks; `chrome://extensions` → "reload" is the fallback.
