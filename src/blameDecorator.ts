/**
 * Vibe Code Guardian — Git Blame Decorator
 * Renders inline blame annotations on the current cursor line (GitLens style).
 * Shows: "<author>, <relative-time> · <commit-summary>"
 */

import * as vscode from 'vscode';
import { GitManager, BlameInfo } from './gitManager';

/** Relative time formatter (e.g. "3 days ago", "just now") */
function relativeTime(isoDate: string): string {
    const ms = Date.now() - new Date(isoDate).getTime();
    if (ms < 0) { return 'just now'; }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) { return 'just now'; }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) { return `${minutes} min ago`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `${hours}h ago`; }
    const days = Math.floor(hours / 24);
    if (days < 30) { return `${days}d ago`; }
    const months = Math.floor(days / 30);
    if (months < 12) { return `${months}mo ago`; }
    return `${Math.floor(months / 12)}y ago`;
}

export class BlameDecorator implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    /** Cache: filePath → blame lines */
    private blameCache = new Map<string, BlameInfo[]>();

    /** Decoration type for the current-line blame annotation */
    private readonly decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 2em',
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
        },
        isWholeLine: true,
    });

    /** Decoration type for the hover-enabled range (covers the whole line) */
    private readonly hoverDecorationType = vscode.window.createTextEditorDecorationType({
        // Transparent — only needed to register hover provider target
    });

    private enabled = true;

    constructor(private readonly gitManager: GitManager) {
        this.disposables.push(
            // Update annotation when cursor moves
            vscode.window.onDidChangeTextEditorSelection(event => {
                this.update(event.textEditor).catch(() => undefined);
            }),
            // Invalidate cache when file is saved
            vscode.workspace.onDidSaveTextDocument(doc => {
                this.blameCache.delete(doc.uri.fsPath);
                const editor = vscode.window.activeTextEditor;
                if (editor?.document === doc) {
                    this.update(editor).catch(() => undefined);
                }
            }),
            // Invalidate cache when file changes on disk
            vscode.workspace.onDidChangeTextDocument(event => {
                this.blameCache.delete(event.document.uri.fsPath);
            }),
            // Re-render when switching editors
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.update(editor).catch(() => undefined);
                }
            }),
            // Hover provider shows full commit detail
            vscode.languages.registerHoverProvider({ scheme: 'file' }, {
                provideHover: (doc, position) => this.provideHover(doc, position)
            }),
            this.decorationType,
            this.hoverDecorationType,
        );

        // Initial render
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.update(activeEditor).catch(() => undefined);
        }
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            vscode.window.visibleTextEditors.forEach(editor => {
                editor.setDecorations(this.decorationType, []);
                editor.setDecorations(this.hoverDecorationType, []);
            });
        } else {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                this.update(activeEditor).catch(() => undefined);
            }
        }
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    /** Invalidate all cached blame data (call after git commits) */
    public invalidateCache(): void {
        this.blameCache.clear();
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.update(activeEditor).catch(() => undefined);
        }
    }

    private async update(editor: vscode.TextEditor): Promise<void> {
        if (!this.enabled) { return; }

        const doc = editor.document;
        if (doc.uri.scheme !== 'file' || doc.isUntitled) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        // Only show annotation for the primary cursor
        const cursorLine = editor.selection.active.line;
        const filePath = doc.uri.fsPath;

        const blame = await this.getBlame(filePath);
        if (blame.length === 0) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const lineBlame = blame.find(b => b.lineNumber === cursorLine + 1); // blame is 1-indexed
        if (!lineBlame || lineBlame.isUncommitted) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const text = this.formatAnnotation(lineBlame);
        const range = new vscode.Range(cursorLine, 0, cursorLine, 0);

        editor.setDecorations(this.decorationType, [{
            range,
            renderOptions: {
                after: {
                    contentText: text,
                    color: new vscode.ThemeColor('editorCodeLens.foreground'),
                    fontStyle: 'italic',
                    margin: '0 0 0 2em',
                }
            }
        }]);
    }

    private formatAnnotation(b: BlameInfo): string {
        const time = b.date ? relativeTime(b.date) : '';
        const summary = b.summary.length > 60
            ? b.summary.substring(0, 57) + '...'
            : b.summary;
        return `${b.authorName}, ${time} · ${summary}`;
    }

    private async provideHover(
        doc: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        if (!this.enabled || doc.uri.scheme !== 'file') { return; }

        const blame = await this.getBlame(doc.uri.fsPath);
        const lineBlame = blame.find(b => b.lineNumber === position.line + 1);
        if (!lineBlame || lineBlame.isUncommitted) { return; }

        const md = this.buildHoverMarkdown(lineBlame);
        return new vscode.Hover(md);
    }

    private buildHoverMarkdown(b: BlameInfo): vscode.MarkdownString {
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportHtml = true;

        const dateStr = b.date
            ? new Date(b.date).toLocaleString()
            : '';
        const time = b.date ? relativeTime(b.date) : '';

        // Header row: icon + commit hash + date
        md.appendMarkdown(`**$(git-commit) \`${b.shortHash}\`** &nbsp;·&nbsp; ${time} &nbsp;*(${dateStr})*\n\n`);

        // Author
        md.appendMarkdown(`**$(person) Author:** ${escMd(b.authorName)} &lt;${escMd(b.authorEmail)}&gt;\n\n`);

        // Commit message
        if (b.summary) {
            md.appendMarkdown(`**$(comment) Message:** ${escMd(b.summary)}\n\n`);
        }

        // Action links
        const showInGraphCmd = encodeURIComponent(JSON.stringify({ commitHash: b.hash }));
        md.appendMarkdown(
            `[$(git-branch) Show in Graph](command:vibeCodeGuardian.gitGraphCommitDetail?${showInGraphCmd})`
        );

        return md;
    }

    private async getBlame(filePath: string): Promise<BlameInfo[]> {
        if (this.blameCache.has(filePath)) {
            return this.blameCache.get(filePath)!;
        }
        const blame = await this.gitManager.getBlame(filePath);
        this.blameCache.set(filePath, blame);
        return blame;
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

function escMd(s: string): string {
    return s.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}
