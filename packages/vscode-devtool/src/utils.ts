import * as vscode from 'vscode';
import { MachineNode } from './parser';

export function findNodeAtPosition(nodes: MachineNode[], position: vscode.Position): { node: MachineNode, parents: MachineNode[] } | undefined {
    for (const node of nodes) {
        if (node.range.contains(position)) {
            if (node.children) {
                const childMatch = findNodeAtPosition(node.children, position);
                if (childMatch) {
                    return { node: childMatch.node, parents: [node, ...childMatch.parents] };
                }
            }
            return { node, parents: [] };
        }
    }
    return undefined;
}

export function normalizeTargetName(raw: string): string {
    const segments = raw.replace(/^#/, '').split('.').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : '';
}

export function walkNodes(node: MachineNode, fn: (n: MachineNode) => void) {
    fn(node);
    if (node.children) {
        for (const child of node.children) {
            walkNodes(child, fn);
        }
    }
}
