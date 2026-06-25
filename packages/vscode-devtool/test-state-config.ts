import { createStateConfig, stateConfig } from 'xstate';

// XState v5 createStateConfig pattern
export const paymentState = createStateConfig({
  id: 'payment',
  initial: 'idle',
  states: {
    idle: {
      on: {
        START_PAYMENT: 'processing'
      }
    },
    processing: {
      invoke: {
        src: 'processPayment',
        onDone: 'success',
        onError: 'error'
      }
    },
    success: {
      type: 'final'
    },
    error: {
      on: {
        RETRY: 'processing',
        CANCEL: 'cancelled'
      }
    },
    cancelled: {
      type: 'final'
    }
  }
});

// Alternative stateConfig pattern
export const shippingState = stateConfig({
  id: 'shipping',
  initial: 'addressEntry',
  states: {
    addressEntry: {
      on: {
        SUBMIT: {
          target: 'validation',
          actions: ['saveAddress']
        }
      }
    },
    validation: {
      invoke: {
        src: 'validateAddress',
        onDone: 'confirmed',
        onError: 'addressEntry'
      }
    },
    confirmed: {
      type: 'final'
    }
  }
});

// journeySetup.createStateConfig pattern (like in mercury)
const journeySetup = {
  createStateConfig: createStateConfig
};

export const colleagueState = journeySetup.createStateConfig({
  id: 'colleague',
  initial: 'idle',
  context: {
    items: [],
    total: 0
  },
  states: {
    idle: {
      on: {
        SCAN_ITEM: {
          target: 'scanning',
          actions: ['addItem']
        }
      }
    },
    scanning: {
      after: {
        1000: 'idle'
      }
    }
  }
});
