import { createMachine } from 'xstate';

// Exercises invoke onDone/onError transitions on the diagram.
export const loaderMachine = createMachine({
  id: 'loader',
  initial: 'idle',
  states: {
    idle: {
      on: { FETCH: 'loading' },
    },
    loading: {
      invoke: {
        src: 'fetchUser',
        onDone: { target: 'success', actions: 'storeUser' },
        onError: { target: 'failure', actions: 'logError' },
      },
    },
    success: {
      on: { REFRESH: 'loading' },
    },
    failure: {
      on: { RETRY: 'loading' },
    },
  },
});
