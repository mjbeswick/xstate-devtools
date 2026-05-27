import { assign, setup } from 'xstate'

export const notificationsMachine = setup({
  types: {
    context: {} as {
      unread: number
      permission: 'default' | 'granted' | 'denied'
      quietMode: boolean
    },
    events: {} as
      | { type: 'REQUEST_PERMISSION' }
      | { type: 'GRANT' }
      | { type: 'DENY' }
      | { type: 'PUSH_MESSAGE' }
      | { type: 'MARK_ALL_READ' }
      | { type: 'TOGGLE_QUIET' },
  },
  actions: {
    grantPermission: assign({ permission: 'granted' }),
    denyPermission: assign({ permission: 'denied' }),
    addUnread: assign(({ context }) => ({ unread: context.unread + 1 })),
    clearUnread: assign({ unread: 0 }),
    toggleQuietMode: assign(({ context }) => ({ quietMode: !context.quietMode })),
  },
}).createMachine({
  id: 'notifications',
  initial: 'off',
  context: {
    unread: 0,
    permission: 'default',
    quietMode: false,
  },
  states: {
    off: {
      on: {
        REQUEST_PERMISSION: 'requesting',
      },
    },
    requesting: {
      on: {
        GRANT: { target: 'enabled', actions: 'grantPermission' },
        DENY: { target: 'disabled', actions: 'denyPermission' },
      },
    },
    enabled: {
      on: {
        PUSH_MESSAGE: { actions: 'addUnread' },
        MARK_ALL_READ: { actions: 'clearUnread' },
        TOGGLE_QUIET: { actions: 'toggleQuietMode' },
      },
    },
    disabled: {
      on: {
        REQUEST_PERMISSION: 'requesting',
      },
    },
  },
})
