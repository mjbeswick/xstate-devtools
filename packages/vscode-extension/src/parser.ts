import * as vscode from 'vscode';
import * as ts from 'typescript';
import {
    XSTATE_INVOKE_PROPERTIES,
    XSTATE_MACHINE_PROPERTIES,
    XSTATE_SETUP_PROPERTIES,
    XSTATE_STATE_PROPERTIES,
    XSTATE_TRANSITION_PROPERTIES,
} from './xstateSchema';

export interface MachineNode {
    type: 'machine' | 'state' | 'transition' | 'target' | 'action' | 'guard' | 'invoke' | 'entry' | 'exit' | 'context' | 'contextProperty' | 'actor' | 'delay' | 'setup' | 'on' | 'invalid';
    label: string;
    range: vscode.Range;
    uri: vscode.Uri;
    children?: MachineNode[];
    isStateConfig?: boolean; // Flag for createStateConfig/stateConfig patterns
    isInitial?: boolean; // Flag for initial state
    isFinal?: boolean; // Flag for final state
    isParallel?: boolean; // Flag for parallel (orthogonal) state
    historyType?: 'shallow' | 'deep'; // Set for `type: 'history'` states
    isTypeMarker?: boolean; // Synthetic `type: …` child — shown in the tree, hidden in the graph
    description?: string; // XState `description` property, shown on hover
}

export class XStateMachineParser {
    private static readonly MACHINE_PROPERTIES = new Set(XSTATE_MACHINE_PROPERTIES);

    private static readonly STATE_PROPERTIES = new Set(XSTATE_STATE_PROPERTIES);

    private static readonly TRANSITION_PROPERTIES = new Set(XSTATE_TRANSITION_PROPERTIES);

    private static readonly INVOKE_PROPERTIES = new Set(XSTATE_INVOKE_PROPERTIES);

    private static readonly SETUP_PROPERTIES = new Set(XSTATE_SETUP_PROPERTIES);
    
    /**
     * Parse the document and extract XState machine definitions
     */
    static parseMachines(document: vscode.TextDocument): MachineNode[] {
        const text = document.getText();
        const sourceFile = ts.createSourceFile(
            document.fileName,
            text,
            ts.ScriptTarget.Latest,
            true
        );

        const machines: MachineNode[] = [];
        this.visit(sourceFile, document, machines);
        
        // Deduplicate machines based on their location (uri + range)
        const seen = new Set<string>();
        const deduplicated: MachineNode[] = [];
        for (const machine of machines) {
            const key = `${machine.range.start.line}:${machine.range.start.character}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduplicated.push(machine);
            }
        }
        
        console.log(`[XState Parser] Found ${machines.length} machines, ${deduplicated.length} after dedup in ${document.fileName}`);
        
        return deduplicated;
    }

    private static visit(
        node: ts.Node,
        document: vscode.TextDocument,
        machines: MachineNode[]
    ): void {
        // Look for createMachine(), Machine(), createStateConfig(), or stateConfig() calls
        if (ts.isCallExpression(node)) {
            const expression = node.expression;
            
            // Handle various patterns:
            // 1. createMachine(...) or Machine(...)
            // 2. xstate.createMachine(...) or xstate.Machine(...)
            // 3. setup.createMachine(...) (XState v5 setup pattern)
            // 4. setup().createMachine(...) (chained setup)
            // 5. setup.createStateConfig(...) (XState v5 state config)
            // 6. createStateConfig(...) or stateConfig(...)
            
            let isValidMachineCall = false;
            let callName = '';
            let variableName: string | null = null;
            let setupConfig: ts.ObjectLiteralExpression | null = null;
            
            // Extract variable name by walking up the AST tree
            let parent = node.parent;
            while (parent) {
                if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
                    variableName = parent.name.text;
                    break;
                }
                // Also check for export assignments
                if (ts.isExportAssignment(parent) && parent.expression === node) {
                    break;
                }
                parent = parent.parent;
            }
            
            if (ts.isIdentifier(expression)) {
                // Direct call: createMachine(), Machine(), createStateConfig(), stateConfig()
                const name = expression.text;
                isValidMachineCall = name === 'createMachine' || name === 'Machine' || 
                                    name === 'createStateConfig' || name === 'stateConfig';
                callName = name;
            } else if (ts.isPropertyAccessExpression(expression)) {
                // Property access: something.createMachine() or something.createStateConfig()
                const propertyName = expression.name.text;
                isValidMachineCall = propertyName === 'createMachine' || propertyName === 'Machine' ||
                                    propertyName === 'createStateConfig' || propertyName === 'stateConfig';
                callName = propertyName;
                
                // Check if this is setup().createMachine() - extract setup config
                if (ts.isCallExpression(expression.expression) && 
                    ts.isIdentifier(expression.expression.expression) &&
                    expression.expression.expression.text === 'setup') {
                    const setupArg = expression.expression.arguments[0];
                    if (setupArg && ts.isObjectLiteralExpression(setupArg)) {
                        setupConfig = setupArg;
                    }
                }
            }
            
            if (isValidMachineCall) {
                const machineConfig = node.arguments[0];
                if (machineConfig && ts.isObjectLiteralExpression(machineConfig)) {
                    const machine = this.parseMachineConfig(machineConfig, document, variableName || undefined, setupConfig);
                    if (machine) {
                        // Mark state configs
                        if (callName === 'createStateConfig' || callName === 'stateConfig') {
                            machine.isStateConfig = true;
                        }
                        machines.push(machine);
                    }
                }
            }
        }

        // Recursively visit child nodes
        ts.forEachChild(node, (child) => this.visit(child, document, machines));
    }

    private static parseMachineConfig(
        config: ts.ObjectLiteralExpression,
        document: vscode.TextDocument,
        variableName: string | null = null,
        setupConfig: ts.ObjectLiteralExpression | null = null
    ): MachineNode | null {
        const range = this.nodeToRange(config, document);
        const children: MachineNode[] = [];

        // Extract machine ID - use variable name as fallback
        let machineId = 'Machine';
        const idProp = this.findProperty(config, 'id');
        if (idProp && ts.isStringLiteral(idProp)) {
            machineId = idProp.text;
        } else if (variableName) {
            // Use the variable name if no id property exists
            machineId = variableName;
        }

        // Add setup implementations if provided (chained setup().createMachine() pattern)
        if (setupConfig) {
            const setupNode = this.parseSetup(setupConfig, document);
            if (setupNode && setupNode.children && setupNode.children.length > 0) {
                children.push(setupNode);
            }
        }

        // Parse states with initial state tracking
        const statesProp = this.findProperty(config, 'states');
        if (statesProp && ts.isObjectLiteralExpression(statesProp)) {
            const initialProp = this.findProperty(config, 'initial');
            const initialStateName = initialProp && ts.isStringLiteral(initialProp) ? initialProp.text : null;
            const states = this.parseStates(statesProp, document, initialStateName);
            children.push(...states);
        }

        // Parse context
        const contextProp = this.findProperty(config, 'context');
        if (contextProp) {
            // Handle both object context and function context (XState v5)
            if (ts.isObjectLiteralExpression(contextProp)) {
                // Object-style context: context: { ... }
                const contextNode = this.parseContext(contextProp, document);
                children.push(contextNode);
            } else if (ts.isArrowFunction(contextProp) || ts.isFunctionExpression(contextProp)) {
                // Function-style context: context: () => ({ ... }) or context() { return { ... } }
                // For function contexts, just show a placeholder since we can't statically analyze
                children.push({
                    type: 'context',
                    label: 'context (function)',
                    range: this.nodeToRange(contextProp, document),
                    uri: document.uri
                });
            } else {
                // Fallback for other patterns
                children.push({
                    type: 'context',
                    label: 'context',
                    range: this.nodeToRange(contextProp, document),
                    uri: document.uri
                });
            }
        }

        // Parse root-level entry/exit/on/invoke (machines without a states block)
        const entryProp = this.findProperty(config, 'entry');
        if (entryProp) {
            children.push(...this.parseActions('entry', entryProp, document));
        }

        const exitProp = this.findProperty(config, 'exit');
        if (exitProp) {
            children.push(...this.parseActions('exit', exitProp, document));
        }

        const onProp = this.findProperty(config, 'on');
        if (onProp && ts.isObjectLiteralExpression(onProp)) {
            children.push(...this.parseTransitions(onProp, document));
        }

        const invokeProp = this.findProperty(config, 'invoke');
        if (invokeProp) {
            children.push(...this.parseInvokes(invokeProp, document));
        }

        children.push(...this.parseInvalidProperties(config, document, this.MACHINE_PROPERTIES));

        const machineTypeProp = this.findProperty(config, 'type');
        const machineIsParallel = !!(machineTypeProp && ts.isStringLiteral(machineTypeProp) && machineTypeProp.text === 'parallel');

        return {
            type: 'machine',
            label: machineId,
            range,
            uri: document.uri,
            children,
            isParallel: machineIsParallel || undefined,
            description: this.extractDescription(config)
        };
    }

    /**
     * Parse XState v5 setup() configuration to extract actions, guards, actors, and delays
     */
    private static parseSetup(
        setupConfig: ts.ObjectLiteralExpression,
        document: vscode.TextDocument
    ): MachineNode | null {
        const children: MachineNode[] = [];

        // Parse actions
        const actionsProp = this.findProperty(setupConfig, 'actions');
        if (actionsProp && ts.isObjectLiteralExpression(actionsProp)) {
            const actions = this.parseImplementationObject('action', actionsProp, document);
            children.push(...actions);
        }

        // Parse guards
        const guardsProp = this.findProperty(setupConfig, 'guards');
        if (guardsProp && ts.isObjectLiteralExpression(guardsProp)) {
            const guards = this.parseImplementationObject('guard', guardsProp, document);
            children.push(...guards);
        }

        // Parse actors
        const actorsProp = this.findProperty(setupConfig, 'actors');
        if (actorsProp && ts.isObjectLiteralExpression(actorsProp)) {
            const actors = this.parseImplementationObject('actor', actorsProp, document);
            children.push(...actors);
        }

        // Parse delays
        const delaysProp = this.findProperty(setupConfig, 'delays');
        if (delaysProp && ts.isObjectLiteralExpression(delaysProp)) {
            const delays = this.parseImplementationObject('delay', delaysProp, document);
            children.push(...delays);
        }

        children.push(...this.parseInvalidProperties(setupConfig, document, this.SETUP_PROPERTIES));

        // If we found implementations, return a setup node
        if (children.length > 0) {
            return {
                type: 'setup',
                label: 'setup',
                range: this.nodeToRange(setupConfig, document),
                uri: document.uri,
                children
            };
        }

        return null;
    }

    /**
     * Parse an object of implementations (actions, guards, actors, delays)
     */
    private static parseImplementationObject(
        type: 'action' | 'actor' | 'guard' | 'delay',
        obj: ts.ObjectLiteralExpression,
        document: vscode.TextDocument
    ): MachineNode[] {
        const items: MachineNode[] = [];

        for (const prop of obj.properties) {
            if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
                const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text;
                
                items.push({
                    type,
                    label: name,
                    range: this.nodeToRange(prop, document),
                    uri: document.uri
                });
            }
        }

        return items;
    }

    private static parseStates(
        statesNode: ts.ObjectLiteralExpression,
        document: vscode.TextDocument,
        initialStateName: string | null = null
    ): MachineNode[] {
        const states: MachineNode[] = [];

        for (const prop of statesNode.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                const stateName = prop.name.text;
                const stateConfig = prop.initializer;
                const isInitial = stateName === initialStateName;

                if (ts.isObjectLiteralExpression(stateConfig)) {
                    const state = this.parseStateConfig(stateName, stateConfig, document, isInitial);
                    states.push(state);
                }
            }
        }

        return states;
    }

    private static parseStateConfig(
        stateName: string,
        config: ts.ObjectLiteralExpression,
        document: vscode.TextDocument,
        isInitial: boolean = false
    ): MachineNode {
        const children: MachineNode[] = [];
        const range = this.nodeToRange(config, document);

        // Parse nested states with their initial state
        const statesProp = this.findProperty(config, 'states');
        if (statesProp && ts.isObjectLiteralExpression(statesProp)) {
            const nestedInitialProp = this.findProperty(config, 'initial');
            const nestedInitialStateName = nestedInitialProp && ts.isStringLiteral(nestedInitialProp) 
                ? nestedInitialProp.text 
                : null;
            const nestedStates = this.parseStates(statesProp, document, nestedInitialStateName);
            children.push(...nestedStates);
        }

        // Parse transitions (on property)
        const onProp = this.findProperty(config, 'on');
        if (onProp && ts.isObjectLiteralExpression(onProp)) {
            const transitions = this.parseTransitions(onProp, document);
            children.push(...transitions);
        }

        // Parse `after` — delayed transitions, keyed by delay (ms or named delay).
        const afterProp = this.findProperty(config, 'after');
        if (afterProp && ts.isObjectLiteralExpression(afterProp)) {
            for (const t of this.parseTransitions(afterProp, document)) {
                t.label = /^\d+$/.test(t.label) ? `after ${t.label}ms` : `after ${t.label}`;
                children.push(t);
            }
        }

        // Parse `always` — transient (eventless) transition(s); single, object, or array of branches.
        const alwaysProp = this.findProperty(config, 'always');
        if (alwaysProp) {
            const alwaysNode = this.parseTransitionNode(alwaysProp, 'always', document);
            if (alwaysNode) { children.push(alwaysNode); }
        }

        // Parse state-level `onDone` — fires when a compound/parallel state reaches its final state.
        const onDoneProp = this.findProperty(config, 'onDone');
        if (onDoneProp) {
            const onDoneNode = this.parseTransitionNode(onDoneProp, 'onDone', document);
            if (onDoneNode) { children.push(onDoneNode); }
        }

        // Parse entry actions
        const entryProp = this.findProperty(config, 'entry');
        if (entryProp) {
            const entry = this.parseActions('entry', entryProp, document);
            children.push(...entry);
        }

        // Parse exit actions
        const exitProp = this.findProperty(config, 'exit');
        if (exitProp) {
            const exit = this.parseActions('exit', exitProp, document);
            children.push(...exit);
        }

        // Parse invoke
        const invokeProp = this.findProperty(config, 'invoke');
        if (invokeProp) {
            const invokeNodes = this.parseInvokes(invokeProp, document);
            children.push(...invokeNodes);
        }

        // Parse type (final, parallel, history, etc)
        const typeProp = this.findProperty(config, 'type');
        const isFinal = typeProp && ts.isStringLiteral(typeProp) && typeProp.text === 'final';
        const isParallel = !!(typeProp && ts.isStringLiteral(typeProp) && typeProp.text === 'parallel');
        const isHistory = !!(typeProp && ts.isStringLiteral(typeProp) && typeProp.text === 'history');
        let historyType: 'shallow' | 'deep' | undefined;
        if (isHistory) {
            const historyProp = this.findProperty(config, 'history');
            historyType = historyProp && ts.isStringLiteral(historyProp) && historyProp.text === 'deep'
                ? 'deep' : 'shallow';
        }

        if (typeProp && ts.isStringLiteral(typeProp) && typeProp.text !== 'final' && typeProp.text !== 'parallel') {
            // Surface uncommon types (e.g. `history`) in the tree as a child
            // marker, flagged so the graph excludes it. `parallel` is omitted —
            // it is conveyed by the state's own hollow-circle icon (tree) and
            // dashed styling (graph) rather than a redundant child node.
            children.unshift({
                type: 'state',
                label: `type: ${typeProp.text}`,
                range: this.nodeToRange(typeProp, document),
                uri: document.uri,
                isTypeMarker: true
            });
        }

        children.push(...this.parseInvalidProperties(config, document, this.STATE_PROPERTIES));

        const label = stateName;

        return {
            type: 'state',
            label,
            range,
            uri: document.uri,
            children: children.length > 0 ? children : undefined,
            isInitial,
            isFinal: isFinal || undefined,
            isParallel: isParallel || undefined,
            historyType,
            description: this.extractDescription(config)
        };
    }

    private static parseTransitions(
        onNode: ts.ObjectLiteralExpression,
        document: vscode.TextDocument
    ): MachineNode[] {
        const transitions: MachineNode[] = [];

        for (const prop of onNode.properties) {
            if (ts.isPropertyAssignment(prop)) {
                const eventName = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                    ? prop.name.text
                    : prop.name.getText();

                // Array: multiple conditional branches
                if (ts.isArrayLiteralExpression(prop.initializer)) {
                    const branches = prop.initializer.elements
                        .filter(e => ts.isObjectLiteralExpression(e))
                        .map(e => this.parseTransitionBranch(e as ts.ObjectLiteralExpression, document));

                    transitions.push({
                        type: 'transition',
                        label: eventName,
                        range: this.nodeToRange(prop, document),
                        uri: document.uri,
                        children: branches.length > 0 ? branches : undefined
                    });
                    continue;
                }

                const children: MachineNode[] = [];

                // Check for guards and actions in single-object transition
                if (ts.isObjectLiteralExpression(prop.initializer)) {
                    this.parseTransitionDetails(prop.initializer, document, children);
                } else if (ts.isStringLiteral(prop.initializer)) {
                    // Simple string target: EVENT: 'state' → show the target as a child node
                    children.push({
                        type: 'target',
                        label: prop.initializer.text,
                        range: this.nodeToRange(prop.initializer, document),
                        uri: document.uri
                    });
                }

                // Only include target in the parent label when it won't appear as a child node
                const target = this.extractTransitionTarget(prop.initializer);
                const hasTargetChild = children.some(c => c.type === 'target');
                const label = (target && !hasTargetChild) ? `${eventName} → ${target}` : eventName;

                transitions.push({
                    type: 'transition',
                    label,
                    range: this.nodeToRange(prop, document),
                    uri: document.uri,
                    children: children.length > 0 ? children : undefined
                });
            }
        }

        return transitions;
    }

    private static parseTransitionDetails(
        node: ts.Node,
        document: vscode.TextDocument,
        children: MachineNode[]
    ): void {
        if (ts.isObjectLiteralExpression(node)) {
            // guard (XState v5) or cond (XState v4)
            const guardProp = this.findProperty(node, 'guard') ?? this.findProperty(node, 'cond');
            if (guardProp) {
                const guardLabel = this.extractFunctionName(guardProp) || '(inline guard)';
                children.push({
                    type: 'guard',
                    label: guardLabel,
                    range: this.nodeToRange(guardProp, document),
                    uri: document.uri
                });
            }

            // target
            const targetProp = this.findProperty(node, 'target');
            if (targetProp) {
                const targetLabel = ts.isStringLiteral(targetProp) ? targetProp.text : '(dynamic target)';
                children.push({
                    type: 'target',
                    label: targetLabel,
                    range: this.nodeToRange(targetProp, document),
                    uri: document.uri
                });
            }

            // actions
            const actionsProp = this.findProperty(node, 'actions');
            if (actionsProp) {
                const actions = this.parseActions('action', actionsProp, document);
                children.push(...actions);
            }

            children.push(...this.parseInvalidProperties(node, document, this.TRANSITION_PROPERTIES));
        } else if (ts.isArrayLiteralExpression(node)) {
            for (const element of node.elements) {
                this.parseTransitionDetails(element, document, children);
            }
        }
    }

    private static parseActions(
        type: 'entry' | 'exit' | 'action',
        node: ts.Node,
        document: vscode.TextDocument
    ): MachineNode[] {
        const actions: MachineNode[] = [];

        if (ts.isArrayLiteralExpression(node)) {
            // Array of actions
            for (const element of node.elements) {
                const actionName = this.extractFunctionName(element);
                actions.push({
                    type,
                    label: actionName || `(inline ${type})`,
                    range: this.nodeToRange(element, document),
                    uri: document.uri
                });
            }
        } else {
            // Single action
            const actionName = this.extractFunctionName(node);
            const label = actionName || `(inline ${type})`;
            actions.push({
                type,
                label,
                range: this.nodeToRange(node, document),
                uri: document.uri
            });
        }

        return actions;
    }

    private static extractTransitionTarget(node: ts.Node): string | null {
        if (ts.isStringLiteral(node)) {
            return node.text;
        }
        if (ts.isObjectLiteralExpression(node)) {
            const targetProp = this.findProperty(node, 'target');
            if (targetProp && ts.isStringLiteral(targetProp)) {
                return targetProp.text;
            }
        }
        if (ts.isArrayLiteralExpression(node)) {
            // Handle array of transitions - take first one
            if (node.elements.length > 0) {
                return this.extractTransitionTarget(node.elements[0]);
            }
        }
        return null;
    }

    /** Read a string-literal `description` property, supporting plain and template (no-substitution) strings. */
    private static extractDescription(config: ts.ObjectLiteralExpression): string | undefined {
        const prop = this.findProperty(config, 'description');
        if (!prop) { return undefined; }
        if (ts.isStringLiteral(prop) || ts.isNoSubstitutionTemplateLiteral(prop)) {
            const text = prop.text.trim();
            return text.length > 0 ? text : undefined;
        }
        return undefined;
    }

    private static extractFunctionName(node: ts.Node): string | null {
        if (ts.isStringLiteral(node)) {
            return node.text;
        }
        if (ts.isIdentifier(node)) {
            return node.text;
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            return node.expression.text;
        }
        if (ts.isObjectLiteralExpression(node)) {
            // Object-form action/guard: { type: 'playSound', params: ... }
            const typeProp = this.findProperty(node, 'type');
            if (typeProp && ts.isStringLiteral(typeProp)) {
                return typeProp.text;
            }
        }
        return null;
    }

    private static findProperty(
        node: ts.ObjectLiteralExpression,
        name: string
    ): ts.Expression | null {
        for (const prop of node.properties) {
            if (ts.isPropertyAssignment(prop)) {
                const propName = ts.isIdentifier(prop.name) 
                    ? prop.name.text 
                    : ts.isStringLiteral(prop.name)
                    ? prop.name.text
                    : null;
                
                if (propName === name) {
                    return prop.initializer;
                }
            } else if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
                // Handle method declarations: context() { ... }
                if (prop.name.text === name) {
                    return prop as any; // Return the method itself
                }
            }
        }
        return null;
    }

    private static nodeToRange(node: ts.Node, document: vscode.TextDocument): vscode.Range {
        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());
        return new vscode.Range(start, end);
    }

    private static parseContext(
        contextNode: ts.Expression,
        document: vscode.TextDocument
    ): MachineNode {
        const children: MachineNode[] = [];

        if (ts.isObjectLiteralExpression(contextNode)) {
            // Parse each property in the context object
            for (const prop of contextNode.properties) {
                if (ts.isPropertyAssignment(prop)) {
                    const propName = this.getPropertyName(prop.name);
                    if (propName) {
                        const value = this.formatContextValue(prop.initializer);
                        const label = `${propName}: ${value}`;
                        
                        const childNode: MachineNode = {
                            type: 'contextProperty',
                            label,
                            range: this.nodeToRange(prop, document),
                            uri: document.uri
                        };

                        // If the value is an object or array, recursively parse it (max 1 level deep)
                        if (ts.isObjectLiteralExpression(prop.initializer) || 
                            ts.isArrayLiteralExpression(prop.initializer)) {
                            const nestedChildren = this.parseContextValue(prop.initializer, document, 1);
                            if (nestedChildren.length > 0) {
                                childNode.children = nestedChildren;
                            }
                        }

                        children.push(childNode);
                    }
                } else if (ts.isShorthandPropertyAssignment(prop)) {
                    // Handle shorthand properties like { count }
                    const propName = prop.name.text;
                    children.push({
                        type: 'contextProperty',
                        label: propName,
                        range: this.nodeToRange(prop, document),
                        uri: document.uri
                    });
                }
            }
        }

        return {
            type: 'context',
            label: `context`,
            range: this.nodeToRange(contextNode, document),
            uri: document.uri,
            children: children.length > 0 ? children : undefined
        };
    }

    private static parseContextValue(
        node: ts.Expression,
        document: vscode.TextDocument,
        depth: number
    ): MachineNode[] {
        const children: MachineNode[] = [];

        // Only parse 1 level deep to avoid clutter
        if (depth > 1) {
            return children;
        }

        if (ts.isObjectLiteralExpression(node)) {
            for (const prop of node.properties) {
                if (ts.isPropertyAssignment(prop)) {
                    const propName = this.getPropertyName(prop.name);
                    if (propName) {
                        const value = this.formatContextValue(prop.initializer);
                        children.push({
                            type: 'contextProperty',
                            label: `${propName}: ${value}`,
                            range: this.nodeToRange(prop, document),
                            uri: document.uri
                        });
                    }
                }
            }
        } else if (ts.isArrayLiteralExpression(node)) {
            node.elements.forEach((element, index) => {
                const value = this.formatContextValue(element);
                children.push({
                    type: 'contextProperty',
                    label: `[${index}]: ${value}`,
                    range: this.nodeToRange(element, document),
                    uri: document.uri
                });
            });
        }

        return children;
    }

    private static formatContextValue(node: ts.Node): string {
        if (ts.isStringLiteral(node)) {
            return `"${node.text}"`;
        }
        if (ts.isNumericLiteral(node)) {
            return node.text;
        }
        if (node.kind === ts.SyntaxKind.TrueKeyword) {
            return 'true';
        }
        if (node.kind === ts.SyntaxKind.FalseKeyword) {
            return 'false';
        }
        if (node.kind === ts.SyntaxKind.NullKeyword) {
            return 'null';
        }
        if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
            return 'undefined';
        }
        if (ts.isObjectLiteralExpression(node)) {
            const propCount = node.properties.length;
            return propCount > 0 ? `{ ${propCount} ${propCount === 1 ? 'property' : 'properties'} }` : '{}';
        }
        if (ts.isArrayLiteralExpression(node)) {
            return `[${node.elements.length} ${node.elements.length === 1 ? 'item' : 'items'}]`;
        }
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            return '(function)';
        }
        if (ts.isIdentifier(node)) {
            return node.text;
        }
        // For complex expressions, just show a generic indicator
        return '...';
    }

    private static getPropertyName(name: ts.PropertyName): string | null {
        if (ts.isIdentifier(name)) {
            return name.text;
        }
        if (ts.isStringLiteral(name)) {
            return name.text;
        }
        if (ts.isNumericLiteral(name)) {
            return name.text;
        }
        return null;
    }

    private static parseInvalidProperties(
        node: ts.ObjectLiteralExpression,
        document: vscode.TextDocument,
        validProperties: Set<string>
    ): MachineNode[] {
        const invalidNodes: MachineNode[] = [];

        for (const prop of node.properties) {
            let propertyName: string | null = null;

            if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
                propertyName = this.getPropertyName(prop.name);
            } else {
                continue;
            }

            if (!propertyName || validProperties.has(propertyName)) {
                continue;
            }

            invalidNodes.push({
                type: 'invalid',
                label: `invalid: ${propertyName}`,
                range: this.nodeToRange(prop, document),
                uri: document.uri
            });
        }

        return invalidNodes;
    }
    private static parseInvokes(
        invokeProp: ts.Node,
        document: vscode.TextDocument
    ): MachineNode[] {
        const invokes: MachineNode[] = [];

        if (ts.isObjectLiteralExpression(invokeProp)) {
            // Single invoke
            const invokeNode = this.parseInvokeObject(invokeProp, document);
            if (invokeNode) {
                invokes.push(invokeNode);
            }
        } else if (ts.isArrayLiteralExpression(invokeProp)) {
            // Array of invokes
            invokeProp.elements.forEach(element => {
                if (ts.isObjectLiteralExpression(element)) {
                    const invokeNode = this.parseInvokeObject(element, document);
                    if (invokeNode) {
                        invokes.push(invokeNode);
                    }
                }
            });
        }

        return invokes;
    }

    private static parseInvokeObject(
        invokeObj: ts.ObjectLiteralExpression,
        document: vscode.TextDocument
    ): MachineNode | null {
        const srcProp = this.findProperty(invokeObj, 'src');
        if (!srcProp) {
            return null;
        }

        const src = this.getValueText(srcProp);
        const children: MachineNode[] = [];

        // Parse onDone
        const onDoneProp = this.findProperty(invokeObj, 'onDone');
        if (onDoneProp) {
            const onDoneNode = this.parseTransitionNode(onDoneProp, 'onDone', document);
            if (onDoneNode) {
                children.push(onDoneNode);
            }
        }

        // Parse onError
        const onErrorProp = this.findProperty(invokeObj, 'onError');
        if (onErrorProp) {
            const onErrorNode = this.parseTransitionNode(onErrorProp, 'onError', document);
            if (onErrorNode) {
                children.push(onErrorNode);
            }
        }

        children.push(...this.parseInvalidProperties(invokeObj, document, this.INVOKE_PROPERTIES));

        return {
            type: 'invoke',
            label: src,
            range: this.nodeToRange(invokeObj, document),
            uri: document.uri,
            children: children.length > 0 ? children : undefined
        };
    }

    /**
     * Parse a single transition object { guard, target, actions } into a branch node.
     * Used when a transition value is an array of conditional branches.
     */
    private static parseTransitionBranch(
        obj: ts.ObjectLiteralExpression,
        document: vscode.TextDocument
    ): MachineNode {
        const children: MachineNode[] = [];

        const targetProp = this.findProperty(obj, 'target');
        const target = targetProp && ts.isStringLiteral(targetProp) ? targetProp.text : null;

        // Guard
        const guardProp = this.findProperty(obj, 'guard') || this.findProperty(obj, 'cond');
        const guardName = guardProp ? this.extractFunctionName(guardProp) : null;
        if (guardProp) {
            children.push({
                type: 'guard',
                label: guardName || '(inline guard)',
                range: this.nodeToRange(guardProp, document),
                uri: document.uri
            });
        }

        // Label the branch by its decision: a named guard is what distinguishes
        // sibling branches, so lead with it (the guard also remains a child for
        // go-to-implementation). Fall back to the target, then a placeholder.
        const label = guardName && target ? `when ${guardName} → ${target}`
            : guardName ? `when ${guardName}`
            : target ?? '(branch)';

        // Actions
        const actionsProp = this.findProperty(obj, 'actions');
        if (actionsProp) {
            const actions = this.parseActions('action', actionsProp, document);
            children.push(...actions);
        }

        children.push(...this.parseInvalidProperties(obj, document, this.TRANSITION_PROPERTIES));

        return {
            type: 'transition',
            label,
            range: this.nodeToRange(obj, document),
            uri: document.uri,
            children: children.length > 0 ? children : undefined
        };
    }

    private static parseTransitionNode(
        transitionProp: ts.Expression,
        eventName: string,
        document: vscode.TextDocument
    ): MachineNode | null {
        const children: MachineNode[] = [];
        let target = '?';

        if (ts.isStringLiteral(transitionProp)) {
            // Simple string target: onDone: 'nextState'
            target = transitionProp.text;
            children.push({
                type: 'target',
                label: target,
                range: this.nodeToRange(transitionProp, document),
                uri: document.uri
            });
        } else if (ts.isArrayLiteralExpression(transitionProp)) {
            // Array of conditional branches: onDone: [{ guard, target }, ...]
            const branches = transitionProp.elements
                .filter(e => ts.isObjectLiteralExpression(e))
                .map(e => this.parseTransitionBranch(e as ts.ObjectLiteralExpression, document));

            return {
                type: 'transition',
                label: eventName,
                range: this.nodeToRange(transitionProp, document),
                uri: document.uri,
                children: branches.length > 0 ? branches : undefined
            };
        } else if (ts.isObjectLiteralExpression(transitionProp)) {
            // Object with target and actions: onDone: { target: 'nextState', actions: [...] }
            const targetProp = this.findProperty(transitionProp, 'target');
            if (targetProp && ts.isStringLiteral(targetProp)) {
                target = targetProp.text;
                children.push({
                    type: 'target',
                    label: target,
                    range: this.nodeToRange(targetProp, document),
                    uri: document.uri
                });
            }

            // Parse actions
            const actionsProp = this.findProperty(transitionProp, 'actions');
            if (actionsProp) {
                if (ts.isStringLiteral(actionsProp) || ts.isIdentifier(actionsProp)) {
                    // Single action: actions: 'myAction'
                    const actionName = this.extractFunctionName(actionsProp);
                    if (actionName) {
                        children.push({
                            type: 'action',
                            label: actionName,
                            range: this.nodeToRange(actionsProp, document),
                            uri: document.uri
                        });
                    }
                } else if (ts.isArrayLiteralExpression(actionsProp)) {
                    // Array of actions
                    actionsProp.elements.forEach(action => {
                        let actionName: string | null = null;
                        
                        if (ts.isObjectLiteralExpression(action)) {
                            // Object-style action: { type: 'actionName', params: ... }
                            const typeProp = this.findProperty(action, 'type');
                            if (typeProp && ts.isStringLiteral(typeProp)) {
                                actionName = typeProp.text;
                            }
                        } else {
                            // String or identifier action
                            actionName = this.extractFunctionName(action);
                        }
                        
                        if (actionName) {
                            children.push({
                                type: 'action',
                                label: actionName,
                                range: this.nodeToRange(action, document),
                                uri: document.uri
                            });
                        }
                    });
                } else if (ts.isObjectLiteralExpression(actionsProp)) {
                    // Single object-style action: actions: { type: 'actionName' }
                    const typeProp = this.findProperty(actionsProp, 'type');
                    if (typeProp && ts.isStringLiteral(typeProp)) {
                        children.push({
                            type: 'action',
                            label: typeProp.text,
                            range: this.nodeToRange(actionsProp, document),
                            uri: document.uri
                        });
                    }
                }
            }

            // Parse guard
            const guardProp = this.findProperty(transitionProp, 'guard') || 
                            this.findProperty(transitionProp, 'cond');
            if (guardProp) {
                const guardName = this.extractFunctionName(guardProp);
                if (guardName) {
                    children.push({
                        type: 'guard',
                        label: guardName,
                        range: this.nodeToRange(guardProp, document),
                        uri: document.uri
                    });
                }
            }

            children.push(...this.parseInvalidProperties(transitionProp, document, this.TRANSITION_PROPERTIES));
        }

        return {
            type: 'transition',
            label: eventName, // Just event name, no arrow or target
            range: this.nodeToRange(transitionProp, document),
            uri: document.uri,
            children: children.length > 0 ? children : undefined
        };
    }

    private static getTransitionTarget(transitionProp: ts.Node): string {
        if (ts.isStringLiteral(transitionProp)) {
            return transitionProp.text;
        } else if (ts.isObjectLiteralExpression(transitionProp)) {
            const targetProp = this.findProperty(transitionProp, 'target');
            if (targetProp && ts.isStringLiteral(targetProp)) {
                return targetProp.text;
            }
        }
        return '?';
    }

    private static getValueText(node: ts.Expression): string {
        if (ts.isStringLiteral(node)) {
            return node.text;
        } else if (ts.isIdentifier(node)) {
            return node.text;
        } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            return node.expression.text;
        }
        return node.getText().substring(0, 20);
    }
}
