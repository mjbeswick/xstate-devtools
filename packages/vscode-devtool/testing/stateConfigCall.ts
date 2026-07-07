import { createStateConfig } from 'xstate';

export const reusableStates = createStateConfig({
    initial: 'idle',
    states: {
        idle: { on: { GO: 'busy' } },
        busy: { on: { DONE: 'idle' } },
    },
});
