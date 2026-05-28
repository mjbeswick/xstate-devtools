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
      description: 'Notifications have not been set up yet.',
      on: {
        REQUEST_PERMISSION: 'requesting',
      },
    },
    requesting: {
      description: 'Prompting the user for notification permissions.',
      on: {
        GRANT: { target: 'enabled', actions: 'grantPermission' },
        DENY: { target: 'disabled', actions: 'denyPermission' },
      },
    },
    enabled: {
      description: 'Notifications are active and permission is granted.',
      on: {
        PUSH_MESSAGE: { actions: 'addUnread' },
        MARK_ALL_READ: { actions: 'clearUnread' },
        TOGGLE_QUIET: { actions: 'toggleQuietMode' },
      },
    },
    disabled: {
      description: 'Notifications are disabled or permission was denied.',
      on: {
        REQUEST_PERMISSION: 'requesting',
      },
    },
  },
})
