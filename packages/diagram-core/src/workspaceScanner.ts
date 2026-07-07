import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from './parser';

// Directories that hold generated/compiled copies of source — scanning them
// surfaces the same machine several times (e.g. an `auth` machine shows up once
// from `app/` and again from each `build/` bundle). Exclude them everywhere we
// scan or watch.
const IGNORED_DIRS = ['node_modules', 'build', 'dist', 'out', '.next', '.nuxt', '.svelte-kit', '.vite', '.turbo', '.cache', 'coverage'];
export const SCAN_EXCLUDE_GLOB = `**/{${IGNORED_DIRS.join(',')}}/**`;

/** True if a file sits inside a generated/ignored directory. */
export function isIgnoredPath(uri: vscode.Uri): boolean {
    const segments = uri.path.split('/');
    return segments.some((seg) => IGNORED_DIRS.includes(seg));
}

export interface FileMachines {
    uri: vscode.Uri;
    relativePath: string;
    machines: MachineNode[];
}

/** A single-file cache mutation; `undefined` from the event means a bulk change. */
export interface WorkspaceChange {
    uri: vscode.Uri;
    kind: 'update' | 'remove';
}

export class WorkspaceScanner {
    private cache: Map<string, FileMachines> = new Map();
    private scanning: boolean = false;
    private fileWatcher?: vscode.FileSystemWatcher;

    /** Fires on cache mutations: a per-file change, or `undefined` for bulk
     *  changes (full scan completed / cleared). Lets consumers update incrementally. */
    private readonly _onDidChange = new vscode.EventEmitter<WorkspaceChange | undefined>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private outputChannel?: vscode.OutputChannel) {}

    /**
     * Scan the entire workspace for XState machines
     */
    async scanWorkspace(): Promise<FileMachines[]> {
        if (this.scanning) {
            return Array.from(this.cache.values());
        }

        this.scanning = true;
        this.cache.clear();

        try {
            // Find all JS/TS files in workspace
            const files = await vscode.workspace.findFiles(
                '**/*.{ts,tsx,js,jsx}',
                SCAN_EXCLUDE_GLOB
            );

            this.log(`Found ${files.length} JS/TS files to scan`);

            // Parse each file
            let processedCount = 0;
            for (const uri of files) {
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    const machines = XStateMachineParser.parseMachines(document);
                    
                    if (machines.length > 0) {
                        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                        const relativePath = workspaceFolder 
                            ? vscode.workspace.asRelativePath(uri, false)
                            : uri.fsPath;

                        this.cache.set(uri.toString(), {
                            uri,
                            relativePath,
                            machines
                        });

                        this.log(`  ✓ ${relativePath}: ${machines.length} machine(s)`);
                    }

                    processedCount++;
                    if (processedCount % 10 === 0) {
                        this.log(`  Progress: ${processedCount}/${files.length} files`);
                    }
                } catch (error) {
                    // Skip files that can't be parsed
                    this.log(`  ✗ ${uri.fsPath}: ${error}`);
                }
            }

            this.log(`Scan complete: ${this.cache.size} files with XState machines`);
        } finally {
            this.scanning = false;
        }

        this._onDidChange.fire(undefined);
        return Array.from(this.cache.values());
    }

    /**
     * Get cached results (fast)
     */
    getCached(): FileMachines[] {
        return Array.from(this.cache.values());
    }

    /**
     * Get machines from a specific file
     */
    getFile(uri: vscode.Uri): FileMachines | undefined {
        return this.cache.get(uri.toString());
    }

    /**
     * Update a single file in the cache
     */
    async updateFile(uri: vscode.Uri): Promise<void> {
        if (isIgnoredPath(uri)) { return; }
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            this.updateDocument(document);
        } catch (error) {
            // If file can't be parsed, remove from cache
            if (this.cache.delete(uri.toString())) {
                this._onDidChange.fire({ uri, kind: 'remove' });
            }
        }
    }

    /**
     * Update a single open document in the cache using its in-memory contents.
     * This is used for unsaved edits so the tree can reflect changes immediately.
     */
    updateDocument(document: vscode.TextDocument): void {
        const uri = document.uri;
        const machines = XStateMachineParser.parseMachines(document);

        if (machines.length > 0) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            const relativePath = workspaceFolder
                ? vscode.workspace.asRelativePath(uri, false)
                : uri.fsPath;

            this.cache.set(uri.toString(), {
                uri,
                relativePath,
                machines
            });
            this._onDidChange.fire({ uri, kind: 'update' });
        } else if (this.cache.delete(uri.toString())) {
            // No machines found, remove from cache
            this._onDidChange.fire({ uri, kind: 'remove' });
        }
    }

    /**
     * Remove a file from the cache
     */
    removeFile(uri: vscode.Uri): void {
        if (this.cache.delete(uri.toString())) {
            this._onDidChange.fire({ uri, kind: 'remove' });
        }
    }

    /**
     * Start watching workspace files for changes
     */
    startWatching(onUpdate: () => void): void {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{ts,tsx,js,jsx}'
        );

        // File changed
        this.fileWatcher.onDidChange(async (uri) => {
            await this.updateFile(uri);
            onUpdate();
        });

        // File created
        this.fileWatcher.onDidCreate(async (uri) => {
            await this.updateFile(uri);
            onUpdate();
        });

        // File deleted
        this.fileWatcher.onDidDelete((uri) => {
            this.removeFile(uri);
            onUpdate();
        });
    }

    /**
     * Stop watching files
     */
    stopWatching(): void {
        this.fileWatcher?.dispose();
        this.fileWatcher = undefined;
    }

    /**
     * Clear the cache
     */
    clear(): void {
        this.cache.clear();
        this._onDidChange.fire(undefined);
    }

    /**
     * Get statistics
     */
    getStats(): { totalFiles: number; totalMachines: number } {
        const totalFiles = this.cache.size;
        const totalMachines = Array.from(this.cache.values())
            .reduce((sum, file) => sum + file.machines.length, 0);
        
        return { totalFiles, totalMachines };
    }

    private log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    dispose(): void {
        this.stopWatching();
        this.cache.clear();
        this._onDidChange.dispose();
    }
}
