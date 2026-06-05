export type XStateObjectContext = 'machine' | 'state' | 'transition' | 'invoke' | 'setup';

export const XSTATE_MACHINE_PROPERTIES = [
    'id', 'initial', 'states', 'context', 'entry', 'exit', 'on', 'onDone', 'onError',
    'invoke', 'type', 'preserveActionOrder', 'output', 'schema', 'description',
    'meta', 'tags', 'version', 'tsTypes', 'predictableActionArguments', 'types'
] as const;

export const XSTATE_STATE_PROPERTIES = [
    'type', 'initial', 'states', 'entry', 'exit', 'on', 'onDone', 'onError',
    'invoke', 'description', 'meta', 'tags', 'always', 'after', 'output',
    'input', 'data', 'id'
] as const;

export const XSTATE_TRANSITION_PROPERTIES = [
    'target', 'guard', 'cond', 'actions', 'internal', 'reenter', 'in', 'description', 'meta'
] as const;

export const XSTATE_INVOKE_PROPERTIES = [
    'id', 'src', 'input', 'onDone', 'onError', 'data', 'autoForward', 'forward', 'systemId'
] as const;

export const XSTATE_SETUP_PROPERTIES = [
    'actions', 'guards', 'actors', 'delays', 'types'
] as const;

export function getValidPropertiesForContext(context: XStateObjectContext): readonly string[] {
    switch (context) {
        case 'machine':
            return XSTATE_MACHINE_PROPERTIES;
        case 'state':
            return XSTATE_STATE_PROPERTIES;
        case 'transition':
            return XSTATE_TRANSITION_PROPERTIES;
        case 'invoke':
            return XSTATE_INVOKE_PROPERTIES;
        case 'setup':
            return XSTATE_SETUP_PROPERTIES;
    }
}
