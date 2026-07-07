import * as vscode from 'vscode';
import * as ts from 'typescript';
import type { MachineNode } from './parser';

type SetupSection = 'actions' | 'guards' | 'actors' | 'delays';

// A copied/cut outline node, captured as the verbatim source of its defining
// construct so paste can splice it elsewhere. `text` is also mirrored to the
// system clipboard so the snippet can be pasted into code directly.
interface OutlineClipboard {
    nodeType: string;                       // MachineNode.type of the source node
    label: string;                          // its key/name, for collision handling
    form: 'property' | 'arrayElement';      // how it lives in source
    text: string;                           // construct.getText()
    baseIndent: string;                     // indent of the construct's first line
}

/** Replace the leading `oldKey:` of a captured property with `newName:`,
 *  quoting the key if it isn't a bare identifier. */
export function renamePropertyKey(text: string, newName: string): string {
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName) ? newName : `'${newName.replace(/'/g, "\\'")}'`;
    return text.replace(/^(['"]?)[A-Za-z0-9_$-]+\1\s*:/, `${key}:`);
}

/** Shift the continuation lines of a multi-line snippet from its original base
 *  indent to the destination's, preserving relative nesting. */
export function reindentSnippet(text: string, fromBase: string, toBase: string): string {
    if (fromBase === toBase || !text.includes('\n')) { return text; }
    return text
        .split('\n')
        .map((line, i) => {
            if (i === 0) { return line; }
            const stripped = line.startsWith(fromBase) ? line.slice(fromBase.length) : line.replace(/^[ \t]*/, '');
            return toBase + stripped;
        })
        .join('\n');
}

export class XStateTreeEditor {
    private static clipboard: OutlineClipboard | undefined;

    static async editNode(node: MachineNode): Promise<void> {
        switch (node.type) {
            case 'state':
            case 'transition':
            case 'contextProperty':
            case 'invalid':
                await this.renameNode(node);
                return;
            case 'target':
            case 'action':
            case 'guard':
            case 'invoke':
                await this.changeValue(node);
                return;
            case 'actor':
            case 'delay':
                await this.renameNode(node);
                return;
            default:
                vscode.window.showInformationMessage(`Editing is not supported for ${node.type} nodes yet.`);
        }
    }

    static async renameNode(node: MachineNode): Promise<void> {
        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const rangeOffsets = this.toOffsets(document, node.range!);

        switch (node.type) {
            case 'state': {
                const stateProperty = this.findStateProperty(parsed, rangeOffsets.start, rangeOffsets.end, node.label);
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
                const transitionProperty = this.findTransitionProperty(parsed, rangeOffsets.start, rangeOffsets.end, node.label);
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
                    vscode.window.showInformationMessage(`Renaming ${node.type} references is handled via “Change value”.`);
                    return;
                }
                const currentName = this.getPropertyName(setupProperty.name);
                if (!currentName) { return; }
                const nextName = await vscode.window.showInputBox({
                    prompt: `Rename setup ${node.type}`,
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
                vscode.window.showInformationMessage(`Renaming is not supported for ${node.type} nodes.`);
        }
    }

    static async changeValue(node: MachineNode): Promise<void> {
        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, node.range!);

        if (node.type === 'target') {
            const literal = this.findStringLikeNode(parsed, offsets.start, offsets.end);
            if (!literal) {
                vscode.window.showInformationMessage('Could not resolve the selected target in source.');
                return;
            }

            const machineConfig = this.findContainingMachineConfig(literal);
            const validTargets = machineConfig ? this.collectStateTargets(machineConfig) : [];
            const next = await this.pickOrInput('Select target state', validTargets, node.label);
            if (!next || next === node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, literal), this.quote(next));
            return;
        }

        if (node.type === 'action') {
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
            const next = await this.pickOrInput('Select action', this.collectSetupKeys(parsed, 'actions'), node.label);
            if (!next || next === node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, valueNode), this.stringifyValueLike(valueNode, next));
            return;
        }

        if (node.type === 'guard') {
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
            const next = await this.pickOrInput('Select guard', this.collectSetupKeys(parsed, 'guards'), node.label);
            if (!next || next === node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, valueNode), this.stringifyValueLike(valueNode, next));
            return;
        }

        if (node.type === 'invoke') {
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
            const next = await this.pickOrInput('Select actor source', this.collectSetupKeys(parsed, 'actors'), node.label);
            if (!next || next === node.label) { return; }
            await this.applyRangeEdit(document, this.nodeRange(document, srcProperty.initializer), this.stringifyValueLike(srcProperty.initializer, next));
            return;
        }

        if (node.type === 'contextProperty') {
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

        vscode.window.showInformationMessage(`Changing the value of ${node.type} nodes is not supported yet.`);
    }

    static async deleteNode(node: MachineNode): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            `Delete ${node.label}?`,
            { modal: true },
            'Delete'
        );
        if (confirmed !== 'Delete') { return; }

        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, node.range!);

        // findConstructForNode resolves state nodes (whose range is the `{...}`
        // initializer, not the `name: {...}` property) correctly, where the old
        // exact-range match silently failed.
        const found = this.findConstructForNode(parsed, offsets, node);
        if (found) {
            await this.applyRangeEdit(document, this.deletionRange(document, found.construct), '');
            return;
        }

        vscode.window.showInformationMessage(`Could not delete the selected ${node.type} node safely.`);
    }

    // ── Copy / Cut / Paste ──────────────────────────────────────────────────

    static async copyNode(node: MachineNode): Promise<void> {
        const r = await this.openParseResolve(node);
        if (!r) {
            vscode.window.showInformationMessage(`Could not resolve the selected ${node.type} node in source.`);
            return;
        }
        await this.store(node, r.document, r.construct, r.form);
    }

    static async cutNode(node: MachineNode): Promise<void> {
        const r = await this.openParseResolve(node);
        if (!r) {
            vscode.window.showInformationMessage(`Could not resolve the selected ${node.type} node in source.`);
            return;
        }
        await this.store(node, r.document, r.construct, r.form);
        await this.applyRangeEdit(r.document, this.deletionRange(r.document, r.construct), '');
    }

    static async pasteNode(target: MachineNode): Promise<void> {
        const clip = this.clipboard;
        if (!clip) {
            vscode.window.showInformationMessage('Clipboard is empty — copy a node first.');
            return;
        }
        const editor = await this.openEditor(target);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, target.range!);

        // Setup implementations (action/guard/actor/delay/invoke) live in the
        // machine's setup({}) block, not its config object.
        if (['action', 'guard', 'actor', 'delay', 'invoke'].includes(clip.nodeType)) {
            const section = this.inferSetupSection(clip.nodeType);
            if (target.type !== 'machine' || !section || clip.form !== 'property') {
                this.pasteUnsupported(clip.nodeType, target.type);
                return;
            }
            const setupConfig = this.findAnySetupConfig(parsed);
            if (!setupConfig) {
                vscode.window.showInformationMessage('No setup({}) block found to paste this into.');
                return;
            }
            await this.pasteProperty(document, setupConfig, section, clip);
            return;
        }

        // States / transitions / context attach to the target's config object.
        const targetObj = target.type === 'machine'
            ? this.findMachineConfigByRange(parsed, offsets.start, offsets.end)
            : target.type === 'state'
                ? this.findStateProperty(parsed, offsets.start, offsets.end, target.label)?.initializer
                : undefined;
        if (!targetObj || !ts.isObjectLiteralExpression(targetObj)) {
            vscode.window.showInformationMessage('Could not resolve the paste target in source.');
            return;
        }

        switch (clip.nodeType) {
            case 'state':
                if (target.type !== 'machine' && target.type !== 'state') { this.pasteUnsupported(clip.nodeType, target.type); return; }
                await this.pasteProperty(document, targetObj, 'states', clip);
                return;
            case 'transition':
                if (target.type !== 'state') { this.pasteUnsupported(clip.nodeType, target.type); return; }
                await this.pasteProperty(document, targetObj, 'on', clip);
                return;
            case 'contextProperty':
                if (target.type !== 'machine' && target.type !== 'state') { this.pasteUnsupported(clip.nodeType, target.type); return; }
                await this.pasteProperty(document, targetObj, 'context', clip);
                return;
            default:
                this.pasteUnsupported(clip.nodeType, target.type);
        }
    }

    private static async openParseResolve(
        node: MachineNode
    ): Promise<{ document: vscode.TextDocument; construct: ts.PropertyAssignment | ts.Expression; form: 'property' | 'arrayElement' } | undefined> {
        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, node.range!);
        const found = this.findConstructForNode(parsed, offsets, node);
        return found ? { document, construct: found.construct, form: found.form } : undefined;
    }

    private static async store(
        node: MachineNode,
        document: vscode.TextDocument,
        construct: ts.PropertyAssignment | ts.Expression,
        form: 'property' | 'arrayElement'
    ): Promise<void> {
        const text = construct.getText();
        this.clipboard = { nodeType: node.type, label: node.label, form, text, baseIndent: this.baseIndent(document, construct) };
        await vscode.env.clipboard.writeText(text);
        await vscode.commands.executeCommand('setContext', 'xstateOutline.hasClipboard', true);
    }

    /** Resolve the source construct (a property or array element) backing any
     *  editable node. States resolve via findStateProperty (their range is the
     *  `{...}` initializer); everything else mirrors the delete chain. */
    private static findConstructForNode(
        parsed: ts.SourceFile,
        offsets: { start: number; end: number },
        node: MachineNode
    ): { construct: ts.PropertyAssignment | ts.Expression; form: 'property' | 'arrayElement' } | undefined {
        if (node.type === 'state') {
            const p = this.findStateProperty(parsed, offsets.start, offsets.end, node.label);
            return p ? { construct: p, form: 'property' } : undefined;
        }
        const prop = this.findDeletableProperty(parsed, offsets.start, offsets.end, node.type);
        if (prop) { return { construct: prop, form: 'property' }; }
        const el = this.findArrayElement(parsed, offsets.start, offsets.end);
        if (el) { return { construct: el, form: 'arrayElement' }; }
        return undefined;
    }

    /** Splice a copied property into `destConfig`'s `containerProp` object (e.g.
     *  states/on/context/actions), creating that object if absent, renaming on a
     *  key collision and re-indenting to the destination depth. */
    private static async pasteProperty(
        document: vscode.TextDocument,
        destConfig: ts.ObjectLiteralExpression,
        containerProp: string,
        clip: OutlineClipboard
    ): Promise<void> {
        if (clip.form !== 'property') {
            this.pasteUnsupported(clip.nodeType, containerProp);
            return;
        }
        const container = this.findProperty(destConfig, containerProp);
        if (container && ts.isObjectLiteralExpression(container.initializer)) {
            await this.insertCapturedProperty(document, container.initializer, clip);
            return;
        }
        // No container yet — create `containerProp: { <prop> }`.
        const childIndent = this.childIndent(document, destConfig);
        const innerIndent = `${childIndent}  `;
        const reindented = reindentSnippet(clip.text, clip.baseIndent, innerIndent);
        const body = `{\n${innerIndent}${reindented}\n${childIndent}}`;
        await this.insertProperty(document, destConfig, `${containerProp}: ${body}`);
    }

    /** Insert a captured `name: …` property into an existing object literal,
     *  prompting for a new name if the key already exists. Returns false if the
     *  user cancelled the rename. */
    private static async insertCapturedProperty(
        document: vscode.TextDocument,
        destObject: ts.ObjectLiteralExpression,
        clip: OutlineClipboard
    ): Promise<boolean> {
        const existing = new Set(
            destObject.properties
                .map((p) => (ts.isPropertyAssignment(p) ? this.getPropertyName(p.name) : undefined))
                .filter((n): n is string => !!n)
        );
        let name = clip.label;
        let text = clip.text;
        if (existing.has(name)) {
            const chosen = await vscode.window.showInputBox({
                prompt: `"${name}" already exists here — enter a new name`,
                value: this.uniqueName(name, existing),
                validateInput: (value) => this.validateIdentifier(value),
            });
            if (!chosen) { return false; }
            name = chosen;
            text = renamePropertyKey(clip.text, name);
        }
        const reindented = reindentSnippet(text, clip.baseIndent, this.childIndent(document, destObject));
        await this.insertProperty(document, destObject, reindented);
        return true;
    }

    private static pasteUnsupported(clipType: string, targetType: string): void {
        vscode.window.showInformationMessage(
            `Can't paste a ${clipType} onto a ${targetType}. The snippet is on your clipboard to paste into code.`
        );
    }

    private static findAnySetupConfig(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
        let found: ts.ObjectLiteralExpression | undefined;
        const visit = (node: ts.Node): void => {
            if (found) { return; }
            if (ts.isObjectLiteralExpression(node) && this.isSetupConfigObject(node)) { found = node; return; }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return found;
    }

    /** A name not already in `existing` — the base, else base2, base3, … */
    private static uniqueName(base: string, existing: Set<string>): string {
        if (!existing.has(base)) { return base; }
        let i = 2;
        while (existing.has(`${base}${i}`)) { i++; }
        return `${base}${i}`;
    }


    static async addChildState(node: MachineNode): Promise<void> {
        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);

        const stateName = await vscode.window.showInputBox({
            prompt: node.type === 'machine' ? 'New top-level state name' : 'New child state name',
            validateInput: (value) => this.validateIdentifier(value)
        });
        if (!stateName) { return; }

        if (node.type === 'machine') {
            const offsets = this.toOffsets(document, node.range!);
            const machineConfig = this.findMachineConfigByRange(parsed, offsets.start, offsets.end);
            if (!machineConfig) {
                vscode.window.showInformationMessage('Could not resolve the selected machine in source.');
                return;
            }
            await this.insertStateIntoConfig(document, machineConfig, stateName);
            return;
        }

        if (node.type === 'state') {
            const offsets = this.toOffsets(document, node.range!);
            const stateProperty = this.findStateProperty(parsed, offsets.start, offsets.end, node.label);
            if (!stateProperty || !ts.isObjectLiteralExpression(stateProperty.initializer)) {
                vscode.window.showInformationMessage('Could not resolve the selected state in source.');
                return;
            }
            await this.insertStateIntoConfig(document, stateProperty.initializer, stateName);
            return;
        }

        vscode.window.showInformationMessage('Add child state is only supported for machine and state nodes.');
    }

    static async addTransition(node: MachineNode): Promise<void> {
        if (node.type !== 'state') {
            vscode.window.showInformationMessage('Add transition is only supported on state nodes.');
            return;
        }

        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, node.range!);
        const stateProperty = this.findStateProperty(parsed, offsets.start, offsets.end, node.label);
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

    static async addReference(node: MachineNode): Promise<void> {
        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, node.range!);

        if (node.type === 'state' || node.type === 'machine') {
            const kind = await vscode.window.showQuickPick(['Entry action', 'Exit action', 'Invoke'], {
                placeHolder: 'Select what to add'
            });
            if (!kind) { return; }

            const configObject = node.type === 'machine'
                ? this.findMachineConfigByRange(parsed, offsets.start, offsets.end)
                : this.findStateProperty(parsed, offsets.start, offsets.end, node.label)?.initializer;
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

        if (node.type === 'transition') {
            const transitionNode = this.findTransitionObject(parsed, offsets.start, offsets.end);
            if (!transitionNode) {
                vscode.window.showInformationMessage('Add action/guard is only supported on named transition handlers.');
                return;
            }

            const kind = await vscode.window.showQuickPick(['Action', 'Guard'] as const, {
                placeHolder: 'Select what to add'
            });
            if (!kind) { return; }

            const chosen = kind === 'Action'
                ? await this.pickOrInput('Select action', this.collectSetupKeys(parsed, 'actions'))
                : await this.pickOrInput('Select guard', this.collectSetupKeys(parsed, 'guards'));
            if (!chosen) { return; }

            await this.addTransitionReference(document, transitionNode, kind as 'Action' | 'Guard', chosen);
            return;
        }

        if (node.type === 'setup' || ['action', 'guard', 'actor', 'delay'].includes(node.type)) {
            const setupConfig = node.type === 'setup'
                ? this.findSetupConfigByRange(parsed, offsets.start, offsets.end)
                : this.findContainingSetupConfig(parsed, offsets.start, offsets.end);
            if (!setupConfig) {
                vscode.window.showInformationMessage('Could not resolve the selected setup block in source.');
                return;
            }

            const initialSection = this.inferSetupSection(node.type);
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

    static async setDescription(node: MachineNode): Promise<void> {
        if (node.type !== 'machine' && node.type !== 'state') {
            vscode.window.showInformationMessage('Descriptions can only be set on machine and state nodes.');
            return;
        }

        const editor = await this.openEditor(node);
        const document = editor.document;
        const parsed = this.parseDocument(document);
        const offsets = this.toOffsets(document, node.range!);

        const configObject = node.type === 'machine'
            ? this.findMachineConfigByRange(parsed, offsets.start, offsets.end)
            : this.findStateProperty(parsed, offsets.start, offsets.end, node.label)?.initializer;
        if (!configObject || !ts.isObjectLiteralExpression(configObject)) {
            vscode.window.showInformationMessage('Could not resolve the selected node in source.');
            return;
        }

        const existing = this.findProperty(configObject, 'description');
        const current = existing && ts.isStringLiteralLike(existing.initializer)
            ? existing.initializer.text
            : node.description ?? '';

        const next = await vscode.window.showInputBox({
            prompt: 'Description (leave empty to remove)',
            value: current
        });
        if (next === undefined || next === current) { return; }

        if (next.trim() === '') {
            if (existing) {
                await this.applyRangeEdit(document, this.deletionRange(document, existing), '');
            }
            return;
        }

        if (existing) {
            await this.applyRangeEdit(document, this.nodeRange(document, existing.initializer), this.quote(next));
            return;
        }
        await this.insertProperty(document, configObject, `description: ${this.quote(next)}`);
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
        transitionNode: ts.PropertyAssignment | ts.ObjectLiteralExpression,
        kind: 'Action' | 'Guard',
        value: string
    ): Promise<void> {
        const initializer = ts.isPropertyAssignment(transitionNode) ? transitionNode.initializer : transitionNode;

        if (ts.isStringLiteralLike(initializer)) {
            const rewritten = kind === 'Action'
                ? `{ target: ${initializer.getText()}, actions: ${this.quote(value)} }`
                : `{ target: ${initializer.getText()}, guard: ${this.quote(value)} }`;
            await this.applyRangeEdit(document, this.nodeRange(document, initializer), rewritten);
            return;
        }

        if (ts.isArrayLiteralExpression(initializer)) {
            vscode.window.showInformationMessage('Adding references directly to an array of conditional transitions is not supported. Please edit the specific branch object.');
            return;
        }

        if (!ts.isObjectLiteralExpression(initializer)) {
            vscode.window.showInformationMessage('Cannot edit this type of transition.');
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

    private static findTransitionObject(sourceFile: ts.SourceFile, start: number, end: number): ts.ObjectLiteralExpression | ts.PropertyAssignment | undefined {
        let found: ts.ObjectLiteralExpression | ts.PropertyAssignment | undefined;
        const visit = (node: ts.Node): void => {
            if (found) return;

            // Could be the whole property assignment (e.g., `EVENT: { ... }`)
            if (ts.isPropertyAssignment(node)) {
                if ((node.getStart() === start && node.getEnd() === end) || (node.initializer.getStart() === start && node.initializer.getEnd() === end)) {
                    found = node;
                    return;
                }
            }
            
            // Could be an object inside an array (e.g., `EVENT: [ { ... }, { ... } ]`)
            if (ts.isObjectLiteralExpression(node)) {
                if (node.getStart() === start && node.getEnd() === end) {
                    // Make sure it's inside a transition
                    const parentArray = this.findAncestor(node, ts.isArrayLiteralExpression);
                    if (parentArray) {
                        const parentProp = this.findAncestor(parentArray, ts.isPropertyAssignment);
                        if (parentProp) {
                            found = node;
                            return;
                        }
                    }
                }
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

    private static async openEditor(node: MachineNode): Promise<vscode.TextEditor> {
        if (!node.uri) {
            throw new Error('Tree item has no URI.');
        }
        const document = await vscode.workspace.openTextDocument(node.uri);
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
