import { assign, fromPromise, setup } from 'xstate'

const loginService = fromPromise<{ token: string }, { email: string; password: string }>(
  async ({ input }) => {
    await new Promise((r) => setTimeout(r, 1000))
    if (input.password === 'wrong') throw new Error('Invalid credentials')
    return { token: `fake-jwt-${input.email}` }
  },
)

const verifyMfa = fromPromise<{ ok: true }, { code: string }>(async ({ input }) => {
  await new Promise((r) => setTimeout(r, 600))
  if (input.code !== '123456') throw new Error('Invalid MFA code')
  return { ok: true }
})

export const authMachine = setup({
  types: {
    context: {} as {
      email: string
      password: string
      token: string | null
      error: string | null
      mfaCode: string
    },
    events: {} as
      | { type: 'SUBMIT'; email: string; password: string }
      | { type: 'LOGOUT' }
      | { type: 'RETRY' }
      | { type: 'MFA_SUBMIT'; code: string }
      | { type: 'VIEW_HOME' }
      | { type: 'VIEW_PROFILE' }
      | { type: 'VIEW_SETTINGS' }
      | { type: 'TAB_GENERAL' }
      | { type: 'TAB_SECURITY' }
      | { type: 'TAB_BILLING' }
      | { type: 'TOGGLE_2FA' },
  },
  actors: { loginService, verifyMfa },
  guards: {
    hasCredentials: ({ context }) => context.email.length > 0 && context.password.length > 0,
  },
  actions: {
    setCredentials: assign(({ event }) => {
      if (event.type !== 'SUBMIT') return {}
      return { email: event.email, password: event.password, error: null }
    }),
    setMfaCode: assign(({ event }) => {
      if (event.type !== 'MFA_SUBMIT') return {}
      return { mfaCode: event.code }
    }),
    clearCredentials: assign({
      email: '',
      password: '',
      token: null,
      error: null,
      mfaCode: '',
    }),
  },
}).createMachine({
  id: 'auth',
  initial: 'idle',
  context: { email: '', password: '', token: null, error: null, mfaCode: '' },
  states: {
    idle: {
      description: 'Waiting for the user to enter their email and password.',
      on: {
        SUBMIT: {
          target: 'authenticating',
          guard: 'hasCredentials',
          actions: 'setCredentials',
        },
      },
    },
    authenticating: {
      description: 'Verifying the user\'s credentials with the server.',
      initial: 'submittingCredentials',
      states: {
        submittingCredentials: {
          description: 'Sending email and password to the login service.',
          invoke: {
            id: 'login',
            src: 'loginService',
            input: ({ context }) => ({ email: context.email, password: context.password }),
            onDone: {
              target: 'awaitingMfa',
              actions: assign({ token: ({ event }) => event.output.token }),
            },
            onError: {
              target: '#auth.failed',
              actions: assign({ error: ({ event }) => (event.error as Error).message }),
            },
          },
        },
        awaitingMfa: {
          description: 'Credentials accepted — waiting for the user to enter their 6-digit MFA code.',
          on: {
            MFA_SUBMIT: { target: 'verifyingMfa', actions: 'setMfaCode' },
          },
        },
        verifyingMfa: {
          description: 'Validating the MFA code with the server.',
          invoke: {
            id: 'mfa',
            src: 'verifyMfa',
            input: ({ context }) => ({ code: context.mfaCode }),
            onDone: { target: '#auth.authenticated' },
            onError: {
              target: 'awaitingMfa',
              actions: assign({ error: ({ event }) => (event.error as Error).message }),
            },
          },
        },
      },
    },
    authenticated: {
      description: 'User is logged in and can navigate the app.',
      initial: 'active',
      on: { LOGOUT: { target: 'idle', actions: 'clearCredentials' } },
      states: {
        active: {
          description: 'The app is active and showing a page.',
          initial: 'home',
          states: {
            home: {
              description: 'User is on the home feed.',
              on: {
                VIEW_PROFILE: 'profile',
                VIEW_SETTINGS: 'settings',
              },
            },
            profile: {
              description: 'User is viewing their profile.',
              on: {
                VIEW_HOME: 'home',
                VIEW_SETTINGS: 'settings',
              },
            },
            settings: {
              description: 'User is in the settings dashboard.',
              initial: 'general',
              on: { VIEW_HOME: 'home', VIEW_PROFILE: 'profile' },
              states: {
                general: {
                  description: 'Showing general settings.',
                  on: { TAB_SECURITY: 'security', TAB_BILLING: 'billing' },
                },
                security: {
                  description: 'Showing security-related settings.',
                  initial: 'overview',
                  on: { TAB_GENERAL: 'general', TAB_BILLING: 'billing' },
                  states: {
                    overview: {
                      description: 'Security overview page.',
                      on: { TOGGLE_2FA: 'twoFactor' },
                    },
                    twoFactor: {
                      description: 'Two-factor authentication configuration.',
                      on: { TOGGLE_2FA: 'overview' },
                    },
                  },
                },
                billing: {
                  description: 'Showing billing and subscription details.',
                  on: { TAB_GENERAL: 'general', TAB_SECURITY: 'security' },
                },
              },
            },
          },
        },
      },
    },
    failed: {
      description: 'Login failed — shows an error message and allows the user to retry.',
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
