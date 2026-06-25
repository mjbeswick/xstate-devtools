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
  description: 'Controls a standard traffic light with pedestrian crossing support and a fault mode for power outages.',
  initial: 'green',
  context: { cycles: 0 },
  states: {
    green: {
      description: 'Traffic flows freely. Pedestrians must wait.',
      entry: 'logChange',
      on: {
        TIMER: 'yellow',
        POWER_OUTAGE: 'flashing',
      },
    },
    yellow: {
      description: 'Warning phase — traffic should slow and prepare to stop.',
      on: {
        TIMER: 'red',
        POWER_OUTAGE: 'flashing',
      },
    },
    red: {
      description: 'Traffic is stopped. Pedestrian crossing sequence runs as a nested region.',
      entry: 'countCycle',
      initial: 'walk',
      states: {
        walk: {
          description: 'Pedestrians may cross.',
          on: { TIMER: 'flashWarning' },
        },
        flashWarning: {
          description: 'Crossing signal flashes — pedestrians should finish crossing.',
          on: { TIMER: 'dontWalk' },
        },
        dontWalk: {
          description: 'Crossing is closed. Pedestrian sequence complete.',
          type: 'final',
        },
      },
      onDone: 'green',
      on: {
        POWER_OUTAGE: 'flashing',
      },
    },
    flashing: {
      description: 'Fault mode: light flashes amber due to a power outage. Night mode guard determines return target.',
      exit: 'logChange',
      on: {
        POWER_RESTORED: { target: 'red', guard: 'nightMode' },
      },
    },
  },
});
