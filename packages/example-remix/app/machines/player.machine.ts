import { setup, assign, fromCallback } from 'xstate'

const bufferActor = fromCallback<
  { type: 'BUFFER_PROGRESS'; progress: number } | { type: 'BUFFER_COMPLETE' },
  { duration: number }
>(({ sendBack }) => {
  let progress = 0
  const interval = setInterval(() => {
    progress += 10
    sendBack({ type: 'BUFFER_PROGRESS', progress })
    if (progress >= 100) {
      sendBack({ type: 'BUFFER_COMPLETE' })
      clearInterval(interval)
    }
  }, 100)
  return () => clearInterval(interval)
})

export const playerMachine = setup({
  types: {
    context: {} as {
      src: string | null
      position: number
      duration: number
      bufferProgress: number
      volume: number
      rate: number
    },
    events: {} as
      | { type: 'LOAD'; src: string; duration: number }
      | { type: 'PLAY' }
      | { type: 'PAUSE' }
      | { type: 'PAUSE_AUTO' }
      | { type: 'SEEK'; position: number }
      | { type: 'SEEK_START' }
      | { type: 'SEEK_END' }
      | { type: 'STOP' }
      | { type: 'VOLUME'; level: number }
      | { type: 'RATE_NORMAL' }
      | { type: 'RATE_FAST' }
      | { type: 'BUFFER_PROGRESS'; progress: number }
      | { type: 'BUFFER_COMPLETE' },
  },
  actors: { bufferActor },
  actions: {
    loadSrc: assign(({ event }) => {
      if (event.type !== 'LOAD') return {}
      return { src: event.src, duration: event.duration, position: 0, bufferProgress: 0 }
    }),
    updatePosition: assign(({ event }) => {
      if (event.type !== 'SEEK') return {}
      return { position: event.position }
    }),
    updateVolume: assign(({ event }) => {
      if (event.type !== 'VOLUME') return {}
      return { volume: event.level }
    }),
    updateBufferProgress: assign(({ event }) => {
      if (event.type !== 'BUFFER_PROGRESS') return {}
      return { bufferProgress: event.progress }
    }),
    setRateNormal: assign({ rate: 1 }),
    setRateFast: assign({ rate: 2 }),
    resetPlayer: assign({ src: null, position: 0, duration: 0, bufferProgress: 0, rate: 1 }),
  },
}).createMachine({
  id: 'player',
  initial: 'idle',
  context: { src: null, position: 0, duration: 0, bufferProgress: 0, volume: 80, rate: 1 },
  states: {
    idle: {
      on: { LOAD: { target: 'buffering', actions: 'loadSrc' } },
    },
    buffering: {
      invoke: {
        id: 'buffer',
        src: 'bufferActor',
        input: ({ context }) => ({ duration: context.duration }),
      },
      on: {
        BUFFER_PROGRESS: { actions: 'updateBufferProgress' },
        BUFFER_COMPLETE: 'active',
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
    active: {
      initial: 'playing',
      on: {
        VOLUME: { actions: 'updateVolume' },
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
      states: {
        playing: {
          initial: 'normal',
          on: {
            PAUSE: '#player.active.paused.manual',
            PAUSE_AUTO: '#player.active.paused.autoBuffer',
          },
          states: {
            normal: {
              on: {
                SEEK_START: 'scrubbing',
                RATE_FAST: { target: 'fastForward', actions: 'setRateFast' },
                SEEK: { actions: 'updatePosition' },
              },
            },
            scrubbing: {
              on: {
                SEEK: { actions: 'updatePosition' },
                SEEK_END: 'normal',
              },
            },
            fastForward: {
              on: {
                RATE_NORMAL: { target: 'normal', actions: 'setRateNormal' },
                SEEK: { actions: 'updatePosition' },
              },
            },
          },
        },
        paused: {
          initial: 'manual',
          on: { PLAY: 'playing' },
          states: {
            manual: {
              on: { SEEK: { actions: 'updatePosition' } },
            },
            autoBuffer: {
              on: { SEEK: { actions: 'updatePosition' } },
            },
          },
        },
      },
    },
  },
})
