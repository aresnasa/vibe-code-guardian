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
    private mode: 'guardian' | 'full' = 'guardian';
    private disposables: vscode.Disposable[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private gitManager: GitManager
    ) {
        this.gitGraphProvider = new GitGraphProvider(gitManager);
    }

    public async show(focusCommitHash?: string): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            if (focusCommitHash) {
                this.panel.webview.postMessage({
                    type: 'focusCommit',
                    hash: focusCommitHash
                });
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

        this.panel.iconPath = new vscode.ThemeIcon('git-merge');

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
                    // Filter diff to only the requested file
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
    --row-height: 32px;
    --lane-width: 16px;
    --node-radius: 5;
    --graph-left-pad: 12px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: var(--vscode-font-family, monospace);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100vh;
}

/* Toolbar */
.toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
}
.toolbar button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 3px;
    font-size: 12px;
}
.toolbar button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
}
.toolbar button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
.toolbar .spacer { flex: 1; }
.toolbar .branch-info {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
}

/* Main content area */
.main-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
}

/* Graph area */
.graph-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    min-height: 0;
}
.graph-table {
    width: 100%;
    border-collapse: collapse;
}
.graph-row {
    height: var(--row-height);
    cursor: pointer;
    transition: background 0.1s;
}
.graph-row:hover {
    background: var(--vscode-list-hoverBackground);
}
.graph-row.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
}
.graph-row.guardian-commit .commit-msg {
    font-weight: 600;
}
.graph-row.dimmed {
    opacity: 0.5;
}
.graph-cell {
    vertical-align: middle;
    white-space: nowrap;
    padding: 0;
    height: var(--row-height);
}
.graph-cell-svg {
    width: auto;
    min-width: 30px;
}
.commit-hash {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-textLink-foreground);
    padding: 0 6px;
    font-size: 12px;
}
.commit-msg {
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 500px;
}
.commit-author {
    padding: 0 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
}
.commit-date {
    padding: 0 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    text-align: right;
}
.ref-badge {
    display: inline-block;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
    margin-left: 4px;
    font-weight: 600;
}
.ref-badge.branch {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
}
.ref-badge.tag {
    background: var(--vscode-editorWarning-foreground);
    color: var(--vscode-editor-background);
}
.ref-badge.head {
    background: var(--vscode-gitDecoration-addedResourceForeground);
    color: var(--vscode-editor-background);
}
.guardian-badge {
    display: inline-block;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
    margin-left: 4px;
    background: var(--vscode-gitDecoration-addedResourceForeground);
    color: var(--vscode-editor-background);
}

/* Detail panel */
.detail-panel {
    border-top: 2px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    max-height: 40vh;
    overflow-y: auto;
    display: none;
    flex-shrink: 0;
}
.detail-panel.visible { display: block; }
.detail-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
}
.detail-header .close-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
}
.detail-header .close-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
}
.detail-body {
    padding: 8px 12px;
}
.detail-body .commit-info {
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
}
.detail-body .commit-full-msg {
    margin-bottom: 12px;
    padding: 6px;
    background: var(--vscode-editor-background);
    border-radius: 3px;
    white-space: pre-wrap;
    font-size: 13px;
}
.file-list { list-style: none; }
.file-list li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
    cursor: pointer;
}
.file-list li:hover {
    background: var(--vscode-list-hoverBackground);
}
.file-status {
    font-weight: 700;
    width: 14px;
    text-align: center;
}
.file-status.added { color: var(--vscode-gitDecoration-addedResourceForeground); }
.file-status.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.file-status.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.file-status.renamed { color: var(--vscode-gitDecoration-renamedResourceForeground, #73c991); }
.file-stats {
    color: var(--vscode-descriptionForeground);
    margin-left: auto;
    font-family: var(--vscode-editor-font-family, monospace);
}
.file-stats .additions { color: var(--vscode-gitDecoration-addedResourceForeground); }
.file-stats .deletions { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.file-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
}
.file-actions button {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 11px;
    padding: 1px 4px;
}
.file-actions button:hover {
    text-decoration: underline;
}

/* Diff preview */
.diff-preview {
    margin-top: 8px;
    padding: 6px;
    background: var(--vscode-editor-background);
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    overflow-x: auto;
    white-space: pre;
    max-height: 300px;
    overflow-y: auto;
    display: none;
}
.diff-preview.visible { display: block; }
.diff-line-add { color: var(--vscode-gitDecoration-addedResourceForeground); }
.diff-line-del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.diff-line-hunk { color: var(--vscode-textLink-foreground); font-weight: 600; }

/* Loading / Error */
.loading-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 14px;
    color: var(--vscode-descriptionForeground);
    display: none;
}
.loading-overlay.visible { display: block; }
</style>
</head>
<body>
<div class="toolbar">
    <button id="btn-guardian" class="active" onclick="switchMode('guardian')">Guardian</button>
    <button id="btn-full" onclick="switchMode('full')">Full History</button>
    <button onclick="refreshGraph()">Refresh</button>
    <span class="spacer"></span>
    <span class="branch-info" id="branch-info"></span>
</div>

<div class="main-content">
    <div class="graph-container" id="graph-container">
        <table class="graph-table" id="graph-table">
            <tbody id="graph-body"></tbody>
        </table>
    </div>

    <div class="detail-panel" id="detail-panel">
        <div class="detail-header">
            <strong id="detail-title">Commit Details</strong>
            <button class="close-btn" onclick="closeDetail()">&times;</button>
        </div>
        <div class="detail-body" id="detail-body"></div>
    </div>
</div>

<div class="loading-overlay" id="loading">Loading graph...</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

const LANE_COLORS = [
    '#4dc9f6', '#f67019', '#f53794', '#537bc4',
    '#acc236', '#166a8f', '#00a950', '#8549ba',
    '#e6194b', '#3cb44b'
];

const ROW_HEIGHT = 32;
const LANE_WIDTH = 16;
const NODE_RADIUS = 5;
const GRAPH_LEFT_PAD = 12;

let currentData = null;
let selectedHash = null;
let currentMode = 'guardian';

// Signal ready
vscode.postMessage({ type: 'ready' });

window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
        case 'graphData':
            document.getElementById('loading').classList.remove('visible');
            currentData = msg.data;
            renderGraph(msg.data);
            break;
        case 'commitDetail':
            renderCommitDetail(msg.data);
            break;
        case 'diffContent':
            renderDiffPreview(msg.data);
            break;
        case 'loading':
            if (msg.loading) {
                document.getElementById('loading').classList.add('visible');
            } else {
                document.getElementById('loading').classList.remove('visible');
            }
            break;
        case 'error':
            document.getElementById('loading').classList.remove('visible');
            console.error('Error:', msg.message);
            break;
        case 'focusCommit':
            focusOnCommit(msg.hash);
            break;
    }
});

function switchMode(mode) {
    currentMode = mode;
    document.getElementById('btn-guardian').classList.toggle('active', mode === 'guardian');
    document.getElementById('btn-full').classList.toggle('active', mode === 'full');
    vscode.postMessage({ type: 'requestGraphData', mode: mode, maxCount: 200 });
}

function refreshGraph() {
    vscode.postMessage({ type: 'requestGraphData', mode: currentMode, maxCount: 200 });
}

function renderGraph(data) {
    const tbody = document.getElementById('graph-body');
    tbody.innerHTML = '';

    // Update branch info
    const branchInfo = document.getElementById('branch-info');
    if (data.isDetached) {
        branchInfo.textContent = 'HEAD detached at ' + data.headHash.substring(0, 7);
    } else {
        branchInfo.textContent = 'Branch: ' + (data.currentBranch || 'unknown');
    }

    // Build tag/branch maps
    const branchMap = new Map();
    const tagMap = new Map();
    for (const b of data.branches) {
        if (!branchMap.has(b.commitHash)) branchMap.set(b.commitHash, []);
        branchMap.get(b.commitHash).push(b);
    }
    for (const t of data.tags) {
        if (!tagMap.has(t.commitHash)) tagMap.set(t.commitHash, []);
        tagMap.get(t.commitHash).push(t);
    }

    const svgWidth = (data.totalLanes + 1) * LANE_WIDTH + GRAPH_LEFT_PAD * 2;

    // Build commit index for parent lookups
    const commitIndex = new Map();
    data.commits.forEach((c, i) => commitIndex.set(c.hash, i));

    for (let rowIdx = 0; rowIdx < data.commits.length; rowIdx++) {
        const commit = data.commits[rowIdx];
        const tr = document.createElement('tr');
        tr.className = 'graph-row';
        if (commit.isGuardianCommit) tr.classList.add('guardian-commit');
        if (currentMode === 'guardian' && !commit.isGuardianCommit) tr.classList.add('dimmed');
        tr.dataset.hash = commit.hash;
        tr.onclick = () => selectCommit(commit.hash);

        // SVG cell
        const svgCell = document.createElement('td');
        svgCell.className = 'graph-cell graph-cell-svg';
        svgCell.innerHTML = buildSvgForRow(commit, rowIdx, data, commitIndex, svgWidth);
        tr.appendChild(svgCell);

        // Hash cell
        const hashCell = document.createElement('td');
        hashCell.className = 'graph-cell commit-hash';
        hashCell.textContent = commit.abbreviatedHash;
        tr.appendChild(hashCell);

        // Message cell with ref badges
        const msgCell = document.createElement('td');
        msgCell.className = 'graph-cell commit-msg';
        let msgHtml = escapeHtml(commit.message.length > 60 ? commit.message.substring(0, 57) + '...' : commit.message);

        if (commit.isGuardianCommit) {
            msgHtml += '<span class="guardian-badge">VG</span>';
        }

        // Branch badges
        const branches = branchMap.get(commit.hash) || [];
        for (const b of branches) {
            const isHead = b.isCurrent;
            const cls = isHead ? 'ref-badge head' : 'ref-badge branch';
            const name = b.name.replace('remotes/origin/', '');
            msgHtml += '<span class="' + cls + '">' + escapeHtml(name) + '</span>';
        }

        // Tag badges
        const tags = tagMap.get(commit.hash) || [];
        for (const t of tags) {
            msgHtml += '<span class="ref-badge tag">' + escapeHtml(t.name) + '</span>';
        }

        msgCell.innerHTML = msgHtml;
        tr.appendChild(msgCell);

        // Author cell
        const authorCell = document.createElement('td');
        authorCell.className = 'graph-cell commit-author';
        authorCell.textContent = commit.authorName;
        tr.appendChild(authorCell);

        // Date cell
        const dateCell = document.createElement('td');
        dateCell.className = 'graph-cell commit-date';
        dateCell.textContent = getRelativeDate(commit.date);
        tr.appendChild(dateCell);

        tbody.appendChild(tr);
    }
}

function buildSvgForRow(commit, rowIdx, data, commitIndex, svgWidth) {
    const cx = GRAPH_LEFT_PAD + commit.lane * LANE_WIDTH;
    const cy = ROW_HEIGHT / 2;
    let svg = '<svg width="' + svgWidth + '" height="' + ROW_HEIGHT + '">';

    // Draw lines to parents
    for (const parentHash of commit.parents) {
        const parentIdx = commitIndex.get(parentHash);
        if (parentIdx === undefined) continue;
        const parent = data.commits[parentIdx];
        const px = GRAPH_LEFT_PAD + parent.lane * LANE_WIDTH;
        const rowsDown = parentIdx - rowIdx;

        const color = LANE_COLORS[commit.lane % LANE_COLORS.length];

        if (commit.lane === parent.lane) {
            // Straight vertical line to next row (we just draw to bottom of current cell)
            svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + ROW_HEIGHT + '" stroke="' + color + '" stroke-width="2"/>';
        } else {
            // Curved line for branch/merge
            const mergeColor = LANE_COLORS[parent.lane % LANE_COLORS.length];
            // Draw bezier from current node to bottom of cell towards parent lane
            const endX = px;
            svg += '<path d="M ' + cx + ' ' + cy + ' C ' + cx + ' ' + ROW_HEIGHT + ' ' + endX + ' 0 ' + endX + ' ' + ROW_HEIGHT + '" fill="none" stroke="' + mergeColor + '" stroke-width="2"/>';
        }
    }

    // Draw continuation lines for lanes that pass through this row
    // (simplified: draw straight lines for active lanes that are not this commit)
    for (let prevIdx = 0; prevIdx < rowIdx; prevIdx++) {
        const prevCommit = data.commits[prevIdx];
        for (const parentHash of prevCommit.parents) {
            const parentIdx = commitIndex.get(parentHash);
            if (parentIdx === undefined || parentIdx <= rowIdx) continue;
            const parent = data.commits[parentIdx];
            // This parent extends past the current row
            if (parentIdx > rowIdx) {
                // Determine which lane to draw the pass-through
                const lane = (prevCommit.lane === parent.lane)
                    ? prevCommit.lane
                    : parent.lane;
                const lx = GRAPH_LEFT_PAD + lane * LANE_WIDTH;
                const passColor = LANE_COLORS[lane % LANE_COLORS.length];
                svg += '<line x1="' + lx + '" y1="0" x2="' + lx + '" y2="' + ROW_HEIGHT + '" stroke="' + passColor + '" stroke-width="2" opacity="0.4"/>';
            }
        }
    }

    // Draw node circle
    const nodeColor = LANE_COLORS[commit.lane % LANE_COLORS.length];
    const isHead = currentData && commit.hash === currentData.headHash;
    const radius = isHead ? NODE_RADIUS + 2 : NODE_RADIUS;
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="' + nodeColor + '" stroke="' + (isHead ? '#fff' : nodeColor) + '" stroke-width="' + (isHead ? 2 : 0) + '"/>';

    svg += '</svg>';
    return svg;
}

function selectCommit(hash) {
    // Deselect previous
    const rows = document.querySelectorAll('.graph-row');
    rows.forEach(r => r.classList.remove('selected'));

    // Select new
    const row = document.querySelector('[data-hash="' + hash + '"]');
    if (row) row.classList.add('selected');

    selectedHash = hash;
    vscode.postMessage({ type: 'requestCommitDetail', hash: hash });
}

function focusOnCommit(hash) {
    const row = document.querySelector('[data-hash="' + hash + '"]');
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectCommit(hash);
    }
}

function renderCommitDetail(detail) {
    const panel = document.getElementById('detail-panel');
    const body = document.getElementById('detail-body');
    const title = document.getElementById('detail-title');

    title.textContent = 'Commit ' + detail.hash.substring(0, 8);

    let html = '<div class="commit-info">';
    html += '<strong>Author:</strong> ' + escapeHtml(detail.authorName) + ' &lt;' + escapeHtml(detail.authorEmail) + '&gt;<br>';
    html += '<strong>Date:</strong> ' + new Date(detail.date).toLocaleString() + '<br>';
    html += '<strong>Parents:</strong> ' + detail.parents.map(p => p.substring(0, 7)).join(', ');
    html += '</div>';

    html += '<div class="commit-full-msg">' + escapeHtml(detail.fullMessage) + '</div>';

    if (detail.changedFiles.length > 0) {
        html += '<strong>Changed Files (' + detail.changedFiles.length + '):</strong>';
        html += '<ul class="file-list">';
        for (const file of detail.changedFiles) {
            const statusLetter = file.status[0].toUpperCase();
            html += '<li onclick="event.stopPropagation()">';
            html += '<span class="file-status ' + file.status + '">' + statusLetter + '</span>';
            html += '<span>' + escapeHtml(file.path) + '</span>';
            html += '<span class="file-stats">';
            if (!file.binary) {
                html += '<span class="additions">+' + file.insertions + '</span> ';
                html += '<span class="deletions">-' + file.deletions + '</span>';
            } else {
                html += 'binary';
            }
            html += '</span>';
            html += '<span class="file-actions">';
            html += '<button onclick="requestFileDiff(\'' + escapeAttr(detail.hash) + '\', \'' + escapeAttr(file.path) + '\')">Diff</button>';
            html += '<button onclick="openInVSCode(\'' + escapeAttr(file.path) + '\', \'' + escapeAttr(detail.hash) + '\')">Open</button>';
            html += '</span>';
            html += '</li>';
        }
        html += '</ul>';
    }

    html += '<div class="diff-preview" id="diff-preview"></div>';

    body.innerHTML = html;
    panel.classList.add('visible');
}

function requestFileDiff(hash, filePath) {
    vscode.postMessage({ type: 'requestFileDiff', hash: hash, filePath: filePath });
}

function openInVSCode(filePath, commitHash) {
    vscode.postMessage({ type: 'showVSCodeDiff', filePath: filePath, commitHash: commitHash });
}

function renderDiffPreview(data) {
    const preview = document.getElementById('diff-preview');
    if (!preview) return;

    const lines = data.diff.split('\\n');
    let html = '';
    for (const line of lines) {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-line-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-line-del';
        else if (line.startsWith('@@')) cls = 'diff-line-hunk';
        html += '<span class="' + cls + '">' + escapeHtml(line) + '</span>\\n';
    }
    preview.innerHTML = html;
    preview.classList.add('visible');
}

function closeDetail() {
    document.getElementById('detail-panel').classList.remove('visible');
    const rows = document.querySelectorAll('.graph-row');
    rows.forEach(r => r.classList.remove('selected'));
    selectedHash = null;
}

function getRelativeDate(dateStr) {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = now - date;
    const sec = Math.floor(diff / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (sec < 60) return 'just now';
    if (min < 60) return min + 'm ago';
    if (hr < 24) return hr + 'h ago';
    if (day < 30) return day + 'd ago';
    return new Date(dateStr).toLocaleDateString();
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return str.replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
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
