import { setup, assign, fromCallback } from 'xstate'

const bufferActor = fromCallback<any, { duration: number }>(({ sendBack, input }) => {
  let progress = 0
  const interval = setInterval(() => {
    progress += 10
    sendBack({ type: 'BUFFER_PROGRESS', progress })
    if (progress >= 100) {
      sendBack({ type: 'BUFFER_COMPLETE' })
      clearInterval(interval)
    }
  }, Math.max(50, input.duration / 10))
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
    },
    events: {} as
      | { type: 'LOAD'; src: string; duration: number }
      | { type: 'PLAY' }
      | { type: 'PAUSE' }
      | { type: 'SEEK'; position: number }
      | { type: 'STOP' }
      | { type: 'VOLUME'; level: number }
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
    resetPlayer: assign({ src: null, position: 0, duration: 0, bufferProgress: 0 }),
  },
}).createMachine({
  id: 'player',
  initial: 'idle',
  context: { src: null, position: 0, duration: 0, bufferProgress: 0, volume: 80 },
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
        BUFFER_COMPLETE: 'playing',
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
    playing: {
      on: {
        PAUSE: 'paused',
        SEEK: { actions: 'updatePosition' },
        VOLUME: { actions: 'updateVolume' },
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
    paused: {
      on: {
        PLAY: 'playing',
        SEEK: { actions: 'updatePosition' },
        STOP: { target: 'idle', actions: 'resetPlayer' },
      },
    },
  },
})
