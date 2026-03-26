/**
 * Vibe Code Guardian - Git Graph WebView Manager
 * Creates and manages an interactive SVG-based git graph visualization
 */

import * as vscode from 'vscode';
import { GitManager } from './gitManager';
import { GitGraphProvider } from './gitGraphProvider';
import { WebviewToExtensionMessage } from './types';

export class GitGraphWebviewManager {
    private panel: vscode.WebviewPanel | undefined;
    private gitGraphProvider: GitGraphProvider;
    private mode: 'guardian' | 'full' = 'full';
    private disposables: vscode.Disposable[] = [];
    private pendingTab: string | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private gitManager: GitManager
    ) {
        this.gitGraphProvider = new GitGraphProvider(gitManager);
    }

    public async show(focusCommitHash?: string, initialTab?: string): Promise<void> {
        if (initialTab) { this.pendingTab = initialTab; }
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            if (focusCommitHash) {
                this.panel.webview.postMessage({ type: 'focusCommit', hash: focusCommitHash });
            }
            if (initialTab) {
                this.panel.webview.postMessage({ type: 'switchTab', tab: initialTab });
                this.pendingTab = undefined;
            }
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'vibeGuardianGitGraph',
            'Git Graph - Vibe Guardian',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        const nonce = getNonce();
        this.panel.webview.html = this.getWebviewContent(nonce);

        this.panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => this.handleMessage(message, focusCommitHash),
            null,
            this.disposables
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
            this.disposables.forEach(d => d.dispose());
            this.disposables = [];
        }, null, this.disposables);
    }

    public async refresh(): Promise<void> {
        if (!this.panel) { return; }
        this.panel.webview.postMessage({ type: 'loading', loading: true });
        try {
            const data = await this.gitGraphProvider.getGraphData(this.mode);
            this.panel.webview.postMessage({ type: 'graphData', data });
        } catch (err) {
            this.panel.webview.postMessage({ type: 'error', message: String(err) });
        }
    }

    public setMode(mode: 'guardian' | 'full'): void {
        this.mode = mode;
        this.refresh();
    }

    public getMode(): 'guardian' | 'full' {
        return this.mode;
    }

    private async handleMessage(message: WebviewToExtensionMessage, initialFocusHash?: string): Promise<void> {
        switch (message.type) {
            case 'ready': {
                this.panel?.webview.postMessage({ type: 'loading', loading: true });
                try {
                    const data = await this.gitGraphProvider.getGraphData(this.mode);
                    this.panel?.webview.postMessage({ type: 'graphData', data });
                    if (initialFocusHash) {
                        this.panel?.webview.postMessage({ type: 'focusCommit', hash: initialFocusHash });
                    }
                    if (this.pendingTab) {
                        this.panel?.webview.postMessage({ type: 'switchTab', tab: this.pendingTab });
                        this.pendingTab = undefined;
                    }
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'requestGraphData': {
                this.mode = message.mode;
                this.panel?.webview.postMessage({ type: 'loading', loading: true });
                try {
                    const data = await this.gitGraphProvider.getGraphData(message.mode, message.maxCount);
                    this.panel?.webview.postMessage({ type: 'graphData', data });
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'requestCommitDetail': {
                try {
                    const detail = await this.gitGraphProvider.getCommitDetail(message.hash);
                    if (detail) {
                        this.panel?.webview.postMessage({ type: 'commitDetail', data: detail });
                    }
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'requestFileDiff': {
                try {
                    const diff = await this.gitManager.getDiff(`${message.hash}^`, message.hash);
                    const fileDiff = this.extractFileDiff(diff, message.filePath);
                    this.panel?.webview.postMessage({
                        type: 'diffContent',
                        data: { filePath: message.filePath, diff: fileDiff }
                    });
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'showVSCodeDiff': {
                await this.openVSCodeDiff(message.filePath, message.commitHash);
                break;
            }
            case 'openFile': {
                await this.openFileAtCommit(message.filePath, message.commitHash);
                break;
            }
            case 'rollbackToCommit': {
                const confirm = await vscode.window.showWarningMessage(
                    `Rollback to commit ${message.hash.substring(0, 7)}?`,
                    { modal: true },
                    'Rollback', 'Cancel'
                );
                if (confirm === 'Rollback') {
                    await this.gitManager.checkoutCommit(message.hash);
                    vscode.window.showInformationMessage(`Rolled back to ${message.hash.substring(0, 7)}`);
                }
                break;
            }
            // ── Multi-user / multi-branch / stash / remote operations ──────
            case 'requestStashes': {
                try {
                    const stashes = await this.gitManager.getStashList();
                    this.panel?.webview.postMessage({ type: 'stashList', data: stashes });
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'requestContributors': {
                try {
                    const contributors = await this.gitManager.getContributors();
                    this.panel?.webview.postMessage({ type: 'contributors', data: contributors });
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'requestRemotes': {
                try {
                    const remotes = await this.gitManager.getRemoteList();
                    this.panel?.webview.postMessage({ type: 'remotes', data: remotes });
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'requestBranchDetails': {
                try {
                    const branches = await this.gitManager.getBranchDetails();
                    this.panel?.webview.postMessage({ type: 'branchDetails', data: branches });
                } catch (err) {
                    this.panel?.webview.postMessage({ type: 'error', message: String(err) });
                }
                break;
            }
            case 'createBranch': {
                const created = await this.gitManager.createBranchFromHere(message.name);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: created === true, operation: 'createBranch',
                    message: created ? `Created branch '${message.name}'` : `Failed to create branch '${message.name}'`
                });
                if (created) { await this.refresh(); }
                break;
            }
            case 'checkoutBranch': {
                const branchName = message.name.replace(/^remotes\/[^/]+\//, '');
                const ok = await this.gitManager.checkoutBranch(branchName);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: ok, operation: 'checkoutBranch',
                    message: ok ? `Switched to '${branchName}'` : `Failed to checkout '${branchName}'`
                });
                if (ok) { await this.refresh(); }
                break;
            }
            case 'deleteBranch': {
                const res = await this.gitManager.deleteBranch(message.name, message.force);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'deleteBranch',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'mergeBranch': {
                const confirmed = await vscode.window.showWarningMessage(
                    `Merge '${message.name}' into current branch (${message.strategy})?`,
                    { modal: true }, 'Merge', 'Cancel'
                );
                if (confirmed !== 'Merge') { break; }
                const res = await this.gitManager.mergeBranch(message.name, message.strategy);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'mergeBranch',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'rebaseBranch': {
                const confirmed = await vscode.window.showWarningMessage(
                    `Rebase current branch onto '${message.name}'?`,
                    { modal: true,
                      detail: 'This rewrites commit history. Only do this on branches not yet pushed to shared remotes.' },
                    'Rebase', 'Cancel'
                );
                if (confirmed !== 'Rebase') { break; }
                const res = await this.gitManager.rebaseBranch(message.name);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'rebaseBranch',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'applyStash': {
                const res = await this.gitManager.applyStash(message.index);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'applyStash',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'popStash': {
                const res = await this.gitManager.popStash(message.index);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'popStash',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'dropStash': {
                const confirmed = await vscode.window.showWarningMessage(
                    `Drop stash@{${message.index}}? This cannot be undone.`,
                    { modal: true }, 'Drop', 'Cancel'
                );
                if (confirmed !== 'Drop') { break; }
                const res = await this.gitManager.dropStash(message.index);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'dropStash',
                    message: res.message
                });
                if (res.success) {
                    const stashes = await this.gitManager.getStashList();
                    this.panel?.webview.postMessage({ type: 'stashList', data: stashes });
                }
                break;
            }
            case 'createStash': {
                const res = await this.gitManager.createStash(message.message);
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'createStash',
                    message: res.message
                });
                if (res.success) {
                    const stashes = await this.gitManager.getStashList();
                    this.panel?.webview.postMessage({ type: 'stashList', data: stashes });
                }
                break;
            }
            case 'fetchRemote': {
                this.panel?.webview.postMessage({ type: 'loading', loading: true });
                const res = await this.gitManager.fetchRemote(message.remote);
                this.panel?.webview.postMessage({ type: 'loading', loading: false });
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'fetch',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'pullBranch': {
                this.panel?.webview.postMessage({ type: 'loading', loading: true });
                const res = await this.gitManager.pullBranch(message.remote, message.branch || undefined, message.rebase);
                this.panel?.webview.postMessage({ type: 'loading', loading: false });
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'pull',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
            case 'pushBranch': {
                this.panel?.webview.postMessage({ type: 'loading', loading: true });
                const res = await this.gitManager.pushBranch(message.remote, message.branch, message.force);
                this.panel?.webview.postMessage({ type: 'loading', loading: false });
                this.panel?.webview.postMessage({
                    type: 'operationResult', success: res.success, operation: 'push',
                    message: res.message
                });
                if (res.success) { await this.refresh(); }
                break;
            }
        }
    }

    private extractFileDiff(fullDiff: string, filePath: string): string {
        const lines = fullDiff.split('\n');
        let capturing = false;
        const result: string[] = [];

        for (const line of lines) {
            if (line.startsWith('diff --git')) {
                if (capturing) { break; }
                if (line.includes(filePath)) {
                    capturing = true;
                }
            }
            if (capturing) {
                result.push(line);
            }
        }

        return result.join('\n') || fullDiff;
    }

    private async openVSCodeDiff(filePath: string, commitHash: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const absolutePath = filePath.startsWith('/')
            ? filePath
            : vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;

        const parentCommit = `${commitHash}^`;
        const beforeContent = await this.gitManager.getFileAtCommit(absolutePath, parentCommit) ?? '';
        const afterContent = await this.gitManager.getFileAtCommit(absolutePath, commitHash) ?? '';

        const beforeDoc = await vscode.workspace.openTextDocument({ content: beforeContent, language: filePath.split('.').pop() || 'plaintext' });
        const afterDoc = await vscode.workspace.openTextDocument({ content: afterContent, language: filePath.split('.').pop() || 'plaintext' });

        const fileName = filePath.split('/').pop() || filePath;
        const shortHash = commitHash.substring(0, 8);

        await vscode.commands.executeCommand('vscode.diff',
            beforeDoc.uri, afterDoc.uri,
            `${fileName} (${shortHash}~1 ↔ ${shortHash})`,
            { preview: true }
        );
    }

    private async openFileAtCommit(filePath: string, commitHash: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const absolutePath = filePath.startsWith('/')
            ? filePath
            : vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;

        const content = await this.gitManager.getFileAtCommit(absolutePath, commitHash);
        if (content) {
            const doc = await vscode.workspace.openTextDocument({
                content,
                language: filePath.split('.').pop() || 'plaintext'
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        } else {
            vscode.window.showWarningMessage(`Could not retrieve file: ${filePath}`);
        }
    }

    private getWebviewContent(nonce: string): string {
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Git Graph</title>
<style nonce="${nonce}">
:root {
    --row-height: 28px;
    --lane-width: 14px;
    --node-radius: 4;
    --graph-left-pad: 10px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: var(--vscode-font-family, monospace);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100vh;
}
.tab-bar {
    display: flex;
    align-items: center;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
    overflow-x: auto;
}
.tab-btn {
    padding: 6px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0.7;
}
.tab-btn:hover { opacity: 1; }
.tab-btn.active {
    border-bottom-color: var(--vscode-focusBorder);
    opacity: 1;
    font-weight: 600;
}
.toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
    flex-wrap: wrap;
}
.toolbar button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    padding: 3px 8px;
    cursor: pointer;
    border-radius: 3px;
    font-size: 11px;
}
.toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.toolbar button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
.toolbar .spacer { flex: 1; }
.toolbar select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
    max-width: 200px;
}
.toolbar .branch-info {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}
.tab-panel { display: none; flex: 1; overflow: hidden; flex-direction: column; }
.tab-panel.active { display: flex; }
.graph-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    min-height: 0;
}
.graph-table { width: 100%; border-collapse: collapse; }
.graph-row {
    height: var(--row-height);
    cursor: pointer;
    transition: background 0.1s;
}
.graph-row:hover { background: var(--vscode-list-hoverBackground); }
.graph-row.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
}
.graph-row.guardian-commit .commit-msg { font-weight: 600; }
.graph-row.dimmed { opacity: 0.4; }
.graph-row.author-dimmed { opacity: 0.3; }
.graph-row.author-hidden { display: none; }
.graph-cell { vertical-align: middle; white-space: nowrap; padding: 0; height: var(--row-height); }
.graph-cell-svg { width: auto; min-width: 24px; }
.commit-hash {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-textLink-foreground);
    padding: 0 5px;
    font-size: 11px;
}
.commit-msg { padding: 0 5px; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
.commit-author { padding: 0 5px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.commit-date { padding: 0 5px; color: var(--vscode-descriptionForeground); font-size: 11px; text-align: right; }
.ref-badge {
    display: inline-block;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
    margin-left: 3px;
    font-weight: 600;
}
.ref-badge.branch { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.ref-badge.remote { background: #2d5c8a; color: #cce4ff; }
.ref-badge.tag { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
.ref-badge.head { background: var(--vscode-gitDecoration-addedResourceForeground); color: var(--vscode-editor-background); }
.guardian-badge {
    display: inline-block;
    padding: 1px 3px;
    border-radius: 2px;
    font-size: 9px;
    margin-left: 3px;
    background: var(--vscode-gitDecoration-addedResourceForeground);
    color: var(--vscode-editor-background);
}
.detail-panel {
    border-top: 2px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    max-height: 38vh;
    overflow-y: auto;
    display: none;
    flex-shrink: 0;
}
.detail-panel.visible { display: block; }
.detail-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    position: sticky;
    top: 0;
    background: var(--vscode-sideBar-background);
    z-index: 1;
}
.close-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 16px;
    padding: 1px 5px;
}
.close-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
.detail-body { padding: 6px 10px; }
.commit-info { margin-bottom: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.commit-full-msg {
    margin-bottom: 10px;
    padding: 5px;
    background: var(--vscode-editor-background);
    border-radius: 3px;
    white-space: pre-wrap;
    font-size: 12px;
}
.file-list { list-style: none; }
.file-list li {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 0;
    font-size: 11px;
    cursor: pointer;
}
.file-list li:hover { background: var(--vscode-list-hoverBackground); }
.file-status { font-weight: 700; width: 12px; text-align: center; }
.file-status.added { color: var(--vscode-gitDecoration-addedResourceForeground); }
.file-status.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.file-status.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.file-status.renamed { color: var(--vscode-gitDecoration-renamedResourceForeground, #73c991); }
.file-stats { color: var(--vscode-descriptionForeground); margin-left: auto; font-family: monospace; font-size: 10px; }
.file-stats .additions { color: var(--vscode-gitDecoration-addedResourceForeground); }
.file-stats .deletions { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.file-actions { display: flex; gap: 3px; margin-left: 6px; }
.file-actions button {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 10px;
    padding: 1px 3px;
}
.file-actions button:hover { text-decoration: underline; }
.diff-preview {
    margin-top: 6px;
    padding: 5px;
    background: var(--vscode-editor-background);
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    overflow-x: auto;
    white-space: pre;
    max-height: 250px;
    overflow-y: auto;
    display: none;
}
.diff-preview.visible { display: block; }
.diff-line-add { color: var(--vscode-gitDecoration-addedResourceForeground); }
.diff-line-del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.diff-line-hunk { color: var(--vscode-textLink-foreground); font-weight: 600; }
.panel-content { flex: 1; overflow-y: auto; padding: 6px 10px; }
.section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    padding: 6px 4px 2px;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-top: 4px;
}
.branch-item, .stash-item, .remote-item, .contributor-item {
    display: flex;
    align-items: center;
    padding: 4px 6px;
    border-radius: 3px;
    font-size: 12px;
}
.branch-item:hover, .stash-item:hover, .remote-item:hover, .contributor-item:hover {
    background: var(--vscode-list-hoverBackground);
}
.branch-item.current { font-weight: 700; }
.branch-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.branch-tracking { font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: 4px; white-space: nowrap; }
.ahead-behind { font-size: 10px; margin-left: 4px; }
.ahead { color: var(--vscode-gitDecoration-addedResourceForeground); }
.behind { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.item-actions { display: flex; gap: 2px; margin-left: 6px; flex-shrink: 0; }
.item-actions button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    padding: 2px 5px;
    cursor: pointer;
    border-radius: 2px;
    font-size: 10px;
    white-space: nowrap;
}
.item-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.item-actions button.danger { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.contributor-bar-wrap { flex: 1; margin: 0 8px; background: var(--vscode-editor-background); border-radius: 2px; height: 6px; overflow: hidden; min-width: 40px; }
.contributor-bar { height: 100%; background: var(--vscode-badge-background); border-radius: 2px; }
.contributor-count { font-size: 10px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
.author-filter-active { font-weight: 700; color: var(--vscode-focusBorder); }
.toast {
    position: fixed;
    bottom: 16px;
    right: 16px;
    padding: 8px 14px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 9999;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    max-width: 320px;
}
.toast.success { background: rgba(35,134,54,0.92); color:#fff; }
.toast.error   { background: rgba(180,50,50,0.92);  color:#fff; }
.toast.show    { opacity: 1; }
.loading-overlay {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    padding: 8px 16px;
    border-radius: 4px;
    display: none;
    z-index: 8888;
}
.loading-overlay.visible { display: block; }
.inline-form {
    display: flex;
    gap: 4px;
    padding: 4px 6px;
    align-items: center;
}
.inline-form input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 11px;
}
.inline-form button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}
.inline-form button.cancel {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
</style>
</head>
<body>
<div class="tab-bar">
    <button class="tab-btn active" data-tab="graph">&#9913; Graph</button>
    <button class="tab-btn" data-tab="branches">&#xa652; Branches</button>
    <button class="tab-btn" data-tab="contributors">&#128100; Contributors</button>
    <button class="tab-btn" data-tab="stashes">&#128230; Stashes</button>
    <button class="tab-btn" data-tab="remotes">&#9729; Remotes</button>
</div>
<div class="tab-panel active" id="tab-graph">
    <div class="toolbar">
        <button id="btn-guardian" data-mode="guardian">Guardian</button>
        <button id="btn-full" class="active" data-mode="full">Full History</button>
        <button id="btn-refresh-graph">&#8635; Refresh</button>
        <span>Author:</span>
        <select id="author-filter">
            <option value="">All</option>
        </select>
        <span id="filter-count" style="font-size:11px;color:var(--vscode-descriptionForeground);margin-left:4px"></span>
        <button id="btn-clear-author" style="display:none" class="toolbar-btn">&#10005; Clear</button>
        <span class="spacer"></span>
        <span class="branch-info" id="branch-info"></span>
    </div>
    <div class="graph-container">
        <table class="graph-table">
            <tbody id="graph-body"></tbody>
        </table>
    </div>
    <div class="detail-panel" id="detail-panel">
        <div class="detail-header">
            <strong id="detail-title">Commit Details</strong>
            <button class="close-btn" id="btn-close-detail">&times;</button>
        </div>
        <div class="detail-body" id="detail-body"></div>
    </div>
</div>
<div class="tab-panel" id="tab-branches">
    <div class="toolbar">
        <button id="btn-refresh-branches">&#8635; Refresh</button>
        <button id="btn-toggle-create-branch">+ New Branch</button>
        <span class="spacer"></span>
        <span class="branch-info" id="branch-info-2"></span>
    </div>
    <div id="create-branch-form" style="display:none">
        <div class="inline-form">
            <input id="new-branch-name" type="text" placeholder="branch-name"/>
            <button id="btn-do-create-branch">Create</button>
            <button class="cancel" id="btn-cancel-create-branch">Cancel</button>
        </div>
    </div>
    <div class="panel-content" id="branch-list-content">
        <div style="color:var(--vscode-descriptionForeground);padding:4px">Loading branches...</div>
    </div>
</div>
<div class="tab-panel" id="tab-contributors">
    <div class="toolbar">
        <button id="btn-refresh-contributors">&#8635; Refresh</button>
        <button id="clear-author-btn" style="display:none">&#10005; Clear filter</button>
        <span class="spacer"></span>
        <span id="active-author-label" class="author-filter-active"></span>
    </div>
    <div class="panel-content" id="contributor-list-content">
        <div style="color:var(--vscode-descriptionForeground);padding:4px">Loading contributors...</div>
    </div>
</div>
<div class="tab-panel" id="tab-stashes">
    <div class="toolbar">
        <button id="btn-refresh-stashes">&#8635; Refresh</button>
        <button id="btn-toggle-create-stash">+ Save Stash</button>
        <span class="spacer"></span>
    </div>
    <div id="create-stash-form" style="display:none">
        <div class="inline-form">
            <input id="new-stash-message" type="text" placeholder="Stash message (optional)"/>
            <button id="btn-do-create-stash">Save</button>
            <button class="cancel" id="btn-cancel-stash">Cancel</button>
        </div>
    </div>
    <div class="panel-content" id="stash-list-content">
        <div style="color:var(--vscode-descriptionForeground);padding:4px">Loading stashes...</div>
    </div>
</div>
<div class="tab-panel" id="tab-remotes">
    <div class="toolbar">
        <button id="btn-refresh-remotes">&#8635; Refresh</button>
        <button id="btn-fetch-all">&#8595; Fetch All</button>
        <span class="spacer"></span>
    </div>
    <div class="panel-content" id="remote-list-content">
        <div style="color:var(--vscode-descriptionForeground);padding:4px">Loading remotes...</div>
    </div>
</div>
<div class="toast" id="toast"></div>
<div class="loading-overlay" id="loading">Loading...</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const LANE_COLORS = [
    '#4dc9f6','#f67019','#f53794','#537bc4',
    '#acc236','#166a8f','#00a950','#8549ba',
    '#e6194b','#3cb44b','#ffe119','#4363d8',
    '#f58231','#911eb4','#42d4f4','#bfef45'
];
const ROW_HEIGHT = 28;
const LANE_WIDTH = 14;
const NODE_RADIUS = 4;
let currentData   = null;
let selectedHash  = null;
let currentMode   = 'full';
let activeAuthor  = '';

vscode.postMessage({ type: 'ready' });

window.addEventListener('message', ev => {
    const m = ev.data;
    switch (m.type) {
        case 'graphData':
            document.getElementById('loading').classList.remove('visible');
            currentData = m.data;
            console.log('[GitGraph] received graphData: ' + (m.data && m.data.commits ? m.data.commits.length : 0) + ' commits, mode=' + (m.data && m.data.mode));
            try {
                updateAuthorSelect(m.data);
                renderGraph(m.data);
            } catch (e) {
                console.error('[GitGraph] renderGraph error:', e);
                const tbody = document.getElementById('graph-body');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;color:red;text-align:center">Render error: ' + escH(String(e)) + '</td></tr>';
                }
                showToast('Render error: ' + e.message, 'error');
            }
            break;
        case 'commitDetail':   renderCommitDetail(m.data); break;
        case 'diffContent':    renderDiffPreview(m.data);  break;
        case 'loading':        document.getElementById('loading').classList.toggle('visible', !!m.loading); break;
        case 'error':
            document.getElementById('loading').classList.remove('visible');
            console.error('[GitGraph] extension error:', m.message);
            showToast('Error: ' + m.message, 'error');
            break;
        case 'focusCommit':    focusOnCommit(m.hash); break;
        case 'stashList':      renderStashList(m.data); break;
        case 'contributors':   renderContributorList(m.data); break;
        case 'remotes':        renderRemoteList(m.data); break;
        case 'branchDetails':  renderBranchList(m.data); break;
        case 'operationResult': showToast(m.message, m.success ? 'success' : 'error'); break;
        case 'switchTab':      showTab(m.tab); break;
    }
});

// ── Static button event listeners ────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
document.getElementById('btn-guardian').addEventListener('click', () => switchMode('guardian'));
document.getElementById('btn-full').addEventListener('click', () => switchMode('full'));
document.getElementById('btn-refresh-graph').addEventListener('click', () => refreshGraph());
document.getElementById('author-filter').addEventListener('change', () => applyAuthorFilter());
document.getElementById('btn-clear-author').addEventListener('click', () => clearAuthorFilter());
document.getElementById('btn-close-detail').addEventListener('click', () => closeDetail());
document.getElementById('btn-refresh-branches').addEventListener('click', () => loadBranches());
document.getElementById('btn-toggle-create-branch').addEventListener('click', () => toggleCreateBranchForm());
document.getElementById('btn-do-create-branch').addEventListener('click', () => doCreateBranch());
document.getElementById('btn-cancel-create-branch').addEventListener('click', () => toggleCreateBranchForm());
document.getElementById('new-branch-name').addEventListener('keydown', e => { if (e.key === 'Enter') doCreateBranch(); });
document.getElementById('btn-refresh-contributors').addEventListener('click', () => loadContributors());
document.getElementById('clear-author-btn').addEventListener('click', () => clearAuthorFilter());
document.getElementById('btn-refresh-stashes').addEventListener('click', () => loadStashes());
document.getElementById('btn-toggle-create-stash').addEventListener('click', () => toggleStashForm());
document.getElementById('btn-do-create-stash').addEventListener('click', () => doCreateStash());
document.getElementById('btn-cancel-stash').addEventListener('click', () => toggleStashForm());
document.getElementById('new-stash-message').addEventListener('keydown', e => { if (e.key === 'Enter') doCreateStash(); });
document.getElementById('btn-refresh-remotes').addEventListener('click', () => loadRemotes());
document.getElementById('btn-fetch-all').addEventListener('click', () => doFetchAll());

// ── Event delegation for dynamically rendered content ────────────────────
document.getElementById('graph-body').addEventListener('click', e => {
    const row = e.target.closest('tr[data-hash]');
    if (row) selectCommit(row.dataset.hash);
});
document.getElementById('detail-body').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'reqDiff')  { reqDiff(btn.dataset.hash, btn.dataset.file); }
    if (action === 'openVC')   { openVC(btn.dataset.file, btn.dataset.hash); }
});
document.getElementById('branch-list-content').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const name = btn.dataset.name || '';
    if (action === 'checkout')   { doCheckout(name); }
    if (action === 'merge')      { doMerge(name, btn.dataset.strategy || 'no-ff'); }
    if (action === 'rebase')     { doRebaseOnto(name); }
    if (action === 'deleteBranch') { doDeleteBranch(name, btn.dataset.force === 'true'); }
});
document.getElementById('contributor-list-content').addEventListener('click', e => {
    const item = e.target.closest('[data-author]');
    if (item) filterByAuthor(item.dataset.author);
});
document.getElementById('stash-list-content').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    const action = btn.dataset.action;
    if (action === 'applyStash') { vscode.postMessage({ type: 'applyStash', index: idx }); }
    if (action === 'popStash')   { vscode.postMessage({ type: 'popStash',   index: idx }); }
    if (action === 'dropStash')  { vscode.postMessage({ type: 'dropStash',  index: idx }); }
});
document.getElementById('remote-list-content').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const remote = btn.dataset.remote || '';
    if (action === 'fetchRemote') { vscode.postMessage({ type: 'fetchRemote', remote }); }
    if (action === 'pullBranch')  { vscode.postMessage({ type: 'pullBranch', remote, branch: '', rebase: false }); }
    if (action === 'pushBranch')  { vscode.postMessage({ type: 'pushBranch', remote, branch: '', force: false }); }
});

function showTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.dataset.tab === name) b.classList.add('active');
    });
    if (name === 'branches')     loadBranches();
    if (name === 'contributors') loadContributors();
    if (name === 'stashes')      loadStashes();
    if (name === 'remotes')      loadRemotes();
}

function switchMode(mode) {
    currentMode = mode;
    document.getElementById('btn-guardian').classList.toggle('active', mode === 'guardian');
    document.getElementById('btn-full').classList.toggle('active', mode === 'full');
    vscode.postMessage({ type: 'requestGraphData', mode, maxCount: 300 });
}
function refreshGraph() { vscode.postMessage({ type: 'requestGraphData', mode: currentMode, maxCount: 300 }); }

function updateAuthorSelect(data) {
    const sel = document.getElementById('author-filter');
    const prev = activeAuthor || sel.value;
    sel.innerHTML = '<option value="">All</option>';
    const names = [...new Set((data.commits || []).map(c => c.authorName))].sort();
    names.forEach(n => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n;
        if (n === prev) o.selected = true;
        sel.appendChild(o);
    });
    // Sync activeAuthor with actual select value (author may not exist in new mode)
    activeAuthor = sel.value;
    updateContributorFilterUI();
}

function applyAuthorFilter() {
    activeAuthor = document.getElementById('author-filter').value;
    updateContributorFilterUI();
    if (currentData) renderGraph(currentData);
}

function filterByAuthor(name) {
    activeAuthor = name;
    document.getElementById('author-filter').value = name;
    updateContributorFilterUI();
    if (currentData) renderGraph(currentData);
    showTab('graph');
}

function clearAuthorFilter() { filterByAuthor(''); }

function updateContributorFilterUI() {
    document.getElementById('active-author-label').textContent =
        activeAuthor ? 'Filtered: ' + activeAuthor : '';
    document.getElementById('clear-author-btn').style.display = activeAuthor ? '' : 'none';
    const clrBtn = document.getElementById('btn-clear-author');
    if (clrBtn) clrBtn.style.display = activeAuthor ? '' : 'none';
}

function renderGraph(data) {
    const tbody = document.getElementById('graph-body');
    tbody.innerHTML = '';
    const branchInfo = data.isDetached
        ? 'HEAD at ' + data.headHash.substring(0, 7)
        : '&#9135; ' + (data.currentBranch || 'unknown');
    document.getElementById('branch-info').innerHTML = branchInfo;
    const bi2 = document.getElementById('branch-info-2');
    if (bi2) bi2.innerHTML = branchInfo;
    const branchMap = new Map(), tagMap = new Map();
    (data.branches || []).forEach(b => {
        if (!branchMap.has(b.commitHash)) branchMap.set(b.commitHash, []);
        branchMap.get(b.commitHash).push(b);
    });
    (data.tags || []).forEach(t => {
        if (!tagMap.has(t.commitHash)) tagMap.set(t.commitHash, []);
        tagMap.get(t.commitHash).push(t);
    });
    if (!data.commits || data.commits.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 5;
        emptyCell.style.cssText = 'padding:24px 16px;color:var(--vscode-descriptionForeground);text-align:center;';
        if (data.mode === 'guardian') {
            emptyCell.innerHTML =
                '<div style="font-size:13px;margin-bottom:8px;">No Vibe Guardian checkpoints found</div>' +
                '<div style="font-size:11px;">This repository has no commits created by Vibe Code Guardian.</div>' +
                '<div style="font-size:11px;margin-top:6px;">Click <strong>Full History</strong> to browse all commits, or start making checkpoints to see them here.</div>';
        } else {
            emptyCell.innerHTML =
                '<div style="font-size:13px;margin-bottom:8px;">No commits found</div>' +
                '<div style="font-size:11px;">This repository has no git history yet.</div>';
        }
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
    }
    const svgW = Math.max(60, (data.totalLanes + 1) * LANE_WIDTH + 20);
    const cidx = new Map();
    data.commits.forEach((c, i) => cidx.set(c.hash, i));
    // Precompute baseline commits for smart author filtering
    // Baseline = merge commits + direct parents of matching commits
    const baselineHashes = new Set();
    if (activeAuthor) {
        const matchedParents = new Set();
        (data.commits || []).forEach(c => {
            if (c.authorName === activeAuthor) {
                (c.parents || []).forEach(ph => matchedParents.add(ph));
            }
        });
        (data.commits || []).forEach(c => {
            if (c.parents && c.parents.length > 1) { baselineHashes.add(c.hash); }
            if (matchedParents.has(c.hash)) { baselineHashes.add(c.hash); }
        });
    }
    for (let ri = 0; ri < data.commits.length; ri++) {
        const c = data.commits[ri];
        const tr = document.createElement('tr');
        tr.className = 'graph-row';
        if (c.isGuardianCommit) tr.classList.add('guardian-commit');
        if (currentMode === 'guardian' && !c.isGuardianCommit) tr.classList.add('dimmed');
        if (activeAuthor && c.authorName !== activeAuthor) {
            // Baseline commits (merge points, direct parents) stay dimmed; all else hidden
            tr.classList.add(baselineHashes.has(c.hash) ? 'author-dimmed' : 'author-hidden');
        }
        tr.dataset.hash = c.hash;
        const sc = document.createElement('td');
        sc.className = 'graph-cell graph-cell-svg';
        sc.innerHTML = buildSvg(c, ri, data, cidx, svgW);
        tr.appendChild(sc);
        const hc = document.createElement('td');
        hc.className = 'graph-cell commit-hash';
        hc.textContent = c.abbreviatedHash;
        tr.appendChild(hc);
        const mc = document.createElement('td');
        mc.className = 'graph-cell commit-msg';
        let mh = escH(c.message.length > 72 ? c.message.substring(0, 69) + '...' : c.message);
        if (c.isGuardianCommit) mh += '<span class="guardian-badge">VG</span>';
        (branchMap.get(c.hash) || []).forEach(b => {
            const cls = b.isCurrent ? 'ref-badge head' : b.isRemote ? 'ref-badge remote' : 'ref-badge branch';
            mh += '<span class="' + cls + '">' + escH(b.name.replace(new RegExp('^remotes/[^/]+/'), '')) + '</span>';
        });
        (tagMap.get(c.hash) || []).forEach(t => {
            mh += '<span class="ref-badge tag">' + escH(t.name) + '</span>';
        });
        mc.innerHTML = mh;
        tr.appendChild(mc);
        const ac = document.createElement('td');
        ac.className = 'graph-cell commit-author';
        ac.textContent = c.authorName;
        tr.appendChild(ac);
        const dc = document.createElement('td');
        dc.className = 'graph-cell commit-date';
        dc.textContent = relDate(c.date);
        tr.appendChild(dc);
        tbody.appendChild(tr);
    }
    // Update filter count status
    const filterCount = document.getElementById('filter-count');
    if (filterCount) {
        if (activeAuthor) {
            const cnt = (data.commits || []).filter(c => c.authorName === activeAuthor).length;
            filterCount.textContent = cnt + ' of ' + data.commits.length + ' commits';
        } else {
            filterCount.textContent = '';
        }
    }
}

function buildSvg(commit, ri, data, cidx, W) {
    const cx = 10 + commit.lane * LANE_WIDTH;
    const cy = ROW_HEIGHT / 2;
    let lines = '', nodes = '';

    // ── Pass-through lanes ────────────────────────────────────────────────
    // Collect lanes where a connection from a commit ABOVE passes through
    // this row to reach a parent BELOW this row.
    const passLanes = new Set();
    for (let p = 0; p < ri; p++) {
        const pc = data.commits[p];
        for (const ph of pc.parents) {
            const pi = cidx.get(ph);
            if (pi !== undefined && pi > ri) {
                const parent = data.commits[pi];
                // The connecting lane is whichever lane the bezier will end on
                passLanes.add(pc.lane === parent.lane ? pc.lane : parent.lane);
            }
        }
    }
    passLanes.delete(commit.lane);
    passLanes.forEach(lane => {
        const lx = 10 + lane * LANE_WIDTH;
        const col = LANE_COLORS[lane % LANE_COLORS.length];
        lines += '<line x1="' + lx + '" y1="0" x2="' + lx + '" y2="' + ROW_HEIGHT + '" stroke="' + col + '" stroke-width="1.5" opacity="0.45"/>';
    });

    // ── Incoming lines (top-half: y=0 → cy) ──────────────────────────────
    // Each child commit above this commit drew the bottom half of the edge.
    // We must draw the matching top half so the two halves meet at the node.
    for (const childHash of (commit.children || [])) {
        const childIdx = cidx.get(childHash);
        if (childIdx === undefined || childIdx >= ri) { continue; }
        const child = data.commits[childIdx];
        const parentIdx = child.parents.indexOf(commit.hash);
        if (parentIdx < 0) { continue; }
        const isMergeParent = parentIdx > 0;
        const col = LANE_COLORS[(isMergeParent ? commit.lane : child.lane) % LANE_COLORS.length];
        const sw = isMergeParent ? '1.5' : '2';
        lines += '<line x1="' + cx + '" y1="0" x2="' + cx + '" y2="' + cy + '" stroke="' + col + '" stroke-width="' + sw + '"/>';
    }

    // ── Outgoing lines (bottom-half: cy → ROW_HEIGHT) ─────────────────────
    for (let pi = 0; pi < commit.parents.length; pi++) {
        const pHash = commit.parents[pi];
        const pIdx = cidx.get(pHash);
        if (pIdx === undefined) { continue; }
        const parent = data.commits[pIdx];
        const px = 10 + parent.lane * LANE_WIDTH;
        const isMerge = pi > 0;
        const col = LANE_COLORS[(isMerge ? parent.lane : commit.lane) % LANE_COLORS.length];
        const sw = isMerge ? '1.5' : '2';
        if (commit.lane === parent.lane) {
            lines += '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + ROW_HEIGHT + '" stroke="' + col + '" stroke-width="' + sw + '"/>';
        } else {
            const m = cy + (ROW_HEIGHT - cy) * 0.55;
            lines += '<path d="M' + cx + ' ' + cy + ' C' + cx + ' ' + m + ' ' + px + ' ' + (ROW_HEIGHT - m) + ' ' + px + ' ' + ROW_HEIGHT + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '"/>';
        }
    }

    // ── Commit node ───────────────────────────────────────────────────────
    const ncol = LANE_COLORS[commit.lane % LANE_COLORS.length];
    const isHead = currentData && commit.hash === currentData.headHash;
    const isMergeC = commit.parents.length > 1;
    const r = isHead ? NODE_RADIUS + 2 : (isMergeC ? NODE_RADIUS + 1 : NODE_RADIUS);
    const fill = isMergeC ? 'var(--vscode-editor-background)' : ncol;
    const stroke = isHead ? '#fff" stroke-width="2.5' : ncol + '" stroke-width="' + (isMergeC ? '2' : '1.5');
    nodes += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '"/>';
    return '<svg width="' + W + '" height="' + ROW_HEIGHT + '">' + lines + nodes + '</svg>';
}

function selectCommit(hash) {
    document.querySelectorAll('.graph-row').forEach(r => r.classList.remove('selected'));
    const row = document.querySelector('[data-hash="' + hash + '"]');
    if (row) row.classList.add('selected');
    selectedHash = hash;
    vscode.postMessage({ type: 'requestCommitDetail', hash });
}

function focusOnCommit(hash) {
    const row = document.querySelector('[data-hash="' + hash + '"]');
    if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); selectCommit(hash); }
}

function renderCommitDetail(d) {
    document.getElementById('detail-title').textContent = 'Commit ' + d.hash.substring(0, 8);
    let h = '<div class="commit-info">';
    h += '<strong>Author:</strong> ' + escH(d.authorName) + ' &lt;' + escH(d.authorEmail) + '&gt;<br>';
    h += '<strong>Date:</strong> ' + new Date(d.date).toLocaleString() + '<br>';
    if (d.parents.length > 1) h += '<strong>Type:</strong> <span style="color:var(--vscode-editorWarning-foreground)">Merge commit</span><br>';
    h += '<strong>Parents:</strong> ' + d.parents.map(p => p.substring(0, 7)).join(', ');
    h += '</div>';
    h += '<div class="commit-full-msg">' + escH(d.fullMessage) + '</div>';
    if (d.changedFiles.length > 0) {
        h += '<strong>Changed Files (' + d.changedFiles.length + '):</strong><ul class="file-list">';
        for (const f of d.changedFiles) {
            const safeHash = escH(d.hash);
            const safePath = escH(f.path);
            h += '<li>';
            h += '<span class="file-status ' + f.status + '">' + f.status[0].toUpperCase() + '</span>';
            h += '<span>' + safePath + '</span>';
            const stats = !f.binary
                ? '<span class="additions">+' + f.insertions + '</span> <span class="deletions">-' + f.deletions + '</span>'
                : 'binary';
            h += '<span class="file-stats">' + stats + '</span>';
            h += '<span class="file-actions">';
            h += '<button data-action="reqDiff" data-hash="' + safeHash + '" data-file="' + safePath + '">Diff</button>';
            h += '<button data-action="openVC" data-hash="' + safeHash + '" data-file="' + safePath + '">Open</button>';
            h += '</span></li>';
        }
        h += '</ul>';
    }
    h += '<div class="diff-preview" id="diff-preview"></div>';
    document.getElementById('detail-body').innerHTML = h;
    document.getElementById('detail-panel').classList.add('visible');
}

function reqDiff(h, f) { vscode.postMessage({ type: 'requestFileDiff', hash: h, filePath: f }); }
function openVC(f, h)  { vscode.postMessage({ type: 'showVSCodeDiff', filePath: f, commitHash: h }); }

function renderDiffPreview(data) {
    const p = document.getElementById('diff-preview');
    if (!p) return;
    const lines = data.diff.split('\\n');
    let h = '';
    for (const l of lines) {
        let c = '';
        if (l.startsWith('+') && !l.startsWith('+++')) c = 'diff-line-add';
        else if (l.startsWith('-') && !l.startsWith('---')) c = 'diff-line-del';
        else if (l.startsWith('@@')) c = 'diff-line-hunk';
        h += '<span class="' + c + '">' + escH(l) + '</span>\\n';
    }
    p.innerHTML = h;
    p.classList.add('visible');
}

function closeDetail() {
    document.getElementById('detail-panel').classList.remove('visible');
    document.querySelectorAll('.graph-row').forEach(r => r.classList.remove('selected'));
    selectedHash = null;
}

function loadBranches() {
    document.getElementById('branch-list-content').innerHTML = '<div style="color:var(--vscode-descriptionForeground);padding:4px">Loading...</div>';
    vscode.postMessage({ type: 'requestBranchDetails' });
}
function toggleCreateBranchForm() {
    const f = document.getElementById('create-branch-form');
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display !== 'none') document.getElementById('new-branch-name').focus();
}
function doCreateBranch() {
    const n = document.getElementById('new-branch-name').value.trim();
    if (!n) return;
    vscode.postMessage({ type: 'createBranch', name: n });
    document.getElementById('new-branch-name').value = '';
    toggleCreateBranchForm();
}
function doCheckout(n)        { vscode.postMessage({ type: 'checkoutBranch', name: n }); }
function doDeleteBranch(n, f) { vscode.postMessage({ type: 'deleteBranch', name: n, force: !!f }); }
function doMerge(n, s)        { vscode.postMessage({ type: 'mergeBranch', name: n, strategy: s || 'no-ff' }); }
function doRebaseOnto(n)      { vscode.postMessage({ type: 'rebaseBranch', name: n }); }

function renderBranchList(branches) {
    const el = document.getElementById('branch-list-content');
    if (!branches || !branches.length) {
        el.innerHTML = '<div style="padding:6px;color:var(--vscode-descriptionForeground)">No branches found.</div>';
        return;
    }
    const local  = branches.filter(b => !b.isRemote);
    const remote = branches.filter(b => b.isRemote);
    let h = '';
    if (local.length) {
        h += '<div class="section-title">LOCAL BRANCHES</div>';
        for (const b of local) {
            const safeName = escH(b.name);
            h += '<div class="branch-item' + (b.isCurrent ? ' current' : '') + '">';
            h += '<span class="branch-name">' + (b.isCurrent ? '&#10003; ' : '&nbsp;&nbsp;') + safeName + '</span>';
            if (b.tracking) h += '<span class="branch-tracking">' + escH(b.tracking) + '</span>';
            if (b.ahead || b.behind) {
                h += '<span class="ahead-behind">';
                if (b.ahead)  h += '<span class="ahead">&#8593;' + b.ahead + '</span>';
                if (b.behind) h += '<span class="behind">&#8595;' + b.behind + '</span>';
                h += '</span>';
            }
            h += '<span class="item-actions">';
            if (!b.isCurrent) {
                h += '<button data-action="checkout" data-name="' + safeName + '">Checkout</button>';
                h += '<button data-action="merge" data-name="' + safeName + '" data-strategy="no-ff">Merge</button>';
                h += '<button data-action="rebase" data-name="' + safeName + '">Rebase onto</button>';
                h += '<button class="danger" data-action="deleteBranch" data-name="' + safeName + '" data-force="false">Delete</button>';
            }
            h += '</span></div>';
        }
    }
    if (remote.length) {
        h += '<div class="section-title" style="margin-top:8px">REMOTE BRANCHES</div>';
        for (const b of remote) {
            const safeName = escH(b.name);
            h += '<div class="branch-item">';
            h += '<span class="branch-name" style="color:var(--vscode-descriptionForeground)">' + safeName + '</span>';
            h += '<span class="item-actions"><button data-action="checkout" data-name="' + safeName + '">Checkout</button></span>';
            h += '</div>';
        }
    }
    el.innerHTML = h;
}

function loadContributors() {
    document.getElementById('contributor-list-content').innerHTML = '<div style="color:var(--vscode-descriptionForeground);padding:4px">Loading...</div>';
    vscode.postMessage({ type: 'requestContributors' });
}
function renderContributorList(contribs) {
    const el = document.getElementById('contributor-list-content');
    if (!contribs || !contribs.length) {
        el.innerHTML = '<div style="padding:6px;color:var(--vscode-descriptionForeground)">No contributors found.</div>';
        return;
    }
    const maxC = Math.max(...contribs.map(c => c.commitCount), 1);
    let h = '<div class="section-title">CONTRIBUTORS (' + contribs.length + ')</div>';
    h += '<div style="font-size:10px;color:var(--vscode-descriptionForeground);padding:2px 6px 4px">Click to filter graph by author</div>';
    for (const c of contribs) {
        const pct = Math.round((c.commitCount / maxC) * 100);
        const isA = activeAuthor === c.name;
        const safeName = escH(c.name);
        h += '<div class="contributor-item" data-author="' + safeName + '" style="' + (isA ? 'background:var(--vscode-list-activeSelectionBackground);' : '') + 'cursor:pointer">';
        h += '<span style="flex:0 0 auto;font-size:12px;margin-right:4px">' + safeName + '</span>';
        h += '<div class="contributor-bar-wrap"><div class="contributor-bar" style="width:' + pct + '%"></div></div>';
        h += '<span class="contributor-count">' + c.commitCount + '</span>';
        h += '</div>';
    }
    el.innerHTML = h;
}

function loadStashes() {
    document.getElementById('stash-list-content').innerHTML = '<div style="color:var(--vscode-descriptionForeground);padding:4px">Loading...</div>';
    vscode.postMessage({ type: 'requestStashes' });
}
function toggleStashForm() {
    const f = document.getElementById('create-stash-form');
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display !== 'none') { document.getElementById('new-stash-message').focus(); }
}
function doCreateStash() {
    const msg = document.getElementById('new-stash-message').value.trim();
    vscode.postMessage({ type: 'createStash', message: msg || undefined });
    document.getElementById('new-stash-message').value = '';
    toggleStashForm();
}
function renderStashList(stashes) {
    const el = document.getElementById('stash-list-content');
    if (!stashes || !stashes.length) {
        el.innerHTML = '<div style="padding:6px;color:var(--vscode-descriptionForeground)">No stashes.</div>';
        return;
    }
    let h = '<div class="section-title">STASHES (' + stashes.length + ')</div>';
    for (const s of stashes) {
        h += '<div class="stash-item">';
        h += '<span style="flex:1;overflow:hidden">';
        h += '<span style="color:var(--vscode-textLink-foreground)">' + escH(s.ref) + '</span> ' + escH(s.message);
        h += '<br><span style="font-size:10px;color:var(--vscode-descriptionForeground)">' + escH(s.authorName) + ' &middot; ' + relDate(s.date) + (s.branch ? ' &middot; on ' + escH(s.branch) : '') + '</span>';
        h += '</span><span class="item-actions">';
        h += '<button data-action="applyStash" data-index="' + s.index + '">Apply</button>';
        h += '<button data-action="popStash"   data-index="' + s.index + '">Pop</button>';
        h += '<button class="danger" data-action="dropStash" data-index="' + s.index + '">Drop</button>';
        h += '</span></div>';
    }
    el.innerHTML = h;
}

function loadRemotes() {
    document.getElementById('remote-list-content').innerHTML = '<div style="color:var(--vscode-descriptionForeground);padding:4px">Loading...</div>';
    vscode.postMessage({ type: 'requestRemotes' });
}
function doFetchAll() { vscode.postMessage({ type: 'fetchRemote', remote: '--all' }); }
function renderRemoteList(remotes) {
    const el = document.getElementById('remote-list-content');
    if (!remotes || !remotes.length) {
        el.innerHTML = '<div style="padding:6px;color:var(--vscode-descriptionForeground)">No remotes configured.</div>';
        return;
    }
    let h = '<div class="section-title">REMOTES</div>';
    for (const r of remotes) {
        const safeRemote = escH(r.name);
        h += '<div class="remote-item">';
        h += '<span style="flex:1;overflow:hidden"><strong>' + safeRemote + '</strong><br>';
        h += '<span style="font-size:10px;color:var(--vscode-descriptionForeground)">' + escH(r.fetchUrl) + '</span></span>';
        h += '<span class="item-actions">';
        h += '<button data-action="fetchRemote" data-remote="' + safeRemote + '">Fetch</button>';
        h += '<button data-action="pullBranch"  data-remote="' + safeRemote + '">Pull</button>';
        h += '<button data-action="pushBranch"  data-remote="' + safeRemote + '">Push</button>';
        h += '</span></div>';
    }
    el.innerHTML = h;
}

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast ' + type + ' show';
    setTimeout(() => t.classList.remove('show'), 3500);
}
function relDate(ds) {
    if (!ds) return '';
    const d = Date.now() - new Date(ds).getTime();
    const s = Math.floor(d/1000), m = Math.floor(s/60), h = Math.floor(m/60), day = Math.floor(h/24);
    if (s < 60)  return 'just now';
    if (m < 60)  return m + 'm ago';
    if (h < 24)  return h + 'h ago';
    if (day < 30) return day + 'd ago';
    return new Date(ds).toLocaleDateString();
}
function escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
    }


    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
        this.disposables.forEach(d => d.dispose());
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
