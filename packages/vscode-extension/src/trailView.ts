import * as vscode from 'vscode';

/** One state on the navigation trail. */
export interface TrailEntry {
    label: string;
    uri: vscode.Uri;
    range: vscode.Range;
    machineKey: string;
    via?: string;       // the transition event used to arrive here (undefined for a seed origin)
    direction?: 'forward' | 'backward';   // → followed a target, ← followed an incoming source
}

const CAP = 50;

const sameState = (a: TrailEntry, b: TrailEntry) =>
    a.label === b.label && a.uri.toString() === b.uri.toString() && a.range.start.line === b.range.start.line;

/**
 * The trail is a *walk* through one machine, built dynamically as the user
 * follows targets (forward → append) and incoming sources (backward → prepend).
 * `current` marks where the user is; clicking an entry moves it without mutating
 * the list. A jump into a different machine resets the trail.
 */
export class TrailService {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private entries: TrailEntry[] = [];
    private current = -1;
    private machineKey = '';

    getEntries(): TrailEntry[] { return this.entries; }
    getCurrent(): number { return this.current; }

    /** Follow a target from `from` to `to` — append at the tail. */
    recordForward(from: TrailEntry | undefined, to: TrailEntry): void {
        if (this.reseedIfNeeded(from, to)) { return; }
        if (this.current >= 0 && sameState(this.entries[this.current], to)) { return; }  // no-op self/re-entry
        // Diverging from mid-trail truncates the stale forward path (browser-style).
        this.entries.splice(this.current + 1);
        this.entries.push(to);
        this.current = this.entries.length - 1;
        this.trimTail();
        this._onDidChange.fire();
    }

    /** Follow an incoming source `to` that leads into `from` — prepend at the head. */
    recordBackward(from: TrailEntry, to: TrailEntry): void {
        if (this.reseedIfNeeded(from, to)) { return; }
        if (this.current >= 0 && sameState(this.entries[this.current], to)) { return; }
        this.entries.splice(0, this.current);   // truncate the stale path before current
        this.entries.unshift(to);
        this.current = 0;
        this.trimHead();
        this._onDidChange.fire();
    }

    /** Move the current pointer (e.g. clicking a trail entry) without mutating the list. */
    goTo(index: number): void {
        if (index < 0 || index >= this.entries.length) { return; }
        this.current = index;
        this._onDidChange.fire();
    }

    /** If a plain selection lands on a state already in the trail, follow it. */
    markCurrentIfPresent(label: string, uri: vscode.Uri): void {
        const i = this.entries.findIndex(e => e.label === label && e.uri.toString() === uri.toString());
        if (i >= 0 && i !== this.current) { this.current = i; this._onDidChange.fire(); }
    }

    clear(): void {
        this.entries = [];
        this.current = -1;
        this.machineKey = '';
        this._onDidChange.fire();
    }

    // Seed (or reset on a new machine). Returns true if it handled the record.
    private reseedIfNeeded(from: TrailEntry | undefined, to: TrailEntry): boolean {
        if (this.entries.length > 0 && to.machineKey === this.machineKey) { return false; }
        this.machineKey = to.machineKey;
        this.entries = from && from.machineKey === to.machineKey ? [from, to] : [to];
        this.current = this.entries.length - 1;
        this._onDidChange.fire();
        return true;
    }

    private trimTail(): void {
        while (this.entries.length > CAP) { this.entries.shift(); this.current--; }
    }
    private trimHead(): void {
        while (this.entries.length > CAP) { this.entries.pop(); }
    }
}
