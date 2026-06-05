// Test file for XState v5 setup pattern
import { setup, createMachine, fromPromise } from 'xstate';

// Pattern 1: Using setup().createMachine() with implementations
const setupMachine = setup({
  types: {} as {
    context: { count: number };
    events: { type: 'INCREMENT' } | { type: 'DECREMENT' };
  },
  actions: {
    increment: ({ context }) => {
      context.count++;
    },
    decrement: ({ context }) => {
      context.count--;
    }
  },
  guards: {
    canIncrement: ({ context }) => context.count < 100
  },
  actors: {
    fetchData: fromPromise(async () => {
      return { data: 'test' };
    })
  },
  delays: {
    RETRY_DELAY: 5000
  }
}).createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: 'increment',
          guard: 'canIncrement'
        },
        DECREMENT: {
          actions: 'decrement'
        }
      }
    }
  }
});

// Pattern 2: Stored setup variable
const mySetup = setup({
  actions: {
    logMessage: () => console.log('Message')
  }
});

export const machineFromSetup = mySetup.createMachine({
  id: 'fromSetup',
  initial: 'idle',
  states: {
    idle: {
      entry: 'logMessage',
      on: {
        START: 'active'
      }
    },
    active: {
      type: 'final'
    }
  }
});

// Pattern 3: XState v5 function-style context
export const v5Machine = createMachine({
  id: 'v5Example',
  context({ input }) {
    return {
      userId: input.userId,
      isLoading: false
    };
  },
  initial: 'checking',
  states: {
    checking: {
      on: {
        SUCCESS: 'ready'
      }
    },
    ready: {}
  }
});
