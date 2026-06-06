import { createMachine, assign } from 'xstate';

/**
 * Complex state machine with 100+ nested and parallel states,
 * multiple actions, guards, and events for testing the XState DevTools extension.
 */
export const complexMachine = createMachine(
  {
    id: 'applicationOrchestrator',
    initial: 'root',
    context: {
      count: 0,
      logs: [],
      activeModules: [],
      systemStatus: 'initializing',
      userRole: 'guest',
      permissions: [],
    },
    states: {
      root: {
        type: 'parallel',
        states: {
          applicationLayer: {
            initial: 'startup',
            states: {
              startup: {
                initial: 'loadingResources',
                states: {
                  loadingResources: {
                    initial: 'initializingCore',
                    states: {
                      initializingCore: {
                        on: {
                          CORE_READY: 'loadingConfig',
                        },
                      },
                      loadingConfig: {
                        on: {
                          CONFIG_LOADED: 'loadingAssets',
                        },
                      },
                      loadingAssets: {
                        on: {
                          ASSETS_READY: '#applicationOrchestrator.root.applicationLayer.authenticated',
                        },
                      },
                    },
                  },
                },
                on: {
                  STARTUP_ERROR: 'errorRecovery',
                },
              },
              authenticated: {
                type: 'parallel',
                states: {
                  sessionManager: {
                    initial: 'checkingAuth',
                    states: {
                      checkingAuth: {
                        on: {
                          AUTH_VALID: 'sessionActive',
                          AUTH_EXPIRED: 'sessionExpired',
                        },
                      },
                      sessionActive: {
                        on: {
                          LOGOUT: 'sessionEnded',
                          TOKEN_REFRESH: 'refreshingToken',
                          SESSION_TIMEOUT: 'sessionExpired',
                        },
                      },
                      refreshingToken: {
                        on: {
                          TOKEN_READY: 'sessionActive',
                          REFRESH_FAILED: 'sessionExpired',
                        },
                      },
                      sessionExpired: {
                        on: {
                          REAUTH: 'checkingAuth',
                        },
                      },
                      sessionEnded: {
                        type: 'final',
                      },
                    },
                  },
                  uiEngine: {
                    initial: 'idle',
                    states: {
                      idle: {
                        on: {
                          PAGE_LOAD: 'rendering',
                          MODAL_OPEN: 'renderingModal',
                        },
                      },
                      rendering: {
                        initial: 'parseDOM',
                        states: {
                          parseDOM: {
                            on: {
                              DOM_PARSED: 'applyStyles',
                            },
                          },
                          applyStyles: {
                            on: {
                              STYLES_APPLIED: 'attachEvents',
                            },
                          },
                          attachEvents: {
                            on: {
                              EVENTS_ATTACHED: 'renderComplete',
                            },
                          },
                          renderComplete: {
                            on: {
                              RENDER_DONE: '#applicationOrchestrator.root.applicationLayer.authenticated.uiEngine.idle',
                            },
                          },
                        },
                      },
                      renderingModal: {
                        initial: 'buildTemplate',
                        states: {
                          buildTemplate: {
                            on: {
                              TEMPLATE_BUILT: 'injectContent',
                            },
                          },
                          injectContent: {
                            on: {
                              CONTENT_INJECTED: 'displayModal',
                            },
                          },
                          displayModal: {
                            on: {
                              MODAL_CLOSED: '#applicationOrchestrator.root.applicationLayer.authenticated.uiEngine.idle',
                            },
                          },
                        },
                      },
                    },
                  },
                  dataLayer: {
                    type: 'parallel',
                    states: {
                      caching: {
                        initial: 'empty',
                        states: {
                          empty: {
                            on: {
                              DATA_FETCHED: 'cached',
                            },
                          },
                          cached: {
                            on: {
                              CACHE_INVALIDATE: 'empty',
                              CACHE_UPDATE: 'updating',
                            },
                          },
                          updating: {
                            on: {
                              UPDATE_COMPLETE: 'cached',
                            },
                          },
                        },
                      },
                      networking: {
                        initial: 'offline',
                        states: {
                          offline: {
                            on: {
                              CONNECTION_RESTORED: 'online',
                            },
                          },
                          online: {
                            initial: 'idle',
                            states: {
                              idle: {
                                on: {
                                  REQUEST_START: 'fetching',
                                },
                              },
                              fetching: {
                                on: {
                                  RESPONSE_SUCCESS: 'idle',
                                  RESPONSE_ERROR: 'errorHandler',
                                },
                              },
                              errorHandler: {
                                on: {
                                  RETRY: 'fetching',
                                  ABORT: 'idle',
                                },
                              },
                            },
                            on: {
                              CONNECTION_LOST: 'offline',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              errorRecovery: {
                initial: 'analyzing',
                states: {
                  analyzing: {
                    on: {
                      RECOVERY_POSSIBLE: 'recovering',
                      RECOVERY_IMPOSSIBLE: 'shuttingDown',
                    },
                  },
                  recovering: {
                    on: {
                      RECOVERY_SUCCESS: 'startup',
                      RECOVERY_FAILED: 'shutingDown',
                    },
                  },
                  shuttingDown: {
                    type: 'final',
                  },
                },
              },
            },
          },
          backgroundServices: {
            type: 'parallel',
            states: {
              analytics: {
                initial: 'monitoring',
                states: {
                  monitoring: {
                    on: {
                      ANALYTICS_EVENT: 'recording',
                    },
                  },
                  recording: {
                    on: {
                      BATCH_READY: 'sending',
                    },
                  },
                  sending: {
                    on: {
                      SEND_SUCCESS: 'monitoring',
                      SEND_FAILED: 'queuing',
                    },
                  },
                  queuing: {
                    on: {
                      RETRY_SEND: 'sending',
                    },
                  },
                },
              },
              logging: {
                initial: 'collecting',
                states: {
                  collecting: {
                    on: {
                      LOG_ENTRY: 'buffering',
                    },
                  },
                  buffering: {
                    on: {
                      BUFFER_FULL: 'flushing',
                      FLUSH_NOW: 'flushing',
                    },
                  },
                  flushing: {
                    on: {
                      FLUSH_COMPLETE: 'collecting',
                    },
                  },
                },
              },
              healthMonitor: {
                type: 'parallel',
                states: {
                  cpuMonitor: {
                    initial: 'idle',
                    states: {
                      idle: {
                        on: {
                          HIGH_CPU: 'warning',
                        },
                      },
                      warning: {
                        on: {
                          CPU_NORMAL: 'idle',
                          CRITICAL_CPU: 'alert',
                        },
                      },
                      alert: {
                        on: {
                          THROTTLE_ENABLED: 'throttled',
                          CPU_NORMAL: 'idle',
                        },
                      },
                      throttled: {
                        on: {
                          CPU_NORMAL: 'idle',
                        },
                      },
                    },
                  },
                  memoryMonitor: {
                    initial: 'idle',
                    states: {
                      idle: {
                        on: {
                          HIGH_MEMORY: 'warning',
                        },
                      },
                      warning: {
                        on: {
                          MEMORY_NORMAL: 'idle',
                          CRITICAL_MEMORY: 'alert',
                        },
                      },
                      alert: {
                        on: {
                          GC_TRIGGERED: 'cleaning',
                          MEMORY_NORMAL: 'idle',
                        },
                      },
                      cleaning: {
                        on: {
                          GC_COMPLETE: 'idle',
                        },
                      },
                    },
                  },
                  storageMonitor: {
                    initial: 'monitoring',
                    states: {
                      monitoring: {
                        on: {
                          STORAGE_LOW: 'warning',
                        },
                      },
                      warning: {
                        on: {
                          STORAGE_NORMAL: 'monitoring',
                          STORAGE_CRITICAL: 'pruning',
                        },
                      },
                      pruning: {
                        on: {
                          PRUNE_COMPLETE: 'monitoring',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          userInterface: {
            type: 'parallel',
            states: {
              navigation: {
                initial: 'home',
                states: {
                  home: {
                    on: {
                      GO_TO_DASHBOARD: 'dashboard',
                      GO_TO_SETTINGS: 'settings',
                      GO_TO_PROFILE: 'profile',
                      GO_TO_REPORTS: 'reports',
                    },
                  },
                  dashboard: {
                    on: {
                      GO_HOME: 'home',
                      GO_TO_SETTINGS: 'settings',
                      GO_TO_PROFILE: 'profile',
                      GO_TO_REPORTS: 'reports',
                    },
                  },
                  settings: {
                    on: {
                      GO_HOME: 'home',
                      GO_TO_DASHBOARD: 'dashboard',
                      GO_TO_PROFILE: 'profile',
                      GO_TO_REPORTS: 'reports',
                    },
                  },
                  profile: {
                    on: {
                      GO_HOME: 'home',
                      GO_TO_DASHBOARD: 'dashboard',
                      GO_TO_SETTINGS: 'settings',
                      GO_TO_REPORTS: 'reports',
                    },
                  },
                  reports: {
                    on: {
                      GO_HOME: 'home',
                      GO_TO_DASHBOARD: 'dashboard',
                      GO_TO_SETTINGS: 'settings',
                      GO_TO_PROFILE: 'profile',
                    },
                  },
                },
              },
              notifications: {
                initial: 'idle',
                states: {
                  idle: {
                    on: {
                      SHOW_NOTIFICATION: 'displaying',
                    },
                  },
                  displaying: {
                    on: {
                      DISMISS: 'idle',
                      AUTO_DISMISS: 'idle',
                      QUEUE_MORE: 'queued',
                    },
                  },
                  queued: {
                    on: {
                      SHOW_NEXT: 'displaying',
                      CLEAR_QUEUE: 'idle',
                    },
                  },
                },
              },
              themeManager: {
                initial: 'light',
                states: {
                  light: {
                    on: {
                      TOGGLE_DARK: 'dark',
                      TOGGLE_AUTO: 'auto',
                    },
                  },
                  dark: {
                    on: {
                      TOGGLE_LIGHT: 'light',
                      TOGGLE_AUTO: 'auto',
                    },
                  },
                  auto: {
                    on: {
                      TOGGLE_LIGHT: 'light',
                      TOGGLE_DARK: 'dark',
                    },
                  },
                },
              },
              accessibility: {
                type: 'parallel',
                states: {
                  screenReader: {
                    initial: 'disabled',
                    states: {
                      disabled: {
                        on: {
                          ENABLE_SCREEN_READER: 'enabled',
                        },
                      },
                      enabled: {
                        on: {
                          DISABLE_SCREEN_READER: 'disabled',
                        },
                      },
                    },
                  },
                  fontScaling: {
                    initial: 'normal',
                    states: {
                      small: {
                        on: {
                          INCREASE_FONT: 'normal',
                        },
                      },
                      normal: {
                        on: {
                          DECREASE_FONT: 'small',
                          INCREASE_FONT: 'large',
                        },
                      },
                      large: {
                        on: {
                          DECREASE_FONT: 'normal',
                        },
                      },
                    },
                  },
                  colorContrast: {
                    initial: 'standard',
                    states: {
                      standard: {
                        on: {
                          ENABLE_HIGH_CONTRAST: 'highContrast',
                        },
                      },
                      highContrast: {
                        on: {
                          DISABLE_HIGH_CONTRAST: 'standard',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          performanceMonitoring: {
            type: 'parallel',
            states: {
              frameRate: {
                initial: 'optimal',
                states: {
                  optimal: {
                    on: {
                      FPS_DEGRADED: 'warning',
                    },
                  },
                  warning: {
                    on: {
                      FPS_CRITICAL: 'critical',
                      FPS_RESTORED: 'optimal',
                    },
                  },
                  critical: {
                    on: {
                      ENABLE_PERFORMANCE_MODE: 'optimizing',
                      FPS_RESTORED: 'optimal',
                    },
                  },
                  optimizing: {
                    on: {
                      OPTIMIZATION_COMPLETE: 'optimal',
                    },
                  },
                },
              },
              memoryPressure: {
                initial: 'low',
                states: {
                  low: {
                    on: {
                      MEMORY_INCREASING: 'medium',
                    },
                  },
                  medium: {
                    on: {
                      MEMORY_DECREASING: 'low',
                      MEMORY_CRITICAL: 'high',
                    },
                  },
                  high: {
                    on: {
                      TRIGGER_CLEANUP: 'cleaning',
                      MEMORY_DECREASING: 'medium',
                    },
                  },
                  cleaning: {
                    on: {
                      CLEANUP_DONE: 'low',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    actions: {
      // Core application actions
      initializeCore: assign({ systemStatus: () => 'core_initialized' }),
      loadConfiguration: assign({ systemStatus: () => 'config_loaded' }),
      loadAssets: assign({ systemStatus: () => 'assets_loaded' }),
      startSession: assign({ systemStatus: () => 'session_started' }),

      // Authentication actions
      validateToken: assign({ userRole: () => 'authenticated' }),
      refreshToken: assign({ count: (ctx) => ctx.count + 1 }),
      expireSession: assign({ userRole: () => 'guest', count: () => 0 }),

      // UI Rendering actions
      parseDOM: assign({ logs: (ctx) => [...ctx.logs, 'DOM parsed'] }),
      applyStyles: assign({ logs: (ctx) => [...ctx.logs, 'Styles applied'] }),
      attachEventListeners: assign({ logs: (ctx) => [...ctx.logs, 'Events attached'] }),
      displayModal: assign({ logs: (ctx) => [...ctx.logs, 'Modal displayed'] }),
      closeModal: assign({ logs: (ctx) => [...ctx.logs, 'Modal closed'] }),

      // Data management actions
      fetchData: assign({ activeModules: (ctx) => [...ctx.activeModules, 'data'] }),
      updateCache: assign({ activeModules: (ctx) => [...ctx.activeModules, 'cache'] }),
      invalidateCache: assign({ activeModules: (ctx) => ctx.activeModules.filter((m) => m !== 'cache') }),

      // Network actions
      establishConnection: assign({ systemStatus: () => 'connected' }),
      closeConnection: assign({ systemStatus: () => 'disconnected' }),
      retryRequest: assign({ count: (ctx) => ctx.count + 1 }),

      // Analytics actions
      recordAnalytics: assign({ logs: (ctx) => [...ctx.logs, 'Analytics event'] }),
      sendAnalyticsBatch: assign({ logs: (ctx) => [...ctx.logs, 'Analytics batch sent'] }),
      queueAnalytics: assign({ logs: (ctx) => [...ctx.logs, 'Analytics queued'] }),

      // Logging actions
      collectLog: assign({ logs: (ctx) => [...ctx.logs, 'Log collected'] }),
      flushLogs: assign({ logs: () => [] }),

      // Monitoring actions
      checkCPUUsage: assign({ logs: (ctx) => [...ctx.logs, 'CPU checked'] }),
      checkMemoryUsage: assign({ logs: (ctx) => [...ctx.logs, 'Memory checked'] }),
      checkStorageUsage: assign({ logs: (ctx) => [...ctx.logs, 'Storage checked'] }),
      enableThrottling: assign({ activeModules: (ctx) => [...ctx.activeModules, 'throttling'] }),
      disableThrottling: assign({ activeModules: (ctx) => ctx.activeModules.filter((m) => m !== 'throttling') }),
      triggerGarbageCollection: assign({ logs: (ctx) => [...ctx.logs, 'GC triggered'] }),
      pruneStorage: assign({ logs: (ctx) => [...ctx.logs, 'Storage pruned'] }),

      // Permission actions
      grantPermission: assign({ permissions: (ctx, event: any) => [...ctx.permissions, event.permission] }),
      revokePermission: assign({ permissions: (ctx, event: any) => ctx.permissions.filter((p) => p !== event.permission) }),

      // Navigation actions
      navigateToHome: assign({ logs: (ctx) => [...ctx.logs, 'Navigated to home'] }),
      navigateToDashboard: assign({ logs: (ctx) => [...ctx.logs, 'Navigated to dashboard'] }),
      navigateToSettings: assign({ logs: (ctx) => [...ctx.logs, 'Navigated to settings'] }),
      navigateToProfile: assign({ logs: (ctx) => [...ctx.logs, 'Navigated to profile'] }),

      // Notification actions
      showNotification: assign({ logs: (ctx, event: any) => [...ctx.logs, `Notification: ${event.message}`] }),
      dismissNotification: assign({ logs: (ctx) => [...ctx.logs, 'Notification dismissed'] }),
    },
    guards: {
      // Authentication guards
      isAuthenticated: (ctx) => ctx.userRole !== 'guest',
      isAdmin: (ctx) => ctx.userRole === 'admin',
      hasPermission: (ctx, event: any) => ctx.permissions.includes(event.permission),

      // System health guards
      isCpuHealthy: (ctx) => ctx.count < 100,
      isMemoryHealthy: (ctx) => ctx.logs.length < 1000,
      isConnectionHealthy: (ctx) => ctx.activeModules.includes('data'),

      // State guards
      canProceed: (ctx) => ctx.systemStatus !== 'error',
      hasActiveSession: (ctx) => ctx.userRole !== 'guest',
    },
  }
);

/**
 * Alternative state config pattern (also supported)
 */
export const stateConfig = {
  id: 'complex-state-config',
  initial: 'root',
  states: {
    root: {
      initial: 'level1a',
      states: {
        level1a: {
          initial: 'level2a',
          states: {
            level2a: {
              initial: 'level3a',
              states: {
                level3a: {
                  on: { NEXT: 'level3b' },
                },
                level3b: {
                  on: { NEXT: 'level3c' },
                },
                level3c: {
                  on: { BACK: 'level3a' },
                },
              },
            },
            level2b: {
              initial: 'level3d',
              states: {
                level3d: {
                  on: { NEXT: 'level3e' },
                },
                level3e: {
                  on: { BACK: 'level3d' },
                },
              },
            },
          },
          on: { SWITCH: 'level1b' },
        },
        level1b: {
          initial: 'level2c',
          states: {
            level2c: {
              initial: 'level3f',
              states: {
                level3f: {
                  type: 'parallel',
                  states: {
                    region1: {
                      initial: 'state1',
                      states: {
                        state1: { on: { NEXT: 'state2' } },
                        state2: { on: { BACK: 'state1' } },
                      },
                    },
                    region2: {
                      initial: 'state3',
                      states: {
                        state3: { on: { NEXT: 'state4' } },
                        state4: { on: { BACK: 'state3' } },
                      },
                    },
                    region3: {
                      initial: 'state5',
                      states: {
                        state5: { on: { NEXT: 'state6' } },
                        state6: { on: { BACK: 'state5' } },
                      },
                    },
                  },
                },
              },
            },
          },
          on: { SWITCH: 'level1a' },
        },
      },
    },
  },
};
