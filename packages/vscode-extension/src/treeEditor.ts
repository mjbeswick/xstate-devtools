import * as vscode from 'vscode';
import * as ts from 'typescript';
import type { XStateMachineTreeItem } from './treeProvider';

type SetupSection = 'actions' | 'guards' | 'actors' | 'delays';

export class XStateTreeEditor {
    static async editNode(treeItem: XStateMachineTreeItem): Promise<void> {
        switch (treeItem.node.type) {
            case 'state':
            case 'transition':
            case 'contextProperty':
            case 'invalid':
                await this.renameNode(treeItem);
                return;
            case 'target':
            case 'action':
            case 'guard':
            case 'invoke':
                await this.changeValue(treeItem);
                return;
            case 'actor':
            case 'delay':
                await this.renameNode(treeItem);
                return;
            default:
                vscode.window.showInformationMessage(`Editing is not supported for ${treeItem.node.type} nodes yet.`);
        }
    }

    static async renameNode(treeItem: XStateMachineTreeItem): Promise<void> {
        const editor = await this.openEditor(treeItem);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const rangeOffsets = this.toOffsets(document, treeItem.range!);

        switch (treeItem.node.type) {
            case 'state': {
                const stateProperty = this.findStateProperty(parsed, rangeOffsets.start, rangeOffsets.end, treeItem.node.label);
                if (!stateProperty) {
                    vscode.window.showInformationMessage('Could not resolve the selected state in source.');
                    return;
                }
                const currentName = this.getPropertyName(stateProperty.name);
                if (!currentName) { return; }
                const nextName = await vscode.window.showInputBox({
                    prompt: 'Rename state',
                    value: currentName,
                    validateInput: (value) => this.validateIdentifier(value)
                });
                if (!nextName || nextName === currentName) { return; }
                await this.applyRangeEdit(document, this.nodeRange(document, stateProperty.name), nextName);
                return;
            }
            case 'transition': {
                const transitionProperty = this.findTransitionProperty(parsed, rangeOffsets.start, rangeOffsets.end, treeItem.node.label);
                if (!transitionProperty) {
                    vscode.window.showInformationMessage('Only named transitions can be renamed from the outline.');
                    return;
                }
                const currentName = this.getPropertyName(transitionProperty.name);
                if (!currentName) { return; }
                const nextName = await vscode.window.showInputBox({
                    prompt: 'Rename transition/event',
                    value: currentName,
                    validateInput: (value) => this.validateIdentifier(value)
                });
                if (!nextName || nextName === currentName) { return; }
                await this.applyRangeEdit(document, this.nodeRange(document, transitionProperty.name), nextName);
                return;
            }
            case 'contextProperty': {
                const property = this.findPropertyByExactRange(parsed, rangeOffsets.start, rangeOffsets.end);
                if (!property) {
                    vscode.window.showInformationMessage('Could not resolve the selected context property in source.');
                    return;
                }
                const currentName = this.getPropertyName(property.name);
                if (!currentName) { return; }
                const nextName = await vscode.window.showInputBox({
                    prompt: 'Rename context property',
                    value: currentName,
                    validateInput: (value) => this.validateIdentifier(value)
                });
                if (!nextName || nextName === currentName) { return; }
                await this.applyRangeEdit(document, this.nodeRange(document, property.name), nextName);
                return;
            }
            case 'action':
            case 'guard':
            case 'actor':
            case 'delay': {
                const setupProperty = this.findSetupImplementationProperty(parsed, rangeOffsets.start, rangeOffsets.end);
                if (!setupProperty) {
                    vscode.window.showInformationMessage(`Renaming ${treeItem.node.type} references is handled via “Change value”.`);
                    return;
                }
                const currentName = this.getPropertyName(setupProperty.name);
                if (!currentName) { return; }
                const nextName = await vscode.window.showInputBox({
                    prompt: `Rename setup ${treeItem.node.type}`,
                    value: currentName,
                    validateInput: (value) => this.validateIdentifier(value)
                });
                if (!nextName || nextName === currentName) { return; }
                await this.applyRangeEdit(document, this.nodeRange(document, setupProperty.name), nextName);
                return;
            }
            case 'invalid': {
                const property = this.findPropertyByExactRange(parsed, rangeOffsets.start, rangeOffsets.end);
                if (!property) {
                    vscode.window.showInformationMessage('Could not resolve the invalid property in source.');
                    return;
                }
                const currentName = this.getPropertyName(property.name);
                if (!currentName) { return; }
                const nextName = await vscode.window.showInputBox({
                    prompt: 'Rename invalid property',
                    value: currentName,
                    validateInput: (value) => this.validateIdentifier(value)
                });
                if (!nextName || nextName === currentName) { return; }
                await this.applyRangeEdit(document, this.nodeRange(document, property.name), nextName);
                return;
            }
            default:
                vscode.window.showInformationMessage(`Renaming is not supported for ${treeItem.node.type} nodes.`);
        }
    }

    static async changeValue(treeItem: XStateMachineTreeItem): Promise<void> {
        const editor = await this.openEditor(treeItem);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, treeItem.range!);

        if (treeItem.node.type === 'target') {
            const literal = this.findStringLikeNode(parsed, offsets.start, offsets.end);
            if (!literal) {
                vscode.window.showInformationMessage('Could not resolve the selected target in source.');
                return;
            }

            const machineConfig = this.findContainingMachineConfig(literal);
            const validTargets = machineConfig ? this.collectStateTargets(machineConfig) : [];
            const next = await this.pickOrInput('Select target state', validTargets, treeItem.node.label);
            if (!next || next === treeItem.node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, literal), this.quote(next));
            return;
        }

        if (treeItem.node.type === 'action') {
            const setupProperty = this.findSetupImplementationProperty(parsed, offsets.start, offsets.end);
            if (setupProperty) {
                vscode.window.showInformationMessage('Setup action definitions can be renamed or deleted from the outline.');
                return;
            }
            const valueNode = this.findValueNode(parsed, offsets.start, offsets.end);
            if (!valueNode) {
                vscode.window.showInformationMessage('Could not resolve the selected action reference in source.');
                return;
            }
            const next = await this.pickOrInput('Select action', this.collectSetupKeys(parsed, 'actions'), treeItem.node.label);
            if (!next || next === treeItem.node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, valueNode), this.stringifyValueLike(valueNode, next));
            return;
        }

        if (treeItem.node.type === 'guard') {
            const setupProperty = this.findSetupImplementationProperty(parsed, offsets.start, offsets.end);
            if (setupProperty) {
                vscode.window.showInformationMessage('Setup guard definitions can be renamed or deleted from the outline.');
                return;
            }
            const valueNode = this.findValueNode(parsed, offsets.start, offsets.end);
            if (!valueNode) {
                vscode.window.showInformationMessage('Could not resolve the selected guard reference in source.');
                return;
            }
            const next = await this.pickOrInput('Select guard', this.collectSetupKeys(parsed, 'guards'), treeItem.node.label);
            if (!next || next === treeItem.node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, valueNode), this.stringifyValueLike(valueNode, next));
            return;
        }

        if (treeItem.node.type === 'invoke') {
            const invokeObject = this.findInvokeObject(parsed, offsets.start, offsets.end);
            if (!invokeObject) {
                vscode.window.showInformationMessage('Could not resolve the selected invoke block in source.');
                return;
            }
            const srcProperty = this.findProperty(invokeObject, 'src');
            if (!srcProperty) {
                vscode.window.showInformationMessage('Could not resolve invoke.src in source.');
                return;
            }
            const next = await this.pickOrInput('Select actor source', this.collectSetupKeys(parsed, 'actors'), treeItem.node.label);
            if (!next || next === treeItem.node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, srcProperty.initializer), this.stringifyValueLike(srcProperty.initializer, next));
            return;
        }

        if (treeItem.node.type === 'contextProperty') {
            const property = this.findPropertyByExactRange(parsed, offsets.start, offsets.end);
            if (!property) {
                vscode.window.showInformationMessage('Could not resolve the selected context property in source.');
                return;
            }
            const next = await vscode.window.showInputBox({
                prompt: 'Enter new property value',
                value: property.initializer.getText(parsed)
            });
            if (!next || next === property.initializer.getText(parsed)) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, property.initializer), next);
            return;
        }

        vscode.window.showInformationMessage(`Changing the value of ${treeItem.node.type} nodes is not supported yet.`);
    }

    static async deleteNode(treeItem: XStateMachineTreeItem): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            `Delete ${treeItem.node.label}?`,
            { modal: true },
            'Delete'
        );
        if (confirmed !== 'Delete') { return; }

        const editor = await this.openEditor(treeItem);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, treeItem.range!);

        const property = this.findDeletableProperty(parsed, offsets.start, offsets.end, treeItem.node.type);
        if (property) {
            await this.applyRangeEdit(document, this.deletionRange(document, property), '');
            return;
        }

        const element = this.findArrayElement(parsed, offsets.start, offsets.end);
        if (element) {
            await this.applyRangeEdit(document, this.deletionRange(document, element), '');
            return;
        }

        vscode.window.showInformationMessage(`Could not delete the selected ${treeItem.node.type} node safely.`);
    }

    static async addChildState(treeItem: XStateMachineTreeItem): Promise<void> {
        const editor = await this.openEditor(treeItem);
        const document = editor.document;
        const parsed = this.parseDocument(document);

        const stateName = await vscode.window.showInputBox({
            prompt: treeItem.node.type === 'machine' ? 'New top-level state name' : 'New child state name',
            validateInput: (value) => this.validateIdentifier(value)
        });
        if (!stateName) { return; }

        if (treeItem.node.type === 'machine') {
            const machineConfig = this.findMachineConfigByRange(parsed, ...Object.values(this.toOffsets(document, treeItem.range!)));
            if (!machineConfig) {
                vscode.window.showInformationMessage('Could not resolve the selected machine in source.');
                return;
            }
            await this.insertStateIntoConfig(document, machineConfig, stateName);
            return;
        }

        if (treeItem.node.type === 'state') {
            const stateProperty = this.findStateProperty(parsed, ...Object.values(this.toOffsets(document, treeItem.range!)), treeItem.node.label);
            if (!stateProperty || !ts.isObjectLiteralExpression(stateProperty.initializer)) {
                vscode.window.showInformationMessage('Could not resolve the selected state in source.');
                return;
            }
            await this.insertStateIntoConfig(document, stateProperty.initializer, stateName);
            return;
        }

        vscode.window.showInformationMessage('Add child state is only supported for machine and state nodes.');
    }

    static async addTransition(treeItem: XStateMachineTreeItem): Promise<void> {
        if (treeItem.node.type !== 'state') {
            vscode.window.showInformationMessage('Add transition is only supported on state nodes.');
            return;
        }

        const editor = await this.openEditor(treeItem);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const stateProperty = this.findStateProperty(parsed, ...Object.values(this.toOffsets(document, treeItem.range!)), treeItem.node.label);
        if (!stateProperty || !ts.isObjectLiteralExpression(stateProperty.initializer)) {
            vscode.window.showInformationMessage('Could not resolve the selected state in source.');
            return;
        }

        const eventName = await vscode.window.showInputBox({
            prompt: 'Transition event name',
            validateInput: (value) => this.validateIdentifier(value)
        });
        if (!eventName) { return; }

        const machineConfig = this.findContainingMachineConfig(stateProperty.initializer);
        const targets = machineConfig ? this.collectStateTargets(machineConfig) : [];
        const target = await this.pickOrInput('Select target state', targets);
        if (!target) { return; }

        const onProperty = this.findProperty(stateProperty.initializer, 'on');
        if (onProperty && ts.isObjectLiteralExpression(onProperty.initializer)) {
            await this.insertProperty(document, onProperty.initializer, `${eventName}: { target: ${this.quote(target)} }`);
            return;
        }

        await this.insertProperty(
            document,
            stateProperty.initializer,
            `on: {\n${this.childIndent(document, stateProperty.initializer)}${eventName}: { target: ${this.quote(target)} }\n${this.baseIndent(document, stateProperty.initializer)}}`
        );
    }

    static async addReference(treeItem: XStateMachineTreeItem): Promise<void> {
        const editor = await this.openEditor(treeItem);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, treeItem.range!);

        if (treeItem.node.type === 'state' || treeItem.node.type === 'machine') {
            const kind = await vscode.window.showQuickPick(['Entry action', 'Exit action', 'Invoke'], {
                placeHolder: 'Select what to add'
            });
            if (!kind) { return; }

            const configObject = treeItem.node.type === 'machine'
                ? this.findMachineConfigByRange(parsed, offsets.start, offsets.end)
                : this.findStateProperty(parsed, offsets.start, offsets.end, treeItem.node.label)?.initializer;
            if (!configObject || !ts.isObjectLiteralExpression(configObject)) {
                vscode.window.showInformationMessage('Could not resolve the selected node in source.');
                return;
            }

            if (kind === 'Invoke') {
                const actor = await this.pickOrInput('Select actor source', this.collectSetupKeys(parsed, 'actors'));
                if (!actor) { return; }
                await this.addInvokeReference(document, configObject, actor);
                return;
            }

            const propertyName = kind === 'Entry action' ? 'entry' : 'exit';
            const action = await this.pickOrInput(`Select ${propertyName} action`, this.collectSetupKeys(parsed, 'actions'));
            if (!action) { return; }
            await this.addNamedReference(document, configObject, propertyName, action);
            return;
        }

        if (treeItem.node.type === 'transition') {
            const transitionProperty = this.findTransitionProperty(parsed, offsets.start, offsets.end, treeItem.node.label);
            if (!transitionProperty) {
                vscode.window.showInformationMessage('Add action/guard is only supported on named transition handlers.');
                return;
            }

            const kind = await vscode.window.showQuickPick(['Action', 'Guard'], {
                placeHolder: 'Select what to add'
            });
            if (!kind) { return; }

            const chosen = kind === 'Action'
                ? await this.pickOrInput('Select action', this.collectSetupKeys(parsed, 'actions'))
                : await this.pickOrInput('Select guard', this.collectSetupKeys(parsed, 'guards'));
            if (!chosen) { return; }

            await this.addTransitionReference(document, transitionProperty, kind, chosen);
            return;
        }

        if (treeItem.node.type === 'setup' || ['action', 'guard', 'actor', 'delay'].includes(treeItem.node.type)) {
            const setupConfig = treeItem.node.type === 'setup'
                ? this.findSetupConfigByRange(parsed, offsets.start, offsets.end)
                : this.findContainingSetupConfig(parsed, offsets.start, offsets.end);
            if (!setupConfig) {
                vscode.window.showInformationMessage('Could not resolve the selected setup block in source.');
                return;
            }

            const initialSection = this.inferSetupSection(treeItem.node.type);
            const section = initialSection ?? await vscode.window.showQuickPick(['actions', 'guards', 'actors', 'delays'], {
                placeHolder: 'Select setup section'
            }) as SetupSection | undefined;
            if (!section) { return; }

            const name = await vscode.window.showInputBox({
                prompt: `New setup ${section.slice(0, -1)} name`,
                validateInput: (value) => this.validateIdentifier(value)
            });
            if (!name) { return; }

            await this.addSetupImplementation(document, setupConfig, section, name);
            return;
        }

        vscode.window.showInformationMessage('Add action/guard/invoke is not supported for this node.');
    }

    private static async addSetupImplementation(
        document: vscode.TextDocument,
        setupConfig: ts.ObjectLiteralExpression,
        section: SetupSection,
        name: string
    ): Promise<void> {
        const sectionProperty = this.findProperty(setupConfig, section);
        const defaultValue = this.defaultSetupValue(section);
        if (sectionProperty && ts.isObjectLiteralExpression(sectionProperty.initializer)) {
            await this.insertProperty(document, sectionProperty.initializer, `${name}: ${defaultValue}`);
            return;
        }

        const sectionBody = `{\n${this.childIndent(document, setupConfig)}${name}: ${defaultValue}\n${this.baseIndent(document, setupConfig)}}`;
        await this.insertProperty(document, setupConfig, `${section}: ${sectionBody}`);
    }

    private static async addInvokeReference(
        document: vscode.TextDocument,
        configObject: ts.ObjectLiteralExpression,
        actor: string
    ): Promise<void> {
        const invokeProperty = this.findProperty(configObject, 'invoke');
        if (!invokeProperty) {
            await this.insertProperty(document, configObject, `invoke: { src: ${this.quote(actor)} }`);
            return;
        }

        const initializer = invokeProperty.initializer;
        if (ts.isArrayLiteralExpression(initializer)) {
            await this.insertArrayElement(document, initializer, `{ src: ${this.quote(actor)} }`);
            return;
        }

        if (ts.isObjectLiteralExpression(initializer)) {
            await this.applyRangeEdit(
                document,
                this.nodeRange(document, initializer),
                `[\n${this.childIndent(document, initializer)}${initializer.getText()},\n${this.childIndent(document, initializer)}{ src: ${this.quote(actor)} }\n${this.baseIndent(document, initializer)}]`
            );
            return;
        }
    }

    private static async addNamedReference(
        document: vscode.TextDocument,
        configObject: ts.ObjectLiteralExpression,
        propertyName: 'entry' | 'exit',
        value: string
    ): Promise<void> {
        const existing = this.findProperty(configObject, propertyName);
        if (!existing) {
            await this.insertProperty(document, configObject, `${propertyName}: ${this.quote(value)}`);
            return;
        }

        await this.appendReferenceValue(document, existing.initializer, value);
    }

    private static async addTransitionReference(
        document: vscode.TextDocument,
        transitionProperty: ts.PropertyAssignment,
        kind: 'Action' | 'Guard',
        value: string
    ): Promise<void> {
        const initializer = transitionProperty.initializer;

        if (ts.isStringLiteralLike(initializer)) {
            const rewritten = kind === 'Action'
                ? `{ target: ${initializer.getText()}, actions: ${this.quote(value)} }`
                : `{ target: ${initializer.getText()}, guard: ${this.quote(value)} }`;
            await this.applyRangeEdit(document, this.nodeRange(document, initializer), rewritten);
            return;
        }

        if (!ts.isObjectLiteralExpression(initializer)) {
            vscode.window.showInformationMessage('Conditional transition branches are not editable from this menu yet.');
            return;
        }

        if (kind === 'Action') {
            const actionsProperty = this.findProperty(initializer, 'actions');
            if (!actionsProperty) {
                await this.insertProperty(document, initializer, `actions: ${this.quote(value)}`);
                return;
            }
            await this.appendReferenceValue(document, actionsProperty.initializer, value);
            return;
        }

        const guardProperty = this.findProperty(initializer, 'guard') ?? this.findProperty(initializer, 'cond');
        if (!guardProperty) {
            await this.insertProperty(document, initializer, `guard: ${this.quote(value)}`);
            return;
        }
        await this.applyRangeEdit(document, this.nodeRange(document, guardProperty.initializer), this.quote(value));
    }

    private static async appendReferenceValue(
        document: vscode.TextDocument,
        initializer: ts.Expression,
        value: string
    ): Promise<void> {
        if (ts.isStringLiteralLike(initializer) || ts.isIdentifier(initializer)) {
            await this.applyRangeEdit(
                document,
                this.nodeRange(document, initializer),
                `[${this.stringifyValueLike(initializer, initializer.getText().replace(/^['"`]|['"`]$/g, ''))}, ${this.quote(value)}]`
            );
            return;
        }

        if (ts.isArrayLiteralExpression(initializer)) {
            await this.insertArrayElement(document, initializer, this.quote(value));
        }
    }

    private static async insertStateIntoConfig(
        document: vscode.TextDocument,
        configObject: ts.ObjectLiteralExpression,
        stateName: string
    ): Promise<void> {
        const statesProperty = this.findProperty(configObject, 'states');
        if (statesProperty && ts.isObjectLiteralExpression(statesProperty.initializer)) {
            await this.insertProperty(document, statesProperty.initializer, `${stateName}: {}`);
            return;
        }

        const body = `{\n${this.childIndent(document, configObject)}${stateName}: {}\n${this.baseIndent(document, configObject)}}`;
        await this.insertProperty(document, configObject, `states: ${body}`);
    }

    private static inferSetupSection(nodeType: string): SetupSection | undefined {
        switch (nodeType) {
            case 'action':
                return 'actions';
            case 'guard':
                return 'guards';
            case 'actor':
            case 'invoke':
                return 'actors';
            case 'delay':
                return 'delays';
            default:
                return undefined;
        }
    }

    private static defaultSetupValue(section: SetupSection): string {
        switch (section) {
            case 'actions':
                return '() => {}';
            case 'guards':
                return '() => true';
            case 'actors':
                return '() => Promise.resolve(undefined)';
            case 'delays':
                return '1000';
        }
    }

    private static findContainingMachineConfig(node: ts.Node): ts.ObjectLiteralExpression | undefined {
        let current: ts.Node | undefined = node;
        while (current) {
            if (ts.isObjectLiteralExpression(current) && this.isMachineConfigObject(current)) {
                return current;
            }
            current = current.parent;
        }
        return undefined;
    }

    private static findContainingSetupConfig(sourceFile: ts.SourceFile, start: number, end: number): ts.ObjectLiteralExpression | undefined {
        let found: ts.ObjectLiteralExpression | undefined;
        const visit = (node: ts.Node): void => {
            if (node.getStart() > start || node.getEnd() < end) {
                return;
            }
            if (ts.isObjectLiteralExpression(node) && this.isSetupConfigObject(node)) {
                found = node;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findSetupConfigByRange(sourceFile: ts.SourceFile, start: number, end: number): ts.ObjectLiteralExpression | undefined {
        let found: ts.ObjectLiteralExpression | undefined;
        const visit = (node: ts.Node): void => {
            if (!ts.isObjectLiteralExpression(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            if (this.isSetupConfigObject(node) && node.getStart() === start && node.getEnd() === end) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findMachineConfigByRange(sourceFile: ts.SourceFile, start: number, end: number): ts.ObjectLiteralExpression | undefined {
        let found: ts.ObjectLiteralExpression | undefined;
        const visit = (node: ts.Node): void => {
            if (!ts.isObjectLiteralExpression(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            if (this.isMachineConfigObject(node) && node.getStart() === start && node.getEnd() === end) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findStateProperty(sourceFile: ts.SourceFile, start: number, end: number, label: string): ts.PropertyAssignment | undefined {
        let found: ts.PropertyAssignment | undefined;
        const visit = (node: ts.Node): void => {
            if (found || !ts.isPropertyAssignment(node) || !ts.isObjectLiteralExpression(node.initializer)) {
                ts.forEachChild(node, visit);
                return;
            }
            const name = this.getPropertyName(node.name);
            if (name === label && node.initializer.getStart() === start && node.initializer.getEnd() === end) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findTransitionProperty(sourceFile: ts.SourceFile, start: number, end: number, label: string): ts.PropertyAssignment | undefined {
        let found: ts.PropertyAssignment | undefined;
        const baseLabel = label.split(' → ')[0];
        const visit = (node: ts.Node): void => {
            if (found || !ts.isPropertyAssignment(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            const name = this.getPropertyName(node.name);
            if (!name) {
                ts.forEachChild(node, visit);
                return;
            }
            if (name === baseLabel && ((node.getStart() === start && node.getEnd() === end) || (node.initializer.getStart() === start && node.initializer.getEnd() === end))) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findInvokeObject(sourceFile: ts.SourceFile, start: number, end: number): ts.ObjectLiteralExpression | undefined {
        let found: ts.ObjectLiteralExpression | undefined;
        const visit = (node: ts.Node): void => {
            if (found || !ts.isObjectLiteralExpression(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            if (node.getStart() === start && node.getEnd() === end) {
                const srcProperty = this.findProperty(node, 'src');
                if (srcProperty) {
                    found = node;
                    return;
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findPropertyByExactRange(sourceFile: ts.SourceFile, start: number, end: number): ts.PropertyAssignment | undefined {
        let found: ts.PropertyAssignment | undefined;
        const visit = (node: ts.Node): void => {
            if (found || !ts.isPropertyAssignment(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            if (node.getStart() === start && node.getEnd() === end) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findSetupImplementationProperty(sourceFile: ts.SourceFile, start: number, end: number): ts.PropertyAssignment | undefined {
        const property = this.findPropertyByExactRange(sourceFile, start, end);
        if (!property) {
            return undefined;
        }
        const sectionObject = property.parent;
        if (!ts.isObjectLiteralExpression(sectionObject)) {
            return undefined;
        }
        const containerProperty = this.findAncestor(sectionObject, ts.isPropertyAssignment);
        const sectionName = containerProperty ? this.getPropertyName(containerProperty.name) : undefined;
        const setupConfig = this.findAncestor(sectionObject, ts.isObjectLiteralExpression);
        if (!setupConfig || !this.isSetupConfigObject(setupConfig)) {
            return undefined;
        }
        return ['actions', 'guards', 'actors', 'delays'].includes(sectionName ?? '') ? property : undefined;
    }

    private static findDeletableProperty(sourceFile: ts.SourceFile, start: number, end: number, nodeType: string): ts.PropertyAssignment | undefined {
        if (['state', 'transition', 'contextProperty', 'invalid', 'actor', 'delay'].includes(nodeType)) {
            return this.findPropertyByExactRange(sourceFile, start, end)
                ?? this.findTransitionProperty(sourceFile, start, end, '');
        }

        const containing = this.findContainingProperty(sourceFile, start, end);
        if (!containing) {
            return undefined;
        }

        if (nodeType === 'target') {
            const propertyName = this.getPropertyName(containing.name);
            return propertyName === 'target' ? containing : containing;
        }

        if (nodeType === 'guard') {
            return ['guard', 'cond'].includes(this.getPropertyName(containing.name) ?? '') ? containing : undefined;
        }

        if (nodeType === 'action') {
            return ['actions', 'entry', 'exit'].includes(this.getPropertyName(containing.name) ?? '') ? containing : undefined;
        }

        if (nodeType === 'invoke') {
            const invokeObject = this.findInvokeObject(sourceFile, start, end);
            if (!invokeObject) {
                return undefined;
            }
            return this.findAncestor(invokeObject, ts.isPropertyAssignment);
        }

        return undefined;
    }

    private static findContainingProperty(sourceFile: ts.SourceFile, start: number, end: number): ts.PropertyAssignment | undefined {
        let found: ts.PropertyAssignment | undefined;
        const visit = (node: ts.Node): void => {
            if (found || !ts.isPropertyAssignment(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            if (node.getStart() <= start && node.getEnd() >= end) {
                found = node;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findArrayElement(sourceFile: ts.SourceFile, start: number, end: number): ts.Expression | undefined {
        let found: ts.Expression | undefined;
        const visit = (node: ts.Node): void => {
            if (found || !ts.isArrayLiteralExpression(node)) {
                ts.forEachChild(node, visit);
                return;
            }
            for (const element of node.elements) {
                if (element.getStart() === start && element.getEnd() === end) {
                    found = element;
                    return;
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findStringLikeNode(sourceFile: ts.SourceFile, start: number, end: number): ts.StringLiteralLike | undefined {
        let found: ts.StringLiteralLike | undefined;
        const visit = (node: ts.Node): void => {
            if (found) {
                return;
            }
            if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.getStart() === start && node.getEnd() === end) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static findValueNode(sourceFile: ts.SourceFile, start: number, end: number): ts.Node | undefined {
        let found: ts.Node | undefined;
        const visit = (node: ts.Node): void => {
            if (found) {
                return;
            }
            const isMatch = (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) && node.getStart() === start && node.getEnd() === end;
            if (isMatch) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    private static collectStateTargets(machineConfig: ts.ObjectLiteralExpression): string[] {
        const statesProperty = this.findProperty(machineConfig, 'states');
        if (!statesProperty || !ts.isObjectLiteralExpression(statesProperty.initializer)) {
            return [];
        }
        const targets = new Set<string>();
        this.collectStateTargetsFromStatesObject(statesProperty.initializer, [], targets);
        return Array.from(targets).sort();
    }

    private static collectStateTargetsFromStatesObject(statesObject: ts.ObjectLiteralExpression, path: string[], targets: Set<string>): void {
        for (const property of statesObject.properties) {
            if (!ts.isPropertyAssignment(property)) { continue; }
            const name = this.getPropertyName(property.name);
            if (!name || !ts.isObjectLiteralExpression(property.initializer)) { continue; }
            const nextPath = [...path, name];
            const dotted = nextPath.join('.');
            targets.add(dotted);
            if (path.length === 0) {
                targets.add(name);
            }
            const nested = this.findProperty(property.initializer, 'states');
            if (nested && ts.isObjectLiteralExpression(nested.initializer)) {
                this.collectStateTargetsFromStatesObject(nested.initializer, nextPath, targets);
            }
        }
    }

    private static collectSetupKeys(sourceFile: ts.SourceFile, section: SetupSection): string[] {
        const keys = new Set<string>();
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && this.isSetupCallExpression(node)) {
                const [arg] = node.arguments;
                if (arg && ts.isObjectLiteralExpression(arg)) {
                    const sectionProperty = this.findProperty(arg, section);
                    if (sectionProperty && ts.isObjectLiteralExpression(sectionProperty.initializer)) {
                        for (const property of sectionProperty.initializer.properties) {
                            if (!ts.isPropertyAssignment(property)) { continue; }
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

    private static async pickOrInput(placeHolder: string, options: string[], initialValue?: string): Promise<string | undefined> {
        const items = options.map((label) => ({ label }));
        items.push({ label: '$(edit) Enter custom value…' });
        const picked = await vscode.window.showQuickPick(items, { placeHolder });
        if (!picked) { return undefined; }
        if (picked.label !== '$(edit) Enter custom value…') {
            return picked.label;
        }
        return vscode.window.showInputBox({ prompt: placeHolder, value: initialValue });
    }

    private static async openEditor(treeItem: XStateMachineTreeItem): Promise<vscode.TextEditor> {
        if (!treeItem.uri) {
            throw new Error('Tree item has no URI.');
        }
        const document = await vscode.workspace.openTextDocument(treeItem.uri);
        return vscode.window.showTextDocument(document, { preserveFocus: false, preview: false });
    }

    private static parseDocument(document: vscode.TextDocument): ts.SourceFile {
        return ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true,
            this.getScriptKind(document.languageId)
        );
    }

    private static getScriptKind(languageId: string): ts.ScriptKind {
        switch (languageId) {
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

    private static isMachineConfigObject(node: ts.ObjectLiteralExpression): boolean {
        const parent = node.parent;
        if (!ts.isCallExpression(parent)) {
            return false;
        }
        if (parent.arguments[0] !== node) {
            return false;
        }
        if (ts.isIdentifier(parent.expression)) {
            return ['createMachine', 'Machine', 'createStateConfig', 'stateConfig'].includes(parent.expression.text);
        }
        if (ts.isPropertyAccessExpression(parent.expression)) {
            return ['createMachine', 'Machine', 'createStateConfig', 'stateConfig'].includes(parent.expression.name.text);
        }
        return false;
    }

    private static isSetupConfigObject(node: ts.ObjectLiteralExpression): boolean {
        const parent = node.parent;
        return ts.isCallExpression(parent) && parent.arguments[0] === node && this.isSetupCallExpression(parent);
    }

    private static isSetupCallExpression(node: ts.CallExpression): boolean {
        return ts.isIdentifier(node.expression) && node.expression.text === 'setup';
    }

    private static findProperty(node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
        return node.properties.find((property): property is ts.PropertyAssignment => (
            ts.isPropertyAssignment(property) && this.getPropertyName(property.name) === name
        ));
    }

    private static getPropertyName(name: ts.PropertyName): string | undefined {
        if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
            return name.text;
        }
        return undefined;
    }

    private static findAncestor<T extends ts.Node>(node: ts.Node | undefined, predicate: (candidate: ts.Node) => candidate is T): T | undefined {
        let current = node;
        while (current) {
            if (predicate(current)) {
                return current;
            }
            current = current.parent;
        }
        return undefined;
    }

    private static toOffsets(document: vscode.TextDocument, range: vscode.Range): { start: number; end: number } {
        return {
            start: document.offsetAt(range.start),
            end: document.offsetAt(range.end),
        };
    }

    private static nodeRange(document: vscode.TextDocument, node: ts.Node): vscode.Range {
        return new vscode.Range(document.positionAt(node.getStart()), document.positionAt(node.getEnd()));
    }

    private static async applyRangeEdit(document: vscode.TextDocument, range: vscode.Range, replacement: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, replacement);
        await vscode.workspace.applyEdit(edit);
    }

    private static async insertProperty(document: vscode.TextDocument, objectLiteral: ts.ObjectLiteralExpression, propertyText: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const insertion = this.objectPropertyInsertion(document, objectLiteral, propertyText);
        edit.insert(document.uri, insertion.position, insertion.text);
        await vscode.workspace.applyEdit(edit);
    }

    private static async insertArrayElement(document: vscode.TextDocument, arrayLiteral: ts.ArrayLiteralExpression, elementText: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const insertion = this.arrayElementInsertion(document, arrayLiteral, elementText);
        edit.insert(document.uri, insertion.position, insertion.text);
        await vscode.workspace.applyEdit(edit);
    }

    private static objectPropertyInsertion(
        document: vscode.TextDocument,
        objectLiteral: ts.ObjectLiteralExpression,
        propertyText: string
    ): { position: vscode.Position; text: string } {
        const baseIndent = this.baseIndent(document, objectLiteral);
        const childIndent = this.childIndent(document, objectLiteral);
        if (objectLiteral.properties.length === 0) {
            const insertOffset = objectLiteral.getStart() + 1;
            return {
                position: document.positionAt(insertOffset),
                text: `\n${childIndent}${propertyText}\n${baseIndent}`
            };
        }

        const lastProperty = objectLiteral.properties[objectLiteral.properties.length - 1];
        return {
            position: document.positionAt(lastProperty.getEnd()),
            text: `,\n${childIndent}${propertyText}`
        };
    }

    private static arrayElementInsertion(
        document: vscode.TextDocument,
        arrayLiteral: ts.ArrayLiteralExpression,
        elementText: string
    ): { position: vscode.Position; text: string } {
        const baseIndent = this.baseIndent(document, arrayLiteral);
        const childIndent = this.childIndent(document, arrayLiteral);
        if (arrayLiteral.elements.length === 0) {
            return {
                position: document.positionAt(arrayLiteral.getStart() + 1),
                text: `\n${childIndent}${elementText}\n${baseIndent}`
            };
        }
        const lastElement = arrayLiteral.elements[arrayLiteral.elements.length - 1];
        return {
            position: document.positionAt(lastElement.getEnd()),
            text: `,\n${childIndent}${elementText}`
        };
    }

    private static deletionRange(document: vscode.TextDocument, node: ts.Node): vscode.Range {
        const text = document.getText();
        let start = node.getStart();
        let end = node.getEnd();

        let cursor = end;
        while (cursor < text.length && /[ \t]/.test(text[cursor])) {
            cursor++;
        }
        if (text[cursor] === ',') {
            end = cursor + 1;
            return new vscode.Range(document.positionAt(start), document.positionAt(end));
        }

        cursor = start - 1;
        while (cursor >= 0 && /[ \t]/.test(text[cursor])) {
            cursor--;
        }
        if (cursor >= 0 && text[cursor] === ',') {
            start = cursor;
        }

        return new vscode.Range(document.positionAt(start), document.positionAt(end));
    }

    private static baseIndent(document: vscode.TextDocument, node: ts.Node): string {
        const line = document.lineAt(document.positionAt(node.getStart()).line).text;
        return line.match(/^\s*/)?.[0] ?? '';
    }

    private static childIndent(document: vscode.TextDocument, node: ts.Node): string {
        return `${this.baseIndent(document, node)}  `;
    }

    private static quote(value: string): string {
        return `'${value.replace(/'/g, "\\'")}'`;
    }

    private static stringifyValueLike(node: ts.Node, value: string): string {
        if (ts.isIdentifier(node) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
            return value;
        }
        return this.quote(value);
    }

    private static validateIdentifier(value: string): string | undefined {
        if (!value.trim()) {
            return 'Value is required.';
        }
        if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(value.trim())) {
            return 'Use a valid identifier-like name.';
        }
        return undefined;
    }
}
