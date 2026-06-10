import * as ts from 'typescript';
import * as vscode from 'vscode';
import {
    getValidPropertiesForContext,
    type XStateObjectContext,
} from './xstateSchema';

export const XSTATE_DIAGNOSTIC_SOURCE = 'xstate';
export const XSTATE_DIAGNOSTIC_CODES = {
    invalidProperty: 'xstate.invalidProperty',
    condDeprecated: 'xstate.condDeprecated',
    unknownAction: 'xstate.unknownAction',
    unknownGuard: 'xstate.unknownGuard',
    unknownActor: 'xstate.unknownActor',
    duplicateId: 'xstate.duplicateId',
    unusedAction: 'xstate.unusedAction',
    unusedGuard: 'xstate.unusedGuard',
    unusedActor: 'xstate.unusedActor',
    unreachableState: 'xstate.unreachableState',
} as const;

interface SetupReferences {
    actions: Map<string, { used: boolean, range: vscode.Range }>;
    guards: Map<string, { used: boolean, range: vscode.Range }>;
    actors: Map<string, { used: boolean, range: vscode.Range }>;
}

interface ValidationContext {
    document: vscode.TextDocument;
    diagnostics: vscode.Diagnostic[];
    explicitIds: Map<string, vscode.Range>;
    setupReferences?: SetupReferences;
}

interface ReferenceCandidate {
    name: string;
    node: ts.Node;
}

const SUPPORTED_LANGUAGE_IDS = new Set([
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
]);

export function isSupportedXStateDocument(document: vscode.TextDocument): boolean {
    return document.uri.scheme === 'file' && SUPPORTED_LANGUAGE_IDS.has(document.languageId);
}

export function validateXStateDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
    const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true,
        getScriptKind(document)
    );

    const diagnostics: vscode.Diagnostic[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callKind = getMachineCallKind(node);
            const [configArg] = node.arguments;

            if (callKind && configArg && ts.isObjectLiteralExpression(configArg)) {
                if (callKind === 'machine') {
                    const setupConfig = getSetupConfig(node);
                    const context: ValidationContext = {
                        document,
                        diagnostics,
                        explicitIds: new Map<string, vscode.Range>(),
                        setupReferences: setupConfig ? collectSetupReferences(setupConfig, document) : undefined,
                    };

                    if (setupConfig) {
                        validateSetupConfig(setupConfig, context);
                    }
                    validateMachineConfig(configArg, context);
                    checkUnusedSetup(context);
                    checkUnreachableStates(configArg, context);
                } else {
                    validateStateConfig(configArg, {
                        document,
                        diagnostics,
                        explicitIds: new Map<string, vscode.Range>(),
                    });
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return diagnostics;
}

function validateMachineConfig(config: ts.ObjectLiteralExpression, context: ValidationContext): void {
    validateInvalidProperties(config, 'machine', context);
    validateExplicitId(config, context);
    validateActionProperty(findPropertyAssignment(config, 'entry')?.initializer, context);
    validateActionProperty(findPropertyAssignment(config, 'exit')?.initializer, context);
    validateTransitionMap(findPropertyAssignment(config, 'on')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(config, 'onDone')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(config, 'onError')?.initializer, context);
    validateInvokeProperty(findPropertyAssignment(config, 'invoke')?.initializer, context);

    const statesProperty = findPropertyAssignment(config, 'states');
    if (statesProperty && ts.isObjectLiteralExpression(statesProperty.initializer)) {
        validateStatesObject(statesProperty.initializer, context);
    }
}

function validateStateConfig(config: ts.ObjectLiteralExpression, context: ValidationContext): void {
    validateInvalidProperties(config, 'state', context);
    validateExplicitId(config, context);
    validateActionProperty(findPropertyAssignment(config, 'entry')?.initializer, context);
    validateActionProperty(findPropertyAssignment(config, 'exit')?.initializer, context);
    validateTransitionMap(findPropertyAssignment(config, 'on')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(config, 'always')?.initializer, context);
    validateTransitionMap(findPropertyAssignment(config, 'after')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(config, 'onDone')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(config, 'onError')?.initializer, context);
    validateInvokeProperty(findPropertyAssignment(config, 'invoke')?.initializer, context);

    const statesProperty = findPropertyAssignment(config, 'states');
    if (statesProperty && ts.isObjectLiteralExpression(statesProperty.initializer)) {
        validateStatesObject(statesProperty.initializer, context);
    }
}

function validateSetupConfig(config: ts.ObjectLiteralExpression, context: ValidationContext): void {
    validateInvalidProperties(config, 'setup', context);
}

function validateStatesObject(statesObject: ts.ObjectLiteralExpression, context: ValidationContext): void {
    for (const property of statesObject.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
            continue;
        }
        validateStateConfig(property.initializer, context);
    }
}

function validateTransitionMap(node: ts.Expression | undefined, context: ValidationContext): void {
    if (!node || !ts.isObjectLiteralExpression(node)) {
        return;
    }

    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        validateTransitionValue(property.initializer, context);
    }
}

function validateTransitionValue(node: ts.Expression | undefined, context: ValidationContext): void {
    if (!node) {
        return;
    }

    if (ts.isStringLiteralLike(node)) {
        return;
    }

    if (ts.isObjectLiteralExpression(node)) {
        validateTransitionObject(node, context);
        return;
    }

    if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
            if (ts.isObjectLiteralExpression(element)) {
                validateTransitionObject(element, context);
            }
        }
    }
}

function validateTransitionObject(node: ts.ObjectLiteralExpression, context: ValidationContext): void {
    validateInvalidProperties(node, 'transition', context);

    const condProperty = findNamedProperty(node, 'cond');
    if (condProperty) {
        const range = propertyNameRange(context.document, condProperty.name);
        const diagnostic = createDiagnostic(
            range,
            "'cond' is deprecated here; use 'guard' instead.",
            XSTATE_DIAGNOSTIC_CODES.condDeprecated,
            vscode.DiagnosticSeverity.Information
        );
        diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
        context.diagnostics.push(diagnostic);
    }

    validateGuardProperty(findPropertyAssignment(node, 'guard')?.initializer ?? findPropertyAssignment(node, 'cond')?.initializer, context);
    validateActionProperty(findPropertyAssignment(node, 'actions')?.initializer, context);
}

function validateInvokeProperty(node: ts.Expression | undefined, context: ValidationContext): void {
    if (!node) {
        return;
    }

    if (ts.isObjectLiteralExpression(node)) {
        validateInvokeObject(node, context);
        return;
    }

    if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
            if (ts.isObjectLiteralExpression(element)) {
                validateInvokeObject(element, context);
            }
        }
    }
}

function validateInvokeObject(node: ts.ObjectLiteralExpression, context: ValidationContext): void {
    validateInvalidProperties(node, 'invoke', context);
    validateActorProperty(findPropertyAssignment(node, 'src')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(node, 'onDone')?.initializer, context);
    validateTransitionValue(findPropertyAssignment(node, 'onError')?.initializer, context);
}

function validateActionProperty(node: ts.Expression | undefined, context: ValidationContext): void {
    const knownActions = context.setupReferences?.actions;
    if (!node || !knownActions) {
        return;
    }

    for (const candidate of collectActionReferences(node)) {
        if (knownActions.has(candidate.name)) {
            knownActions.get(candidate.name)!.used = true;
            continue;
        }

        context.diagnostics.push(createDiagnostic(
            nodeRange(context.document, candidate.node),
            `Unknown action reference '${candidate.name}' in setup().`,
            XSTATE_DIAGNOSTIC_CODES.unknownAction,
            vscode.DiagnosticSeverity.Error
        ));
    }
}

function validateGuardProperty(node: ts.Expression | undefined, context: ValidationContext): void {
    const knownGuards = context.setupReferences?.guards;
    if (!node || !knownGuards) {
        return;
    }

    const candidate = collectSimpleReference(node);
    if (!candidate) {
        return;
    }
    
    if (knownGuards.has(candidate.name)) {
        knownGuards.get(candidate.name)!.used = true;
        return;
    }

    context.diagnostics.push(createDiagnostic(
        nodeRange(context.document, candidate.node),
        `Unknown guard reference '${candidate.name}' in setup().`,
        XSTATE_DIAGNOSTIC_CODES.unknownGuard,
        vscode.DiagnosticSeverity.Error
    ));
}

function validateActorProperty(node: ts.Expression | undefined, context: ValidationContext): void {
    const knownActors = context.setupReferences?.actors;
    if (!node || !knownActors) {
        return;
    }

    const candidate = collectSimpleReference(node);
    if (!candidate) {
        return;
    }
    
    if (knownActors.has(candidate.name)) {
        knownActors.get(candidate.name)!.used = true;
        return;
    }

    context.diagnostics.push(createDiagnostic(
        nodeRange(context.document, candidate.node),
        `Unknown actor reference '${candidate.name}' in setup().`,
        XSTATE_DIAGNOSTIC_CODES.unknownActor,
        vscode.DiagnosticSeverity.Error
    ));
}

function checkUnusedSetup(context: ValidationContext): void {
    if (!context.setupReferences) return;

    const check = (map: Map<string, { used: boolean, range: vscode.Range }>, type: string, code: string) => {
        for (const [name, info] of map.entries()) {
            if (!info.used) {
                const diagnostic = createDiagnostic(
                    info.range,
                    `${type} '${name}' is defined in setup() but never used.`,
                    code
                );
                diagnostic.severity = vscode.DiagnosticSeverity.Hint;
                diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
                context.diagnostics.push(diagnostic);
            }
        }
    };

    check(context.setupReferences.actions, 'Action', XSTATE_DIAGNOSTIC_CODES.unusedAction);
    check(context.setupReferences.guards, 'Guard', XSTATE_DIAGNOSTIC_CODES.unusedGuard);
    check(context.setupReferences.actors, 'Actor', XSTATE_DIAGNOSTIC_CODES.unusedActor);
}

/** A node in the machine's state hierarchy, used for reachability analysis. */
interface StateInfo {
    name: string;
    range: vscode.Range;
    parent?: StateInfo;
    children: StateInfo[];
    initialChild?: string;
    isParallel: boolean;
    targets: string[];   // raw target strings of this state's own transitions
    id?: string;         // explicit `id`
}

function getStringProperty(config: ts.ObjectLiteralExpression, name: string): string | undefined {
    const prop = findPropertyAssignment(config, name);
    return prop && ts.isStringLiteralLike(prop.initializer) ? prop.initializer.text : undefined;
}

/** Collect every target string reachable from one transition value (string / object / array). */
function collectTransitionTargets(node: ts.Expression | undefined, out: string[]): void {
    if (!node) { return; }
    if (ts.isStringLiteralLike(node)) { out.push(node.text); return; }
    if (ts.isObjectLiteralExpression(node)) {
        const target = findPropertyAssignment(node, 'target');
        if (target && ts.isStringLiteralLike(target.initializer)) {
            out.push(target.initializer.text);
        } else if (target && ts.isArrayLiteralExpression(target.initializer)) {
            for (const elem of target.initializer.elements) {
                if (ts.isStringLiteralLike(elem)) { out.push(elem.text); }
            }
        }
        return;
    }
    if (ts.isArrayLiteralExpression(node)) {
        for (const elem of node.elements) { collectTransitionTargets(elem, out); }
    }
}

/** All transition targets declared on a single state config (on / always / after / invoke / onDone / onError). */
function collectStateTargets(config: ts.ObjectLiteralExpression): string[] {
    const out: string[] = [];

    for (const mapKey of ['on', 'after']) {
        const map = findPropertyAssignment(config, mapKey)?.initializer;
        if (map && ts.isObjectLiteralExpression(map)) {
            for (const prop of map.properties) {
                if (ts.isPropertyAssignment(prop)) { collectTransitionTargets(prop.initializer, out); }
            }
        }
    }

    for (const key of ['always', 'onDone', 'onError']) {
        collectTransitionTargets(findPropertyAssignment(config, key)?.initializer, out);
    }

    const invoke = findPropertyAssignment(config, 'invoke')?.initializer;
    const invokeObjects: ts.ObjectLiteralExpression[] = [];
    if (invoke && ts.isObjectLiteralExpression(invoke)) {
        invokeObjects.push(invoke);
    } else if (invoke && ts.isArrayLiteralExpression(invoke)) {
        for (const elem of invoke.elements) {
            if (ts.isObjectLiteralExpression(elem)) { invokeObjects.push(elem); }
        }
    }
    for (const obj of invokeObjects) {
        collectTransitionTargets(findPropertyAssignment(obj, 'onDone')?.initializer, out);
        collectTransitionTargets(findPropertyAssignment(obj, 'onError')?.initializer, out);
    }

    return out;
}

/** Build a StateInfo tree from a machine/state config object. */
function buildStateInfo(
    name: string,
    range: vscode.Range,
    config: ts.ObjectLiteralExpression,
    document: vscode.TextDocument,
    parent: StateInfo | undefined,
): StateInfo {
    const info: StateInfo = {
        name,
        range,
        parent,
        children: [],
        initialChild: getStringProperty(config, 'initial'),
        isParallel: getStringProperty(config, 'type') === 'parallel',
        targets: collectStateTargets(config),
        id: getStringProperty(config, 'id'),
    };

    const states = findPropertyAssignment(config, 'states')?.initializer;
    if (states && ts.isObjectLiteralExpression(states)) {
        for (const property of states.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) { continue; }
            const childName = getPropertyName(property.name);
            if (!childName) { continue; }
            info.children.push(buildStateInfo(
                childName,
                propertyNameRange(document, property.name),
                property.initializer,
                document,
                info,
            ));
        }
    }

    return info;
}

/**
 * Flag states that cannot be entered from the machine's initial configuration.
 *
 * This is a true reachability walk, not a "targeted anywhere" check: starting at
 * the machine's initial state(s), it follows transition targets (and initial-state
 * chains / parallel regions) to a fixpoint. A state targeted only by an otherwise
 * unreachable state is therefore still flagged — transitively-orphaned clusters are
 * caught. Targets resolve by bare name (last path segment) or explicit `id`, matching
 * the resolution used elsewhere in the extension.
 */
/**
 * True if the machine composes its states or transitions via object spreads
 * (`states: { ...shared }`, `on: { ...handlers }`). Such configs are only partly
 * visible to static analysis, so reachability can't be computed soundly — bail
 * rather than emit false "unreachable" warnings.
 */
function hasStructuralSpread(config: ts.ObjectLiteralExpression): boolean {
    let found = false;
    const visit = (obj: ts.ObjectLiteralExpression, spreadMatters: boolean): void => {
        for (const property of obj.properties) {
            if (found) { return; }
            if (ts.isSpreadAssignment(property)) {
                if (spreadMatters) { found = true; }
                continue;
            }
            if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
                const name = getPropertyName(property.name);
                visit(property.initializer, name === 'states' || name === 'on' || name === 'after');
            }
        }
    };
    visit(config, false);
    return found;
}

function checkUnreachableStates(machineConfig: ts.ObjectLiteralExpression, context: ValidationContext): void {
    if (hasStructuralSpread(machineConfig)) { return; }

    const dummyRange = new vscode.Range(0, 0, 0, 0);
    const root = buildStateInfo('(machine)', dummyRange, machineConfig, context.document, undefined);

    const all: StateInfo[] = [];
    (function collect(state: StateInfo) {
        for (const child of state.children) { all.push(child); collect(child); }
    })(root);
    if (all.length === 0) { return; }

    // Index states by explicit id (absolute `#id` targets). State *names* are NOT
    // globally unique — the same name (idle, load, retry, …) recurs in every region —
    // so targets must be resolved by scope, not by a flat name lookup.
    const byId = new Map<string, StateInfo>();
    if (root.id) { byId.set(root.id, root); }
    for (const state of all) {
        if (state.id) { byId.set(state.id, state); }
    }

    // Walk `segs` down from a scope node's descendants.
    const descend = (scope: StateInfo | undefined, segs: string[]): StateInfo | undefined => {
        let node = scope;
        for (const seg of segs) {
            if (!node) { return undefined; }
            node = node.children.find(c => c.name === seg);
        }
        return node;
    };

    // Resolve a transition target the way XState does, relative to its source state:
    //   '#id' / '#id.a.b'  → absolute, by explicit id then descend
    //   '.child'           → relative to the source's own descendants
    //   'sibling' / 'a.b'  → relative to the source's parent (siblings); the machine
    //                        root resolves against its own children (top-level states)
    const resolveTarget = (source: StateInfo, raw: string): StateInfo | undefined => {
        if (!raw) { return undefined; }
        if (raw.startsWith('#')) {
            const segs = raw.slice(1).split('.').filter(Boolean);
            return segs.length ? descend(byId.get(segs[0]), segs.slice(1)) : undefined;
        }
        if (raw.startsWith('.')) {
            return descend(source, raw.slice(1).split('.').filter(Boolean));
        }
        const segs = raw.split('.').filter(Boolean);
        return segs.length ? descend(source.parent ?? source, segs) : undefined;
    };

    const reachable = new Set<StateInfo>();
    const entered = new Set<StateInfo>(); // states whose initial configuration we've entered
    const enterInitialConfig = (state: StateInfo): void => {
        if (entered.has(state)) { return; }
        entered.add(state);
        if (state.children.length === 0) { return; }
        if (state.isParallel) {
            for (const child of state.children) { activate(child); }
            return;
        }
        const initial = (state.initialChild && state.children.find(c => c.name === state.initialChild))
            || state.children[0];
        if (initial) { activate(initial); }
    };
    const activate = (state: StateInfo): void => {
        // Mark this state and its ancestors active (you cannot be in a child without
        // its parents) — but don't enter the ancestors' initial config; we arrived via
        // a specific path, not their default entry.
        let cursor: StateInfo | undefined = state;
        while (cursor && cursor !== root && !reachable.has(cursor)) {
            reachable.add(cursor);
            cursor = cursor.parent;
        }
        reachable.add(state);
        // Entering a state enters its initial configuration. This runs even if the
        // state was already reachable as an ancestor of a deeper target — a later
        // direct/plain target genuinely enters its initial child.
        enterInitialConfig(state);
    };

    // The machine root is always active, so its own `on` handlers are always live —
    // include it as a transition source (it is never itself flagged: `all` excludes it).
    reachable.add(root);
    enterInitialConfig(root);

    // Follow transitions to a fixpoint. activate() is idempotent (guarded by the
    // reachable/entered sets), so re-run rounds until nothing new is added.
    for (let size = -1; size !== reachable.size + entered.size; ) {
        size = reachable.size + entered.size;
        for (const state of [...reachable]) {
            for (const target of state.targets) {
                const dest = resolveTarget(state, target);
                if (dest) { activate(dest); }
            }
        }
    }

    for (const state of all) {
        if (reachable.has(state)) { continue; }
        const diagnostic = createDiagnostic(
            state.range,
            `State '${state.name}' appears to be unreachable. It cannot be entered from the machine's initial state.`,
            XSTATE_DIAGNOSTIC_CODES.unreachableState
        );
        diagnostic.severity = vscode.DiagnosticSeverity.Warning;
        context.diagnostics.push(diagnostic);
    }
}

function validateExplicitId(node: ts.ObjectLiteralExpression, context: ValidationContext): void {
    const idProperty = findPropertyAssignment(node, 'id');
    if (!idProperty || !ts.isStringLiteralLike(idProperty.initializer)) {
        return;
    }

    const idValue = idProperty.initializer.text;
    const existingRange = context.explicitIds.get(idValue);
    const currentRange = nodeRange(context.document, idProperty.initializer);

    if (!existingRange) {
        context.explicitIds.set(idValue, currentRange);
        return;
    }

    context.diagnostics.push(createDiagnostic(
        currentRange,
        `Duplicate explicit id '${idValue}' in this machine.`,
        XSTATE_DIAGNOSTIC_CODES.duplicateId,
        vscode.DiagnosticSeverity.Error
    ));
}

function validateInvalidProperties(
    node: ts.ObjectLiteralExpression,
    objectContext: XStateObjectContext,
    context: ValidationContext
): void {
    const validProperties = new Set(getValidPropertiesForContext(objectContext));

    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) {
            continue;
        }

        const propertyName = getPropertyName(property.name);
        if (!propertyName || validProperties.has(propertyName)) {
            continue;
        }

        const diagnostic = createDiagnostic(
            propertyNameRange(context.document, property.name),
            `Invalid ${objectContext} property '${propertyName}'.`,
            XSTATE_DIAGNOSTIC_CODES.invalidProperty
        );
        context.diagnostics.push(diagnostic);
    }
}

function collectSetupReferences(setupConfig: ts.ObjectLiteralExpression, document: vscode.TextDocument): SetupReferences {
    return {
        actions: collectSetupSectionKeys(setupConfig, 'actions', document),
        guards: collectSetupSectionKeys(setupConfig, 'guards', document),
        actors: collectSetupSectionKeys(setupConfig, 'actors', document),
    };
}

function collectSetupSectionKeys(setupConfig: ts.ObjectLiteralExpression, sectionName: 'actions' | 'guards' | 'actors', document: vscode.TextDocument): Map<string, { used: boolean, range: vscode.Range }> {
    const keys = new Map<string, { used: boolean, range: vscode.Range }>();
    const section = findPropertyAssignment(setupConfig, sectionName);

    if (!section || !ts.isObjectLiteralExpression(section.initializer)) {
        return keys;
    }

    for (const property of section.initializer.properties) {
        // Accept every way a setup entry can be written:
        //   foo: () => {}            PropertyAssignment
        //   foo() {}                 MethodDeclaration (shorthand)
        //   foo                      ShorthandPropertyAssignment ({ foo })
        if (
            !ts.isPropertyAssignment(property) &&
            !ts.isMethodDeclaration(property) &&
            !ts.isShorthandPropertyAssignment(property)
        ) {
            continue;
        }

        const name = getPropertyName(property.name);
        if (name) {
            keys.set(name, {
                used: false,
                range: propertyNameRange(document, property.name)
            });
        }
    }

    return keys;
}

function collectActionReferences(node: ts.Expression): ReferenceCandidate[] {
    if (ts.isArrayLiteralExpression(node)) {
        return node.elements.flatMap((element) => {
            if (ts.isStringLiteralLike(element) || ts.isIdentifier(element)) {
                return [{ name: element.text, node: element }];
            }

            if (ts.isObjectLiteralExpression(element)) {
                return collectActionObjectReference(element);
            }

            return [];
        });
    }

    if (ts.isObjectLiteralExpression(node)) {
        return collectActionObjectReference(node);
    }

    const candidate = collectSimpleReference(node);
    return candidate ? [candidate] : [];
}

function collectActionObjectReference(node: ts.ObjectLiteralExpression): ReferenceCandidate[] {
    const typeProperty = findPropertyAssignment(node, 'type');
    if (!typeProperty) {
        return [];
    }

    const candidate = collectSimpleReference(typeProperty.initializer);
    return candidate ? [candidate] : [];
}

function collectSimpleReference(node: ts.Node): ReferenceCandidate | undefined {
    if (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) {
        return { name: node.text, node };
    }

    return undefined;
}


export function getInvalidPropertyReplacement(document: vscode.TextDocument, range: vscode.Range): string | undefined {
    const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true,
        getScriptKind(document)
    );
    const offset = document.offsetAt(range.start);
    const node = findDeepestNode(sourceFile, offset);
    const property = findAncestor(node, (candidate): candidate is ts.PropertyAssignment | ts.MethodDeclaration => {
        return (ts.isPropertyAssignment(candidate) || ts.isMethodDeclaration(candidate))
            && candidate.name.getStart() <= offset
            && offset <= candidate.name.getEnd();
    });
    if (!property) {
        return undefined;
    }

    const propertyName = getPropertyName(property.name);
    if (!propertyName) {
        return undefined;
    }

    const objectLiteral = findAncestor(property, ts.isObjectLiteralExpression);
    if (!objectLiteral) {
        return undefined;
    }

    const objectContext = getObjectContext(objectLiteral);
    if (!objectContext) {
        return undefined;
    }

    return getSingleClosestPropertyName(propertyName, new Set(getValidPropertiesForContext(objectContext)));
}

function getMachineCallKind(callExpression: ts.CallExpression): 'machine' | 'state' | undefined {
    const callee = callExpression.expression;

    if (ts.isIdentifier(callee)) {
        if (callee.text === 'createMachine' || callee.text === 'Machine') {
            return 'machine';
        }
        if (callee.text === 'createStateConfig' || callee.text === 'stateConfig') {
            return 'state';
        }
        return undefined;
    }

    if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === 'createMachine' || callee.name.text === 'Machine') {
            return 'machine';
        }
        if (callee.name.text === 'createStateConfig' || callee.name.text === 'stateConfig') {
            return 'state';
        }
    }

    return undefined;
}

function getSetupConfig(callExpression: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
    const callee = callExpression.expression;
    if (!ts.isPropertyAccessExpression(callee) || !ts.isCallExpression(callee.expression)) {
        return undefined;
    }

    const setupCall = callee.expression;
    if (!ts.isIdentifier(setupCall.expression) || setupCall.expression.text !== 'setup') {
        return undefined;
    }

    const [setupArg] = setupCall.arguments;
    return setupArg && ts.isObjectLiteralExpression(setupArg) ? setupArg : undefined;
}


function getObjectContext(objectLiteral: ts.ObjectLiteralExpression): XStateObjectContext | undefined {
    if (isSetupConfigObject(objectLiteral)) {
        return 'setup';
    }

    if (isMachineConfigObject(objectLiteral)) {
        return 'machine';
    }

    if (isInvokeConfigObject(objectLiteral)) {
        return 'invoke';
    }

    if (isTransitionConfigObject(objectLiteral)) {
        return 'transition';
    }

    if (isStateConfigObject(objectLiteral)) {
        return 'state';
    }

    return undefined;
}

function isMachineConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
    const parent = objectLiteral.parent;
    if (!ts.isCallExpression(parent)) {
        return false;
    }

    return parent.arguments[0] === objectLiteral && getMachineCallKind(parent) === 'machine';
}

function isSetupConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
    const parent = objectLiteral.parent;
    if (!ts.isCallExpression(parent) || parent.arguments[0] !== objectLiteral) {
        return false;
    }

    return ts.isIdentifier(parent.expression) && parent.expression.text === 'setup';
}

function isStateConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
    const property = findAncestor(objectLiteral, ts.isPropertyAssignment);
    if (!property || property.initializer !== objectLiteral) {
        return false;
    }

    const container = property.parent;
    if (!ts.isObjectLiteralExpression(container)) {
        return false;
    }

    const containerProperty = findAncestor(container, ts.isPropertyAssignment);
    return !!containerProperty && getPropertyName(containerProperty.name) === 'states';
}

function isTransitionConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
    const property = findAncestor(objectLiteral, ts.isPropertyAssignment);
    if (!property || property.initializer !== objectLiteral) {
        return false;
    }

    const propertyName = getPropertyName(property.name);
    if (propertyName === 'always' || propertyName === 'onDone' || propertyName === 'onError') {
        return true;
    }

    const container = property.parent;
    if (!ts.isObjectLiteralExpression(container)) {
        return false;
    }

    const containerProperty = findAncestor(container, ts.isPropertyAssignment);
    const containerName = containerProperty ? getPropertyName(containerProperty.name) : undefined;
    return containerName === 'on' || containerName === 'after';
}

function isInvokeConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
    const property = findAncestor(objectLiteral, ts.isPropertyAssignment);
    if (property && property.initializer === objectLiteral && getPropertyName(property.name) === 'invoke') {
        return true;
    }

    const array = findAncestor(objectLiteral, ts.isArrayLiteralExpression);
    if (!array) {
        return false;
    }

    const invokeProperty = findAncestor(array, ts.isPropertyAssignment);
    return !!invokeProperty && getPropertyName(invokeProperty.name) === 'invoke';
}

function findDeepestNode(root: ts.Node, offset: number): ts.Node {
    let best: ts.Node = root;

    const visit = (node: ts.Node): void => {
        if (offset < node.getFullStart() || offset > node.getEnd()) {
            return;
        }

        best = node;
        ts.forEachChild(node, visit);
    };

    visit(root);
    return best;
}

function findAncestor<T extends ts.Node>(
    node: ts.Node | undefined,
    predicate: (candidate: ts.Node) => candidate is T
): T | undefined {
    let current = node;
    while (current) {
        if (predicate(current)) {
            return current;
        }
        current = current.parent;
    }
    return undefined;
}

function findNamedProperty(node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | ts.MethodDeclaration | undefined {
    return node.properties.find((property): property is ts.PropertyAssignment | ts.MethodDeclaration => {
        return (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) && getPropertyName(property.name) === name;
    });
}

function findPropertyAssignment(node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
    return node.properties.find((property): property is ts.PropertyAssignment => {
        return ts.isPropertyAssignment(property) && getPropertyName(property.name) === name;
    });
}

function getPropertyName(name: ts.PropertyName | undefined): string | undefined {
    if (!name) {
        return undefined;
    }

    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }

    return undefined;
}

function propertyNameRange(document: vscode.TextDocument, name: ts.PropertyName): vscode.Range {
    return nodeRange(document, name);
}

function nodeRange(document: vscode.TextDocument, node: ts.Node): vscode.Range {
    return new vscode.Range(document.positionAt(node.getStart()), document.positionAt(node.getEnd()));
}

function createDiagnostic(
    range: vscode.Range,
    message: string,
    code: string,
    severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning,
): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = XSTATE_DIAGNOSTIC_SOURCE;
    diagnostic.code = code;
    return diagnostic;
}

function getSingleClosestPropertyName(propertyName: string, validProperties: Set<string>): string | undefined {
    let bestMatch: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    let hasTie = false;

    for (const candidate of validProperties) {
        const distance = levenshtein(propertyName, candidate);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = candidate;
            hasTie = false;
        } else if (distance === bestDistance) {
            hasTie = true;
        }
    }

    if (hasTie || bestDistance > 2) {
        return undefined;
    }

    return bestMatch;
}

function levenshtein(left: string, right: string): number {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

    for (let row = 0; row < rows; row++) {
        dp[row][0] = row;
    }
    for (let col = 0; col < cols; col++) {
        dp[0][col] = col;
    }

    for (let row = 1; row < rows; row++) {
        for (let col = 1; col < cols; col++) {
            const cost = left[row - 1] === right[col - 1] ? 0 : 1;
            dp[row][col] = Math.min(
                dp[row - 1][col] + 1,
                dp[row][col - 1] + 1,
                dp[row - 1][col - 1] + cost
            );
        }
    }

    return dp[left.length][right.length];
}

function getScriptKind(document: vscode.TextDocument): ts.ScriptKind {
    switch (document.languageId) {
        case 'javascript':
            return ts.ScriptKind.JS;
        case 'javascriptreact':
            return ts.ScriptKind.JSX;
        case 'typescriptreact':
            return ts.ScriptKind.TSX;
        default:
            return ts.ScriptKind.TS;
    }
}
