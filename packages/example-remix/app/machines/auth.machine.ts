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
        onDone: {
          target: 'authenticated',
          actions: assign({ token: ({ event }) => event.output.token }),
        },
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => (event.error as Error).message }),
        },
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
