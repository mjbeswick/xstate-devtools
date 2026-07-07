// Sample XState machine for testing the extension
import { createMachine } from 'xstate';

// Guard functions
const isReady = (context: any) => {
  return context.timer > 0;
};

const noEmergency = (context: any) => {
  return !context.isEmergency;
};

// Action functions
const logGreen = () => console.log('Green light');
const logYellow = () => console.log('Yellow light');
const logRed = () => console.log('Red light');
const incrementTimer = (context: any) => ({ timer: context.timer + 1 });
const notifyDrivers = () => console.log('Notify drivers');
const clearNotification = () => console.log('Clear notification');
const startWarning = () => console.log('Start warning');
const stopWarning = () => console.log('Stop warning');

const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'green',
  context: {
    timer: 0,
    cycles: 0,
    isEmergency: false,
    config: {
      greenDuration: 30,
      yellowDuration: 5
    },
    history: []
  },
  states: {
    green: {
      entry: 'logGreen',
      on: {
        TIMER: {
          target: 'yellow',
          cond: 'isReady',
          actions: 'incrementTimer'
        },
        EMERGENCY: 'red'
      }
    },
    yellow: {
      entry: ['logYellow', 'startWarning'],
      exit: 'stopWarning',
      on: {
        TIMER: 'red'
      }
    },
    red: {
      entry: ['logRed', 'notifyDrivers'],
      exit: 'clearNotification',
      invoke: {
        src: 'checkEmergency',
        onDone: 'green'
      },
      on: {
        TIMER: {
          target: 'green',
          cond: 'noEmergency'
        }
      },
      states: {
        idle: {},
        flashing: {
          type: 'final'
        }
      }
    }
  }
});

// Authentication machine with inline options
const clearError = () => console.log('Clear error');
const showSpinner = () => console.log('Show spinner');
const hideSpinner = () => console.log('Hide spinner');
const setUser = () => console.log('Set user');
const setError = () => console.log('Set error');
const notifySuccess = () => console.log('Notify success');

const authMachine = createMachine({
  id: 'authentication',
  initial: 'loggedOut',
  context: {
    user: null,
    token: '',
    errorMessage: '',
    attemptCount: 0,
    settings: {
      rememberMe: true,
      timeout: 3600
    }
  },
  states: {
    loggedOut: {
      on: {
        LOGIN: {
          target: 'loggingIn',
          actions: 'clearError'
        }
      }
    },
    loggingIn: {
      entry: 'showSpinner',
      exit: 'hideSpinner',
      invoke: {
        src: 'authenticateUser',
        onDone: {
          target: 'loggedIn',
          actions: 'setUser'
        },
        onError: {
          target: 'loggedOut',
          actions: 'setError'
        }
      }
    },
    loggedIn: {
      entry: 'notifySuccess',
      on: {
        LOGOUT: 'loggedOut'
      }
    }
  }
});

export { trafficLightMachine, authMachine };
