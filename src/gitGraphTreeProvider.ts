/**
 * Vibe Code Guardian - Git Graph Tree Provider
 * Sidebar tree view for commit browsing
 */

import * as vscode from 'vscode';
import { GitManager } from './gitManager';

export class GitGraphTreeItem extends vscode.TreeItem {
    public commitHash?: string;
    public filePath?: string;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        options?: {
            commitHash?: string;
            filePath?: string;
            description?: string;
            tooltip?: string | vscode.MarkdownString;
            contextValue?: string;
            iconPath?: vscode.ThemeIcon;
            command?: vscode.Command;
        }
    ) {
        super(label, collapsibleState);
        if (options) {
            this.commitHash = options.commitHash;
            this.filePath = options.filePath;
            this.description = options.description;
            this.tooltip = options.tooltip;
            this.contextValue = options.contextValue;
            this.iconPath = options.iconPath;
            if (options.command) {
                this.command = options.command;
            }
        }
    }
}

export class GitGraphTreeProvider implements vscode.TreeDataProvider<GitGraphTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<GitGraphTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private mode: 'guardian' | 'full' = 'guardian';

    constructor(private gitManager: GitManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getMode(): 'guardian' | 'full' {
        return this.mode;
    }

    setMode(mode: 'guardian' | 'full'): void {
        this.mode = mode;
        this.refresh();
    }

    getTreeItem(element: GitGraphTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GitGraphTreeItem): Promise<GitGraphTreeItem[]> {
        if (!element) {
            return this.getRootItems();
        }

        if (element.contextValue === 'graph-commit' && element.commitHash) {
            return this.getCommitFiles(element.commitHash);
        }

        return [];
    }

    private async getRootItems(): Promise<GitGraphTreeItem[]> {
        const guardianOnly = this.mode === 'guardian';
        const commits = await this.gitManager.getGraphCommits(50, guardianOnly);

        if (commits.length === 0) {
            return [new GitGraphTreeItem(
                guardianOnly ? 'No Guardian checkpoints found' : 'No commits found',
                vscode.TreeItemCollapsibleState.None,
                { iconPath: new vscode.ThemeIcon('info') }
            )];
        }

        return commits.map(commit => {
            const isGuardian = commit.message.includes('[Vibe Guardian]');
            const shortMsg = commit.message.length > 50
                ? commit.message.substring(0, 47) + '...'
                : commit.message;

            const relativeDate = this.getRelativeDate(commit.date);
            const refBadges = commit.refs
                ? commit.refs.split(',').map(r => r.trim()).filter(r => r).join(', ')
                : '';

            const tooltip = new vscode.MarkdownString();
            tooltip.appendMarkdown(`**${commit.abbreviatedHash}** ${commit.message}\n\n`);
            tooltip.appendMarkdown(`Author: ${commit.authorName}\n\n`);
            tooltip.appendMarkdown(`Date: ${new Date(commit.date).toLocaleString()}\n\n`);
            if (refBadges) {
                tooltip.appendMarkdown(`Refs: ${refBadges}\n\n`);
            }
            tooltip.appendMarkdown(`_Click to expand files, double-click to open in Git Graph_`);

            return new GitGraphTreeItem(
                shortMsg,
                vscode.TreeItemCollapsibleState.Collapsed,
                {
                    commitHash: commit.hash,
                    description: `${commit.abbreviatedHash} - ${commit.authorName} - ${relativeDate}`,
                    tooltip,
                    contextValue: 'graph-commit',
                    iconPath: new vscode.ThemeIcon(
                        isGuardian ? 'save' : 'git-commit',
                        isGuardian
                            ? new vscode.ThemeColor('charts.green')
                            : new vscode.ThemeColor('charts.foreground')
                    ),
                    command: {
                        command: 'vibeCodeGuardian.gitGraphCommitDetail',
                        title: 'Show in Git Graph',
                        arguments: [{ commitHash: commit.hash }]
                    }
                }
            );
        });
    }

    private async getCommitFiles(commitHash: string): Promise<GitGraphTreeItem[]> {
        const files = await this.gitManager.getCommitFileChanges(commitHash);

        if (files.length === 0) {
            return [new GitGraphTreeItem(
                'No file changes',
                vscode.TreeItemCollapsibleState.None,
                { iconPath: new vscode.ThemeIcon('info') }
            )];
        }

        return files.map(file => {
            const fileName = file.path.split('/').pop() || file.path;
            const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';

            let statusIcon: string;
            let statusColor: string;
            switch (file.status) {
                case 'added': statusIcon = 'diff-added'; statusColor = 'gitDecoration.addedResourceForeground'; break;
                case 'deleted': statusIcon = 'diff-removed'; statusColor = 'gitDecoration.deletedResourceForeground'; break;
                case 'renamed': statusIcon = 'diff-renamed'; statusColor = 'gitDecoration.renamedResourceForeground'; break;
                default: statusIcon = 'diff-modified'; statusColor = 'gitDecoration.modifiedResourceForeground'; break;
            }

            const stats = file.binary
                ? 'binary'
                : `+${file.insertions} -${file.deletions}`;

            return new GitGraphTreeItem(
                fileName,
                vscode.TreeItemCollapsibleState.None,
                {
                    commitHash,
                    filePath: file.path,
                    description: `${dir ? dir + '/' : ''}  ${stats}`,
                    contextValue: 'graph-file',
                    iconPath: new vscode.ThemeIcon(statusIcon, new vscode.ThemeColor(statusColor)),
                    command: {
                        command: 'vibeCodeGuardian.showGitGraphFileDiff',
                        title: 'Show Diff',
                        arguments: [commitHash, file.path]
                    }
                }
            );
        });
    }

    private getRelativeDate(dateStr: string): string {
        const now = Date.now();
        const date = new Date(dateStr).getTime();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) { return 'just now'; }
        if (minutes < 60) { return `${minutes}m ago`; }
        if (hours < 24) { return `${hours}h ago`; }
        if (days < 30) { return `${days}d ago`; }
        return new Date(dateStr).toLocaleDateString();
    }
}
