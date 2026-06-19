// packages/adapter/src/react.tsx
import React, {
  createContext, useContext, useRef, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import {
  useMachine as useXStateMachine,
  useActorRef as useXStateActorRef,
  useSelector,
} from '@xstate/react'
import {
  createActor, type AnyStateMachine, type ActorOptions, type SnapshotFrom, type Actor,
} from 'xstate'
import { createAdapter } from './index.js'

type AdapterContext = ReturnType<typeof createAdapter> | null

const InspectorContext = createContext<AdapterContext>(null)

export function InspectorProvider({ children }: { children: ReactNode }) {
  const adapterRef = useRef<ReturnType<typeof createAdapter> | null>(null)
  if (!adapterRef.current && typeof window !== 'undefined') {
    adapterRef.current = createAdapter()
  }

  useEffect(() => {
    return () => {
      adapterRef.current?.dispose()
      adapterRef.current = null
    }
  }, [])

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

/**
 * Like {@link useInspectedMachine}, but opts the actor into **live rewind** from the
 * DevTools panel. When the panel sends a restore command, this hook recreates the actor
 * from the supplied XState persisted snapshot.
 *
 * Caveats (live rewind is experimental):
 * - The actor is *recreated*, not rewound in place — its identity (sessionId) changes and
 *   subscriptions re-fire from the restored state.
 * - Already-performed side effects (network calls, spawned children, messages sent to
 *   parents) are NOT undone. This restores machine state, not the outside world.
 *
 * Unlike `useInspectedMachine` (which delegates to `@xstate/react`'s `useMachine`), this
 * hook owns the actor instance so it can recreate it — `useMachine` creates its actor once
 * and ignores later `snapshot` changes.
 */
export function useRestorableInspectedMachine<T extends AnyStateMachine>(
  machine: T,
  options?: ActorOptions<T>
): [SnapshotFrom<T>, Actor<T>['send'], Actor<T>] {
  const adapter = useContext(InspectorContext)
  const restoreSnapshotRef = useRef<unknown>(options?.snapshot)
  const [generation, setGeneration] = useState(0)

  // Recreate the actor whenever `generation` bumps (i.e. on restore).
  const actorRef = useMemo(() => {
    return createActor(machine, {
      ...options,
      snapshot: restoreSnapshotRef.current,
      inspect: adapter?.inspect,
    } as ActorOptions<T>)
    // `machine`/`options` intentionally excluded — restore drives recreation via generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, adapter])

  useEffect(() => {
    actorRef.start()
    return () => { actorRef.stop() }
  }, [actorRef])

  // Register a restore handler keyed by the (current) actor's sessionId.
  useEffect(() => {
    if (!adapter?.registerRestore) return
    return adapter.registerRestore(actorRef.sessionId, (persisted) => {
      restoreSnapshotRef.current = persisted
      setGeneration((g) => g + 1)
    })
  }, [adapter, actorRef])

  const snapshot = useSelector(actorRef, (s) => s) as SnapshotFrom<T>
  return [snapshot, actorRef.send, actorRef]
}
