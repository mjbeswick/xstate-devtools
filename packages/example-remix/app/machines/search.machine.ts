import { assign, fromPromise, setup } from 'xstate'

const fakeSearch = fromPromise<string[], { query: string }>(async ({ input }) => {
  await new Promise((r) => setTimeout(r, 450))
  const q = input.query.trim().toLowerCase()
  if (q === 'fail') {
    throw new Error('Search request failed')
  }
  if (!q) return []

  return [`Result for ${q} #1`, `Result for ${q} #2`, `Result for ${q} #3`]
})

export const searchMachine = setup({
  types: {
    context: {} as {
      query: string
      results: string[]
      error: string | null
    },
    events: {} as { type: 'INPUT'; value: string } | { type: 'SEARCH' } | { type: 'CLEAR' },
  },
  actors: { fakeSearch },
  actions: {
    setInput: assign(({ event }) => {
      if (event.type !== 'INPUT') return {}
      return { query: event.value, error: null }
    }),
    clearAll: assign({ query: '', results: [], error: null }),
    setResults: assign(({ event }) => {
      if (event.type !== 'xstate.done.actor.search.request') return {}
      return { results: event.output, error: null }
    }),
    setError: assign(({ event }) => {
      if (event.type !== 'xstate.error.actor.search.request') return {}
      return { error: (event.error as Error).message, results: [] }
    }),
  },
}).createMachine({
  id: 'search',
  initial: 'idle',
  context: {
    query: '',
    results: [],
    error: null,
  },
  states: {
    idle: {
      on: {
        INPUT: { actions: 'setInput' },
        SEARCH: 'loading',
        CLEAR: { actions: 'clearAll' },
      },
    },
    loading: {
      invoke: {
        id: 'search.request',
        src: 'fakeSearch',
        input: ({ context }) => ({ query: context.query }),
        onDone: {
          target: 'ready',
          actions: 'setResults',
        },
        onError: {
          target: 'failed',
          actions: 'setError',
        },
      },
      on: {
        INPUT: { actions: 'setInput' },
      },
    },
    ready: {
      on: {
        INPUT: { actions: 'setInput' },
        SEARCH: 'loading',
        CLEAR: { target: 'idle', actions: 'clearAll' },
      },
    },
    failed: {
      on: {
        INPUT: { target: 'idle', actions: 'setInput' },
        SEARCH: 'loading',
        CLEAR: { target: 'idle', actions: 'clearAll' },
      },
    },
  },
})
