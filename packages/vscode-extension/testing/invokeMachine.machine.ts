import { createMachine, fromPromise } from 'xstate';

// The invoked actor: loads a user. Defined here so the `invoke` resolves.
export const fetchUser = fromPromise(async () => {
  const response = await fetch('/api/user');
  return response.json();
});

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
        src: fetchUser,
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
