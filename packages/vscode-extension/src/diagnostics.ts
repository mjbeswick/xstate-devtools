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
} as const;

interface SetupReferences {
    actions: Set<string>;
    guards: Set<string>;
    actors: Set<string>;
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
                        setupReferences: setupConfig ? collectSetupReferences(setupConfig) : undefined,
                    };

                    if (setupConfig) {
                        validateSetupConfig(setupConfig, context);
                    }
                    validateMachineConfig(configArg, context);
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

        const name = getPropertyName(property.name);
        if (!name) {
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
            XSTATE_DIAGNOSTIC_CODES.condDeprecated
        );
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
            continue;
        }

        context.diagnostics.push(createDiagnostic(
            nodeRange(context.document, candidate.node),
            `Unknown action reference '${candidate.name}' in setup().`,
            XSTATE_DIAGNOSTIC_CODES.unknownAction
        ));
    }
}

function validateGuardProperty(node: ts.Expression | undefined, context: ValidationContext): void {
    const knownGuards = context.setupReferences?.guards;
    if (!node || !knownGuards) {
        return;
    }

    const candidate = collectSimpleReference(node);
    if (!candidate || knownGuards.has(candidate.name)) {
        return;
    }

    context.diagnostics.push(createDiagnostic(
        nodeRange(context.document, candidate.node),
        `Unknown guard reference '${candidate.name}' in setup().`,
        XSTATE_DIAGNOSTIC_CODES.unknownGuard
    ));
}

function validateActorProperty(node: ts.Expression | undefined, context: ValidationContext): void {
    const knownActors = context.setupReferences?.actors;
    if (!node || !knownActors) {
        return;
    }

    const candidate = collectSimpleReference(node);
    if (!candidate || knownActors.has(candidate.name)) {
        return;
    }

    context.diagnostics.push(createDiagnostic(
        nodeRange(context.document, candidate.node),
        `Unknown actor reference '${candidate.name}' in setup().`,
        XSTATE_DIAGNOSTIC_CODES.unknownActor
    ));
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
        XSTATE_DIAGNOSTIC_CODES.duplicateId
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

function collectSetupReferences(setupConfig: ts.ObjectLiteralExpression): SetupReferences {
    return {
        actions: collectSetupSectionKeys(setupConfig, 'actions'),
        guards: collectSetupSectionKeys(setupConfig, 'guards'),
        actors: collectSetupSectionKeys(setupConfig, 'actors'),
    };
}

function collectSetupSectionKeys(setupConfig: ts.ObjectLiteralExpression, sectionName: 'actions' | 'guards' | 'actors'): Set<string> {
    const keys = new Set<string>();
    const section = findPropertyAssignment(setupConfig, sectionName);

    if (!section || !ts.isObjectLiteralExpression(section.initializer)) {
        return keys;
    }

    for (const property of section.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        const name = getPropertyName(property.name);
        if (name) {
            keys.add(name);
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

function createDiagnostic(range: vscode.Range, message: string, code: string): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
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
