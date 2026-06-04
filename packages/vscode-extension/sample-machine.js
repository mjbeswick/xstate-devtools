"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMachine = exports.trafficLightMachine = void 0;
// Sample XState machine for testing the extension
const xstate_1 = require("xstate");
const trafficLightMachine = (0, xstate_1.createMachine)({
    id: 'trafficLight',
    initial: 'green',
    context: {
        timer: 0
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
exports.trafficLightMachine = trafficLightMachine;
const authMachine = (0, xstate_1.createMachine)({
    id: 'authentication',
    initial: 'loggedOut',
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
exports.authMachine = authMachine;
//# sourceMappingURL=sample-machine.js.map