import * as vscode from 'vscode';
import * as ts from 'typescript';

interface PropertySchema {
    name: string;
    description: string;
    v4?: boolean;
    v5?: boolean;
}

type ValueContext = 'state' | 'action' | 'guard' | 'actor' | 'none';
type ObjectContext = 'machine' | 'state' | 'transition' | 'invoke' | 'setup' | 'none';

/**
 * Provides XState-aware autocomplete for machine configs and string targets.
 */
export class XStateCompletionProvider implements vscode.CompletionItemProvider {
    private readonly machineRootProperties: PropertySchema[] = [
        { name: 'id', description: 'Unique identifier for the machine', v4: true, v5: true },
        { name: 'initial', description: 'Initial state key', v4: true, v5: true },
        { name: 'states', description: 'State definitions', v4: true, v5: true },
        { name: 'context', description: 'Initial context object or function', v4: true, v5: true },
        { name: 'entry', description: 'Entry actions executed when machine starts', v4: true, v5: true },
        { name: 'exit', description: 'Exit actions executed when machine exits', v4: true, v5: true },
        { name: 'on', description: 'Root-level event handlers', v4: true, v5: true },
        { name: 'onDone', description: 'Handler when machine reaches final state', v4: false, v5: true },
        { name: 'onError', description: 'Error handler for this machine', v4: false, v5: true },
        { name: 'invoke', description: 'Invoked actors or services', v4: true, v5: true },
        { name: 'type', description: 'Machine type such as "parallel"', v4: true, v5: true },
        { name: 'preserveActionOrder', description: 'Preserve action order (v5)', v4: false, v5: true },
        { name: 'output', description: 'Final output schema or mapper (v5)', v4: false, v5: true },
        { name: 'schema', description: 'Machine type schema (v4)', v4: true, v5: false },
    ];

    private readonly stateProperties: PropertySchema[] = [
        { name: 'type', description: 'State type such as "final" or "parallel"', v4: true, v5: true },
        { name: 'initial', description: 'Initial child state', v4: true, v5: true },
        { name: 'states', description: 'Nested states', v4: true, v5: true },
        { name: 'entry', description: 'Entry actions', v4: true, v5: true },
        { name: 'exit', description: 'Exit actions', v4: true, v5: true },
        { name: 'on', description: 'Event handlers for this state', v4: true, v5: true },
        { name: 'onDone', description: 'Handler when a compound state finishes', v4: false, v5: true },
        { name: 'onError', description: 'Error handler', v4: false, v5: true },
        { name: 'invoke', description: 'Invoked actors or services', v4: true, v5: true },
        { name: 'description', description: 'Description for this state', v4: false, v5: true },
        { name: 'meta', description: 'Metadata for this state', v4: false, v5: true },
        { name: 'tags', description: 'Tags for this state', v4: false, v5: true },
        { name: 'always', description: 'Automatic transitions', v4: true, v5: true },
        { name: 'after', description: 'Delayed transitions', v4: true, v5: true },
    ];

    private readonly transitionProperties: PropertySchema[] = [
        { name: 'target', description: 'Target state(s)', v4: true, v5: true },
        { name: 'guard', description: 'Guard condition (v5)', v4: false, v5: true },
        { name: 'cond', description: 'Guard condition (v4)', v4: true, v5: false },
        { name: 'actions', description: 'Action(s) to execute on transition', v4: true, v5: true },
        { name: 'internal', description: 'Internal transition (no exit/entry)', v4: true, v5: true },
    ];

    private readonly invokeProperties: PropertySchema[] = [
        { name: 'id', description: 'Identifier for this invocation', v4: true, v5: true },
        { name: 'src', description: 'Actor or service source', v4: true, v5: true },
        { name: 'input', description: 'Input for the actor (v5)', v4: false, v5: true },
        { name: 'onDone', description: 'Handler when the invocation completes', v4: true, v5: true },
        { name: 'onError', description: 'Handler when the invocation errors', v4: true, v5: true },
        { name: 'data', description: 'Data mapper (v4)', v4: true, v5: false },
    ];

    private readonly setupProperties: PropertySchema[] = [
        { name: 'actions', description: 'Named action implementations', v4: false, v5: true },
        { name: 'guards', description: 'Named guard implementations', v4: false, v5: true },
        { name: 'actors', description: 'Named actor implementations', v4: false, v5: true },
        { name: 'delays', description: 'Named delays', v4: false, v5: true },
        { name: 'types', description: 'Type definitions', v4: false, v5: true },
    ];

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        const text = document.getText();
        const sourceFile = ts.createSourceFile(
            document.fileName,
            text,
            ts.ScriptTarget.Latest,
            true,
            this.getScriptKind(document)
        );
        const offset = document.offsetAt(position);
        const node = this.findDeepestNode(sourceFile, offset);

        const valueContext = this.getValueContext(node, offset);
        if (valueContext !== 'none') {
            return this.getValueCompletions(sourceFile, valueContext, node);
        }

        const objectLiteral = this.findAncestor(node, ts.isObjectLiteralExpression);
        if (!objectLiteral) {
            return undefined;
        }

        const objectContext = this.getObjectContext(objectLiteral);
        const existingProperties = this.getExistingPropertyNames(objectLiteral);
        const properties = this.getPropertiesForContext(objectContext)
            .filter((prop) => !existingProperties.has(prop.name));
        if (properties.length === 0) {
            return undefined;
        }

        return properties.map((prop) => this.createPropertyCompletion(prop));
    }

    private getScriptKind(document: vscode.TextDocument): ts.ScriptKind {
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

    private getValueCompletions(
        sourceFile: ts.SourceFile,
        valueContext: ValueContext,
        node: ts.Node
    ): vscode.CompletionItem[] {
        switch (valueContext) {
            case 'state': {
                const machineConfig = this.findMachineConfig(node);
                if (!machineConfig) {
                    return [];
                }
                return this.collectStateTargets(machineConfig).map((target) => this.createValueCompletion(target, 'State'));
            }
            case 'action':
                return this.collectSetupKeys(sourceFile, 'actions').map((name) => this.createValueCompletion(name, 'Action'));
            case 'guard':
                return this.collectSetupKeys(sourceFile, 'guards').map((name) => this.createValueCompletion(name, 'Guard'));
            case 'actor':
                return this.collectSetupKeys(sourceFile, 'actors').map((name) => this.createValueCompletion(name, 'Actor'));
            default:
                return [];
        }
    }

    private getValueContext(node: ts.Node, offset: number): ValueContext {
        const stringNode = this.findStringLiteralAtOffset(node, offset);
        if (!stringNode) {
            return 'none';
        }

        const property = this.findPropertyForValueNode(stringNode);
        if (!property) {
            return 'none';
        }

        const propertyName = this.getPropertyName(property.name);
        if (!propertyName) {
            return 'none';
        }

        if (propertyName === 'target' || propertyName === 'initial') {
            return 'state';
        }

        if (propertyName === 'actions' || propertyName === 'entry' || propertyName === 'exit') {
            return 'action';
        }

        if (propertyName === 'guard' || propertyName === 'cond') {
            return 'guard';
        }

        if (propertyName === 'src') {
            return 'actor';
        }

        // Transition shorthand: on: { EVENT: 'target' } / after: { 1000: 'target' } / always: 'target'
        if (this.isTransitionTargetShorthand(property)) {
            return 'state';
        }

        return 'none';
    }

    private getObjectContext(objectLiteral: ts.ObjectLiteralExpression): ObjectContext {
        if (this.isSetupConfigObject(objectLiteral)) {
            return 'setup';
        }

        if (this.isMachineConfigObject(objectLiteral)) {
            return 'machine';
        }

        if (this.isInvokeConfigObject(objectLiteral)) {
            return 'invoke';
        }

        if (this.isTransitionConfigObject(objectLiteral)) {
            return 'transition';
        }

        if (this.isStateConfigObject(objectLiteral)) {
            return 'state';
        }

        return 'none';
    }

    private getPropertiesForContext(context: ObjectContext): PropertySchema[] {
        switch (context) {
            case 'machine':
                return this.machineRootProperties;
            case 'state':
                return this.stateProperties;
            case 'transition':
                return this.transitionProperties;
            case 'invoke':
                return this.invokeProperties;
            case 'setup':
                return this.setupProperties;
            default:
                return [];
        }
    }

    private collectStateTargets(machineConfig: ts.ObjectLiteralExpression): string[] {
        const statesProperty = this.findProperty(machineConfig, 'states');
        if (!statesProperty || !ts.isObjectLiteralExpression(statesProperty.initializer)) {
            return [];
        }

        const targets = new Set<string>();
        this.collectStateTargetsFromStatesObject(statesProperty.initializer, [], targets);
        return Array.from(targets).sort();
    }

    private collectStateTargetsFromStatesObject(
        statesObject: ts.ObjectLiteralExpression,
        path: string[],
        targets: Set<string>
    ): void {
        for (const property of statesObject.properties) {
            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            const stateName = this.getPropertyName(property.name);
            if (!stateName || !ts.isObjectLiteralExpression(property.initializer)) {
                continue;
            }

            const nextPath = [...path, stateName];
            targets.add(nextPath.join('.'));
            if (path.length === 0) {
                targets.add(stateName);
            }

            const childStatesProperty = this.findProperty(property.initializer, 'states');
            if (childStatesProperty && ts.isObjectLiteralExpression(childStatesProperty.initializer)) {
                this.collectStateTargetsFromStatesObject(childStatesProperty.initializer, nextPath, targets);
            }
        }
    }

    private collectSetupKeys(sourceFile: ts.SourceFile, sectionName: 'actions' | 'guards' | 'actors'): string[] {
        const keys = new Set<string>();

        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && this.isSetupCallExpression(node)) {
                const [arg] = node.arguments;
                if (arg && ts.isObjectLiteralExpression(arg)) {
                    const section = this.findProperty(arg, sectionName);
                    if (section && ts.isObjectLiteralExpression(section.initializer)) {
                        for (const property of section.initializer.properties) {
                            if (!ts.isPropertyAssignment(property)) {
                                continue;
                            }
                            const name = this.getPropertyName(property.name);
                            if (name) {
                                keys.add(name);
                            }
                        }
                    }
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return Array.from(keys).sort();
    }

    private getExistingPropertyNames(objectLiteral: ts.ObjectLiteralExpression): Set<string> {
        const names = new Set<string>();

        for (const property of objectLiteral.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
                continue;
            }

            const name = this.getPropertyName(property.name);
            if (name) {
                names.add(name);
            }
        }

        return names;
    }

    private isTransitionTargetShorthand(property: ts.PropertyAssignment): boolean {
        if (!ts.isStringLiteralLike(property.initializer)) {
            return false;
        }

        const containerObject = property.parent;
        if (!ts.isObjectLiteralExpression(containerObject)) {
            return false;
        }

        const containerProperty = this.findAncestor(containerObject, ts.isPropertyAssignment);
        const containerName = containerProperty ? this.getPropertyName(containerProperty.name) : undefined;
        return containerName === 'on' || containerName === 'after' || containerName === 'always';
    }

    private isMachineConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
        const parent = objectLiteral.parent;
        if (!ts.isCallExpression(parent)) {
            return false;
        }
        return parent.arguments[0] === objectLiteral && this.isMachineCallExpression(parent);
    }

    private isSetupConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
        const parent = objectLiteral.parent;
        return ts.isCallExpression(parent) && parent.arguments[0] === objectLiteral && this.isSetupCallExpression(parent);
    }

    private isStateConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
        const property = this.findAncestor(objectLiteral, ts.isPropertyAssignment);
        if (!property || property.initializer !== objectLiteral) {
            return false;
        }

        const container = property.parent;
        if (!ts.isObjectLiteralExpression(container)) {
            return false;
        }

        const containerProperty = this.findAncestor(container, ts.isPropertyAssignment);
        return !!containerProperty && this.getPropertyName(containerProperty.name) === 'states';
    }

    private isTransitionConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
        const property = this.findAncestor(objectLiteral, ts.isPropertyAssignment);
        if (!property || property.initializer !== objectLiteral) {
            return false;
        }

        const propertyName = this.getPropertyName(property.name);
        if (propertyName === 'always' || propertyName === 'onDone' || propertyName === 'onError') {
            return true;
        }

        const container = property.parent;
        if (!ts.isObjectLiteralExpression(container)) {
            return false;
        }

        const containerProperty = this.findAncestor(container, ts.isPropertyAssignment);
        const containerName = containerProperty ? this.getPropertyName(containerProperty.name) : undefined;
        return containerName === 'on' || containerName === 'after';
    }

    private isInvokeConfigObject(objectLiteral: ts.ObjectLiteralExpression): boolean {
        const property = this.findAncestor(objectLiteral, ts.isPropertyAssignment);
        if (property && property.initializer === objectLiteral && this.getPropertyName(property.name) === 'invoke') {
            return true;
        }

        const array = this.findAncestor(objectLiteral, ts.isArrayLiteralExpression);
        if (!array) {
            return false;
        }

        const invokeProperty = this.findAncestor(array, ts.isPropertyAssignment);
        return !!invokeProperty && this.getPropertyName(invokeProperty.name) === 'invoke';
    }

    private isMachineCallExpression(callExpression: ts.CallExpression): boolean {
        const callee = callExpression.expression;

        if (ts.isIdentifier(callee)) {
            return ['createMachine', 'Machine', 'createStateConfig', 'stateConfig'].includes(callee.text);
        }

        if (ts.isPropertyAccessExpression(callee)) {
            return ['createMachine', 'Machine', 'createStateConfig', 'stateConfig'].includes(callee.name.text);
        }

        return false;
    }

    private isSetupCallExpression(callExpression: ts.CallExpression): boolean {
        return ts.isIdentifier(callExpression.expression) && callExpression.expression.text === 'setup';
    }

    private findMachineConfig(node: ts.Node): ts.ObjectLiteralExpression | undefined {
        let current: ts.Node | undefined = node;

        while (current) {
            if (ts.isObjectLiteralExpression(current) && this.isMachineConfigObject(current)) {
                return current;
            }
            current = current.parent;
        }

        return undefined;
    }

    private findPropertyForValueNode(node: ts.Node): ts.PropertyAssignment | undefined {
        const directProperty = this.findAncestor(node, ts.isPropertyAssignment);
        if (directProperty) {
            return directProperty;
        }

        const arrayLiteral = this.findAncestor(node, ts.isArrayLiteralExpression);
        if (!arrayLiteral) {
            return undefined;
        }

        return this.findAncestor(arrayLiteral, ts.isPropertyAssignment);
    }

    private findProperty(objectLiteral: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
        return objectLiteral.properties.find((property): property is ts.PropertyAssignment => {
            return ts.isPropertyAssignment(property) && this.getPropertyName(property.name) === name;
        });
    }

    private getPropertyName(name: ts.PropertyName | undefined): string | undefined {
        if (!name) {
            return undefined;
        }
        if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
            return name.text;
        }
        return undefined;
    }

    private findStringLiteralAtOffset(node: ts.Node, offset: number): ts.StringLiteralLike | undefined {
        const stringNode = this.findAncestor(node, (candidate): candidate is ts.StringLiteralLike => {
            return (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) &&
                candidate.getStart() <= offset &&
                offset <= candidate.getEnd();
        });

        return stringNode;
    }

    private findDeepestNode(root: ts.Node, offset: number): ts.Node {
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

    private findAncestor<T extends ts.Node>(
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

    private createPropertyCompletion(prop: PropertySchema): vscode.CompletionItem {
        const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
        const versions: string[] = [];
        if (prop.v4) { versions.push('v4'); }
        if (prop.v5) { versions.push('v5'); }

        let documentation = prop.description;
        if (versions.length > 0) {
            documentation += ` (XState ${versions.join(', ')})`;
        }

        item.documentation = new vscode.MarkdownString(documentation);
        item.insertText = `${prop.name}: `;
        item.sortText = `1_${prop.name}`;
        item.detail = versions.length > 0 ? `XState ${versions.join(', ')}` : undefined;
        return item;
    }

    private createValueCompletion(name: string, detail: string): vscode.CompletionItem {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
        item.insertText = name;
        item.sortText = `1_${name}`;
        item.detail = detail;
        return item;
    }
}
