// packages/adapter/src/react.tsx
import React, { createContext, useContext, useRef, useEffect, type ReactNode } from 'react'
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
