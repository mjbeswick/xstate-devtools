import { describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import { createInspector, getSourceLocationFromStack, type Transport } from './core.js'

describe('createInspector', () => {
  it('sanitizes outbound inspection events before sending them to the transport', () => {
    const sent: unknown[] = []
    const transport: Transport = {
      send(message) {
        sent.push(message)
      },
      subscribe() {
        return () => {}
      },
    }

    const inspector = createInspector(transport, 'srv')
    const snapshot = { value: 'idle', context: {}, status: 'active' }
    const actorRef = {
      sessionId: 'actor-1',
      getSnapshot: vi.fn(() => snapshot),
    }

    const event: Record<string, unknown> = { type: 'route.changed' }
    event.self = event
    event.handler = function routeHandler() {}

    inspector.inspect({
      type: '@xstate.event',
      actorRef,
      event,
    })

    const message = sent.find(
      (candidate): candidate is { type: string; event: Record<string, unknown> } =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'type' in candidate &&
        (candidate as { type?: string }).type === 'XSTATE_EVENT',
    )

    expect(message).toBeDefined()
    expect(message?.event.type).toBe('route.changed')
    expect(message?.event.handler).toBe('[Function: routeHandler]')
    expect(message?.event.self).not.toBe(event)
  })

  it('sets a selected state node as active for machine actors', () => {
    const sent: unknown[] = []
    let handler: ((message: Parameters<Transport['subscribe']>[0]) => void) | undefined
    const transport: Transport = {
      send(message) {
        sent.push(message)
      },
      subscribe(callback) {
        handler = callback
        return () => {}
      },
    }

    const inspector = createInspector(transport, 'srv')
    const actor = createActor(
      createMachine({
        id: 'traffic',
        initial: 'green',
        states: {
          green: {},
          yellow: {},
          red: {},
        },
      }),
    )

    actor.start()
    inspector.inspect({ type: '@xstate.actor', actorRef: actor })

    handler?.({
      type: 'XSTATE_SET_ACTIVE_STATE',
      sessionId: `srv:${actor.sessionId}`,
      stateNodeId: 'traffic.red',
    })

    expect(actor.getSnapshot().value).toBe('red')

    const snapshotMessage = sent.find(
      (candidate): candidate is { type: string; snapshot: { value: unknown }; sessionId: string } =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'type' in candidate &&
        (candidate as { type?: string }).type === 'XSTATE_SNAPSHOT' &&
        'snapshot' in candidate,
    )
    expect(snapshotMessage).toBeDefined()
    expect(snapshotMessage?.sessionId).toBe(`srv:${actor.sessionId}`)
    expect(snapshotMessage?.snapshot.value).toBe('red')
  })
})

describe('getSourceLocationFromStack', () => {
  it('skips anonymous and node internal frames and returns filesystem frame', () => {
    const stack = [
      'Error',
      '    at getSourceLocation (packages/adapter/src/core.ts:10:1)',
      '    at inspect (packages/adapter/src/core.ts:20:1)',
      '    at Map.forEach (<anonymous>)',
      '    at WebSocket.emit (node:events:508:28)',
      '    at createMachine (/Users/me/project/app/machine.ts:12:3)',
    ].join('\n')

    expect(getSourceLocationFromStack(stack)).toBe(
      'createMachine (/Users/me/project/app/machine.ts:12:3)',
    )
  })

  it('accepts vite /@fs/ urls and ignores plain browser urls', () => {
    const stack = [
      'Error',
      '    at getSourceLocation (packages/adapter/src/core.ts:10:1)',
      '    at inspect (packages/adapter/src/core.ts:20:1)',
      '    at createMachine (http://localhost:5173/app/machines/auth.machine.ts:12:3)',
      '    at createMachine (http://localhost:5173/@fs/Users/me/project/app/machine.ts:12:3)',
    ].join('\n')

    expect(getSourceLocationFromStack(stack)).toBe(
      'createMachine (http://localhost:5173/@fs/Users/me/project/app/machine.ts:12:3)',
    )
  })

  it('maps plain browser app urls when a web source root is configured', () => {
    const stack = [
      'Error',
      '    at getSourceLocation (packages/adapter/src/core.ts:10:1)',
      '    at inspect (packages/adapter/src/core.ts:20:1)',
      '    at createMachine (http://localhost:5273/app/machines/auth.machine.ts:12:3)',
    ].join('\n')

    expect(
      getSourceLocationFromStack(stack, 'web', {
        webSourceRoot: '/Users/me/project/packages/example-remix',
      }),
    ).toBe(
      'createMachine (/Users/me/project/packages/example-remix/app/machines/auth.machine.ts:12:3)',
    )
  })

  it('returns undefined when no filesystem-backed frame exists', () => {
    const stack = [
      'Error',
      '    at getSourceLocation (packages/adapter/src/core.ts:10:1)',
      '    at inspect (packages/adapter/src/core.ts:20:1)',
      '    at Map.forEach (<anonymous>)',
      '    at WebSocket.emit (node:events:508:28)',
    ].join('\n')

    expect(getSourceLocationFromStack(stack)).toBeUndefined()
  })

  // --- Investigation tests for the "source link not appearing" bug ---
  // These tests simulate the realistic Vite/React/XState browser stack to
  // pinpoint why sourceLocation is undefined when inspecting machines in the
  // example app.

  it('skips vite pre-bundled xstate deps and finds user component frame', () => {
    // In Vite dev mode, XState and @xstate/react are pre-bundled and served at
    // /node_modules/.vite/deps/*.js, NOT at /node_modules/xstate/ or
    // /node_modules/@xstate/. isLibraryStackFrame misses these, but they must
    // still be skipped (via hasFilesystemBackedPath returning false).
    const stack = [
      'Error',
      '    at getSourceLocation (http://localhost:5273/@fs/Users/me/xstate-devtools/packages/adapter/src/core.ts:225:21)',
      '    at inspect (http://localhost:5273/@fs/Users/me/xstate-devtools/packages/adapter/src/core.ts:576:47)',
      '    at Actor._sendInspectionEvent (http://localhost:5273/node_modules/.vite/deps/xstate.js:123:45)',
      '    at new Actor (http://localhost:5273/node_modules/.vite/deps/xstate.js:234:12)',
      '    at createActor (http://localhost:5273/node_modules/.vite/deps/xstate.js:345:10)',
      '    at useIdleActorRef (http://localhost:5273/node_modules/.vite/deps/@xstate_react.js:67:23)',
      '    at useMachine (http://localhost:5273/node_modules/.vite/deps/@xstate_react.js:207:10)',
      '    at MediaPlayer (http://localhost:5273/app/components/MediaPlayer.tsx:6:43)',
      '    at renderWithHooks (http://localhost:5273/node_modules/.vite/deps/react-dom_client.js:456:22)',
    ].join('\n')

    expect(
      getSourceLocationFromStack(stack, 'web', {
        webSourceRoot: '/Users/me/xstate-devtools/packages/example-remix',
      }),
    ).toBe(
      'MediaPlayer (/Users/me/xstate-devtools/packages/example-remix/app/components/MediaPlayer.tsx:6:43)',
    )
  })

  it('returns undefined for vite pre-bundled stack without webSourceRoot', () => {
    // Without webSourceRoot, /app/ URLs cannot be remapped to filesystem paths,
    // so sourceLocation should be undefined and the source link hidden.
    const stack = [
      'Error',
      '    at getSourceLocation (http://localhost:5273/@fs/Users/me/xstate-devtools/packages/adapter/src/core.ts:225:21)',
      '    at inspect (http://localhost:5273/@fs/Users/me/xstate-devtools/packages/adapter/src/core.ts:576:47)',
      '    at new Actor (http://localhost:5273/node_modules/.vite/deps/xstate.js:234:12)',
      '    at useMachine (http://localhost:5273/node_modules/.vite/deps/@xstate_react.js:207:10)',
      '    at MediaPlayer (http://localhost:5273/app/components/MediaPlayer.tsx:6:43)',
    ].join('\n')

    // No webSourceRoot: plain /app/ browser URLs have no filesystem mapping.
    expect(getSourceLocationFromStack(stack, 'web')).toBeUndefined()
  })

  it('captures real Node.js stack from within a createActor inspect callback', () => {
    // This test runs in Node.js. It verifies:
    // 1. @xstate.actor fires synchronously during createActor (user code IS on stack)
    // 2. getSourceLocationFromStack finds a frame — but in this test environment,
    //    the test file itself is inside packages/adapter/ so it's filtered out by
    //    isLibraryStackFrame. The Vitest runner frame (node_modules/@vitest) is
    //    returned instead, which is the first "non-library" filesystem-backed frame.
    //    This is expected here; in production the first non-library frame is user
    //    component code (e.g. app/components/MediaPlayer.tsx).
    const machine = createMachine({ id: 'src-test', initial: 'idle', states: { idle: {} } })

    let capturedStack: string | undefined

    // createActor synchronously fires @xstate.actor in the Actor constructor.
    createActor(machine, {
      inspect(event) {
        if (event.type === '@xstate.actor') {
          capturedStack = new Error().stack
        }
      },
    })

    expect(capturedStack).toBeDefined()

    // Confirm @xstate.actor fires synchronously: capturedStack is set immediately.
    expect(capturedStack).toMatch(/@xstate\.actor|Actor|createActor/)

    const location = getSourceLocationFromStack(capturedStack, 'srv')

    // In this test env, the test file is filtered (it's in /packages/adapter/).
    // The function returns the Vitest runner frame as the first "non-library" frame.
    // This exposes a real limitation: the /packages/adapter/ filter also catches
    // test files. In a real browser, user component files at /app/ are not filtered.
    expect(location).toBeDefined()
  })

  it('shows that the test file itself is filtered by isLibraryStackFrame', () => {
    // This is an explicit documentation of the limitation: any frame inside
    // packages/adapter/ is treated as a library frame and skipped. This is
    // correct in production but means test-side assertions about "user code"
    // in these tests will see Vitest runner frames instead.
    const testFilePath = '/Users/me/xstate-devtools/packages/adapter/src/core.test.ts'
    const fakeStack = [
      'Error',
      '    at getSourceLocation (/Users/me/xstate-devtools/packages/adapter/src/core.ts:225:21)',
      '    at inspect (/Users/me/xstate-devtools/packages/adapter/src/core.ts:576:47)',
      `    at it (/Users/me/xstate-devtools/packages/adapter/src/core.test.ts:200:5)`,
      '    at runTest (file:///Users/me/xstate-devtools/node_modules/@vitest/runner/dist/index.js:146:14)',
    ].join('\n')

    // The test file frame is filtered because it contains '/packages/adapter/'
    // — so the Vitest runner frame is what gets returned.
    const location = getSourceLocationFromStack(fakeStack, 'srv')
    expect(location).toMatch(/vitest/)
    expect(location).not.toContain(testFilePath)
  })

  it('does not show source link when @xstate.actor fires inside useEffect (deferred start)', () => {
    // @xstate/react calls actorRef.start() inside React.useEffect, not during
    // createActor. If inspection fires at start() time instead of createActor
    // time, the React scheduler is on the stack and user code is NOT present.
    // This simulates what would happen if start() (not createActor) triggered
    // the @xstate.actor event.
    const stack = [
      'Error',
      '    at getSourceLocation (http://localhost:5273/@fs/Users/me/xstate-devtools/packages/adapter/src/core.ts:225:21)',
      '    at inspect (http://localhost:5273/@fs/Users/me/xstate-devtools/packages/adapter/src/core.ts:576:47)',
      '    at Actor.start (http://localhost:5273/node_modules/.vite/deps/xstate.js:300:8)',
      '    at useEffect (http://localhost:5273/node_modules/.vite/deps/@xstate_react.js:99:14)',
      // React scheduler — no user component frame at all
      '    at commitHookEffectListMount (http://localhost:5273/node_modules/.vite/deps/react-dom_client.js:22728:26)',
      '    at commitPassiveMountOnFiber (http://localhost:5273/node_modules/.vite/deps/react-dom_client.js:24502:13)',
    ].join('\n')

    // Without any /app/ user frame, sourceLocation should be undefined.
    expect(
      getSourceLocationFromStack(stack, 'web', {
        webSourceRoot: '/Users/me/xstate-devtools/packages/example-remix',
      }),
    ).toBeUndefined()
  })
})
