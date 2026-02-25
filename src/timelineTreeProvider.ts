/**
 * Vibe Code Guardian - Timeline Tree View
 * Game-like save slot view for checkpoints
 */

import * as vscode from 'vscode';
import { Checkpoint, CheckpointType, CheckpointSource, CodingSession } from './types';
import { CheckpointManager } from './checkpointManager';

export class TimelineTreeProvider implements vscode.TreeDataProvider<TimelineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TimelineItem | undefined | null | void> = 
        new vscode.EventEmitter<TimelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TimelineItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private checkpointManager: CheckpointManager;
    private viewMode: 'all' | 'session' | 'starred' = 'session';

    constructor(checkpointManager: CheckpointManager) {
        this.checkpointManager = checkpointManager;

        // Listen for changes
        this.checkpointManager.onCheckpointCreated(() => this.refresh());
        this.checkpointManager.onCheckpointDeleted(() => this.refresh());
        this.checkpointManager.onSessionChanged(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setViewMode(mode: 'all' | 'session' | 'starred'): void {
        this.viewMode = mode;
        this.refresh();
    }

    getTreeItem(element: TimelineItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TimelineItem): Thenable<TimelineItem[]> {
        if (!element) {
            // Root level - show sessions or checkpoints based on view mode
            return Promise.resolve(this.getRootItems());
        }

        if (element.contextValue === 'session') {
            // Show checkpoints in this session
            const checkpoints = this.checkpointManager.getCheckpoints()
                .filter(cp => cp.sessionId === element.sessionId);
            return Promise.resolve(checkpoints.map(cp => this.createCheckpointItem(cp)));
        }

        if (element.contextValue === 'checkpoint') {
            // Show changed files
            const checkpoint = this.checkpointManager.getCheckpoint(element.checkpointId!);
            if (checkpoint && checkpoint.changedFiles.length > 0) {
                return Promise.resolve(
                    checkpoint.changedFiles.map(f => this.createFileItem(f.path, checkpoint.id))
                );
            }
        }

        return Promise.resolve([]);
    }

    private getRootItems(): TimelineItem[] {
        const items: TimelineItem[] = [];

        switch (this.viewMode) {
            case 'session': {
                // Show current session checkpoints at root
                const session = this.checkpointManager.getActiveSession();
                if (session) {
                    const sessionItem = this.createSessionItem(session, true);
                    items.push(sessionItem);
                }
                
                // Add previous sessions collapsed
                const sessions = this.checkpointManager.getSessions()
                    .filter(s => !s.isActive)
                    .slice(0, 5);
                sessions.forEach(s => items.push(this.createSessionItem(s, false)));
                break;
            }

            case 'starred': {
                const starred = this.checkpointManager.getCheckpoints()
                    .filter(cp => cp.starred);
                starred.forEach(cp => items.push(this.createCheckpointItem(cp)));
                break;
            }

            case 'all':
            default: {
                // Group by date
                const checkpoints = this.checkpointManager.getCheckpoints();
                const byDate = this.groupByDate(checkpoints);
                
                for (const [date, cps] of Object.entries(byDate)) {
                    items.push(this.createDateGroup(date, cps.length));
                }
                break;
            }
        }

        // Add "No checkpoints" message if empty
        if (items.length === 0) {
            items.push(new TimelineItem(
                '📭 No checkpoints yet',
                'Press Ctrl+Shift+S to save your first checkpoint',
                vscode.TreeItemCollapsibleState.None
            ));
        }

        return items;
    }

    private createSessionItem(session: CodingSession, expanded: boolean): TimelineItem {
        const duration = session.endTime 
            ? this.formatDuration(session.endTime - session.startTime)
            : this.formatDuration(Date.now() - session.startTime);

        const status = session.isActive ? '🟢 Active' : '⚪ Ended';
        const label = `${session.name}`;
        const description = `${status} • ${session.checkpointIds.length} saves • ${duration}`;

        const item = new TimelineItem(
            label,
            description,
            expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = 'session';
        item.sessionId = session.id;
        item.iconPath = new vscode.ThemeIcon(
            session.isActive ? 'game' : 'history',
            session.isActive ? new vscode.ThemeColor('charts.green') : undefined
        );
        return item;
    }

    private createCheckpointItem(checkpoint: Checkpoint): TimelineItem {
        const time = new Date(checkpoint.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const filesCount = checkpoint.changedFiles.length;
        const filesLabel = filesCount > 0 ? `${filesCount} files` : 'snapshot';
        
        const description = `${time} • ${filesLabel}`;
        
        const hasFiles = checkpoint.changedFiles.length > 0;
        const item = new TimelineItem(
            checkpoint.name,
            description,
            hasFiles ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        item.contextValue = checkpoint.starred ? 'checkpoint-starred' : 'checkpoint';
        item.checkpointId = checkpoint.id;
        item.iconPath = this.getCheckpointIcon(checkpoint);
        
        // Add tooltip
        item.tooltip = this.createTooltip(checkpoint);

        // Command to show details
        item.command = {
            command: 'vibeCodeGuardian.showCheckpointDetails',
            title: 'Show Details',
            arguments: [checkpoint.id]
        };

        return item;
    }

    private createFileItem(filePath: string, checkpointId: string): TimelineItem {
        const fileName = filePath.split('/').pop() || filePath;
        const item = new TimelineItem(
            fileName,
            filePath,
            vscode.TreeItemCollapsibleState.None
        );
        item.contextValue = 'changed-file';
        item.checkpointId = checkpointId;
        item.resourceUri = vscode.Uri.file(filePath);
        item.iconPath = vscode.ThemeIcon.File;
        // Click to open the file directly in editor
        item.command = {
            command: 'vibeCodeGuardian.openChangedFile',
            title: 'Open File',
            arguments: [checkpointId, filePath]
        };
        return item;
    }

    private createDateGroup(date: string, count: number): TimelineItem {
        const item = new TimelineItem(
            `📅 ${date}`,
            `${count} checkpoints`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = 'date-group';
        return item;
    }

    private getCheckpointIcon(checkpoint: Checkpoint): vscode.ThemeIcon {
        if (checkpoint.starred) {
            return new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        }

        const icons: Record<CheckpointType, string> = {
            [CheckpointType.Manual]: 'save',
            [CheckpointType.AIGenerated]: 'sparkle',
            [CheckpointType.Auto]: 'sync',
            [CheckpointType.SessionStart]: 'play',
            [CheckpointType.AutoSave]: 'clock'
        };

        const colors: Partial<Record<CheckpointSource, string>> = {
            [CheckpointSource.Copilot]: 'charts.blue',
            [CheckpointSource.Claude]: 'charts.orange',
            [CheckpointSource.Cline]: 'charts.purple'
        };

        const icon = icons[checkpoint.type] || 'circle-filled';
        const color = colors[checkpoint.source];

        return new vscode.ThemeIcon(
            icon,
            color ? new vscode.ThemeColor(color) : undefined
        );
    }

    private createTooltip(checkpoint: Checkpoint): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`### ${checkpoint.name}\n\n`);
        
        const time = new Date(checkpoint.timestamp).toLocaleString('zh-CN');
        md.appendMarkdown(`**Time:** ${time}\n\n`);
        md.appendMarkdown(`**Type:** ${checkpoint.type}\n\n`);
        md.appendMarkdown(`**Source:** ${checkpoint.source}\n\n`);
        
        if (checkpoint.description) {
            md.appendMarkdown(`**Description:** ${checkpoint.description}\n\n`);
        }
        
        if (checkpoint.gitCommitHash) {
            md.appendMarkdown(`**Git Commit:** \`${checkpoint.gitCommitHash.substring(0, 8)}\`\n\n`);
        }
        
        if (checkpoint.changedFiles.length > 0) {
            md.appendMarkdown(`**Changed Files:**\n`);
            for (const file of checkpoint.changedFiles.slice(0, 5)) {
                const fileName = file.path.split('/').pop();
                md.appendMarkdown(`- ${fileName} (+${file.linesAdded}/-${file.linesRemoved})\n`);
            }
            if (checkpoint.changedFiles.length > 5) {
                md.appendMarkdown(`- ... and ${checkpoint.changedFiles.length - 5} more\n`);
            }
        }
        
        md.appendMarkdown(`\n---\n`);
        md.appendMarkdown(`*Click to view details, right-click for actions*`);
        
        return md;
    }

    private groupByDate(checkpoints: Checkpoint[]): Record<string, Checkpoint[]> {
        const groups: Record<string, Checkpoint[]> = {};
        
        for (const cp of checkpoints) {
            const date = new Date(cp.timestamp).toLocaleDateString('zh-CN');
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(cp);
        }
        
        return groups;
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return `${seconds}s`;
        }
    }
}

export class TimelineItem extends vscode.TreeItem {
    public sessionId?: string;
    public checkpointId?: string;
    
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.description = description;
    }
}
