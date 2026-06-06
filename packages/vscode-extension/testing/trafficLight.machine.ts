import { assign, setup } from 'xstate';

/**
 * Small cyclic machine — good for eyeballing the basics of the diagram:
 * the initial-state arrow, a forward cycle (green → yellow → red), a nested
 * pedestrian region inside `red`, and backward/feedback edges (the fault
 * `flashing` state returning to `red`, and `red` looping back to `green`).
 */
export const trafficLightMachine = setup({
  types: {} as {
    context: { cycles: number };
    events:
      | { type: 'TIMER' }
      | { type: 'POWER_OUTAGE' }
      | { type: 'POWER_RESTORED' };
  },
  actions: {
    countCycle: assign({ cycles: ({ context }) => context.cycles + 1 }),
    logChange: () => {},
  },
  guards: {
    nightMode: () => false,
  },
}).createMachine({
  id: 'trafficLight',
  initial: 'green',
  context: { cycles: 0 },
  states: {
    green: {
      entry: 'logChange',
      on: {
        TIMER: 'yellow',
        POWER_OUTAGE: 'flashing',
      },
    },
    yellow: {
      on: {
        TIMER: 'red',
        POWER_OUTAGE: 'flashing',
      },
    },
    red: {
      entry: 'countCycle',
      initial: 'walk',
      states: {
        walk: { on: { TIMER: 'flashWarning' } },
        flashWarning: { on: { TIMER: 'dontWalk' } },
        dontWalk: { type: 'final' },
      },
      onDone: 'green',
      on: {
        POWER_OUTAGE: 'flashing',
      },
    },
    flashing: {
      exit: 'logChange',
      on: {
        POWER_RESTORED: { target: 'red', guard: 'nightMode' },
      },
    },
  },
});
