/**
 * Vibe Code Guardian - Timeline Tree View
 * Game-like save slot view for checkpoints, grouped by intent-driven milestones
 */

import * as vscode from 'vscode';
import { Checkpoint, CheckpointType, CheckpointSource, CodingSession, Milestone, MilestoneStatus, PromptGroup } from './types';
import { CheckpointManager } from './checkpointManager';

export class TimelineTreeProvider implements vscode.TreeDataProvider<TimelineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TimelineItem | undefined | null | void> = 
        new vscode.EventEmitter<TimelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TimelineItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private checkpointManager: CheckpointManager;
    private viewMode: 'all' | 'session' | 'starred' | 'milestone' = 'milestone';

    constructor(checkpointManager: CheckpointManager) {
        this.checkpointManager = checkpointManager;

        // Listen for changes
        this.checkpointManager.onCheckpointCreated(() => this.refresh());
        this.checkpointManager.onCheckpointDeleted(() => this.refresh());
        this.checkpointManager.onSessionChanged(() => this.refresh());
        this.checkpointManager.onMilestoneChanged(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setViewMode(mode: 'all' | 'session' | 'starred' | 'milestone'): void {
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

        if (element.contextValue === 'milestone' || element.contextValue === 'milestone-active') {
            // Show checkpoints under this milestone, grouped by PromptGroup
            const milestoneId = element.milestoneId!;
            return Promise.resolve(this.getMilestoneChildren(milestoneId));
        }

        if (element.contextValue === 'prompt-group') {
            // Show checkpoints under this PromptGroup
            const promptGroupId = element.promptGroupId!;
            const checkpoints = this.checkpointManager.getPromptGroupCheckpoints(promptGroupId);
            return Promise.resolve(checkpoints.map(cp => this.createCheckpointItem(cp)));
        }

        if (element.contextValue === 'session') {
            // Show checkpoints in this session
            const checkpoints = this.checkpointManager.getCheckpoints()
                .filter(cp => cp.sessionId === element.sessionId)
                .sort((a, b) => b.timestamp - a.timestamp);
            return Promise.resolve(checkpoints.map(cp => this.createCheckpointItem(cp)));
        }

        if (element.contextValue === 'orphan-group') {
            // Show all untracked checkpoints sorted newest-first
            const orphaned = this.checkpointManager.getCheckpoints()
                .filter(cp => !cp.milestoneId)
                .sort((a, b) => b.timestamp - a.timestamp);
            return Promise.resolve(orphaned.map(cp => this.createCheckpointItem(cp)));
        }

        if (element.contextValue === 'date-group') {
            // Show checkpoints for this specific date
            const dateKey = element.dateKey;
            if (!dateKey) { return Promise.resolve([]); }
            const filtered = this.checkpointManager.getCheckpoints()
                .filter(cp => new Date(cp.timestamp).toLocaleDateString('zh-CN') === dateKey)
                .sort((a, b) => b.timestamp - a.timestamp);
            return Promise.resolve(filtered.map(cp => this.createCheckpointItem(cp)));
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
            case 'milestone': {
                // Show active milestone first, then completed/abandoned
                const activeMilestone = this.checkpointManager.getActiveMilestone();
                if (activeMilestone) {
                    items.push(this.createMilestoneItem(activeMilestone, true));
                }

                const otherMilestones = this.checkpointManager.getMilestones()
                    .filter(m => m.id !== activeMilestone?.id)
                    .slice(0, 10);
                otherMilestones.forEach(m => items.push(this.createMilestoneItem(m, false)));

                // Orphan checkpoints (not in any milestone)
                const orphaned = this.checkpointManager.getCheckpoints()
                    .filter(cp => !cp.milestoneId);
                if (orphaned.length > 0) {
                    const group = this.createOrphanGroup(orphaned);
                    items.push(group);
                }
                break;
            }

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
            const placeholder = new TimelineItem(
                '📭 No milestones yet',
                'Click to start a milestone',
                vscode.TreeItemCollapsibleState.None
            );
            placeholder.command = {
                command: 'vibeCodeGuardian.startMilestone',
                title: 'Start Milestone'
            };
            placeholder.iconPath = new vscode.ThemeIcon('add');
            items.push(placeholder);
        }

        return items;
    }

    private createMilestoneItem(milestone: Milestone, expanded: boolean): TimelineItem {
        const statusIcon =
            milestone.status === MilestoneStatus.Active ? '🟢' :
            milestone.status === MilestoneStatus.Completed ? '✅' : '🚫';

        const label = `${statusIcon} ${milestone.name}`;
        const cpCount = milestone.checkpointIds.length;
        const fileCount = milestone.changedFiles.length;
        const description = `${cpCount} saves · ${fileCount} files`;

        const hasCheckpoints = cpCount > 0;
        const item = new TimelineItem(
            label,
            description,
            hasCheckpoints ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
        );

        item.contextValue = milestone.status === MilestoneStatus.Active ? 'milestone-active' : 'milestone';
        item.milestoneId = milestone.id;
        item.iconPath = new vscode.ThemeIcon(
            milestone.status === MilestoneStatus.Active ? 'target' :
            milestone.status === MilestoneStatus.Completed ? 'pass-filled' : 'circle-slash',
            milestone.status === MilestoneStatus.Active ? new vscode.ThemeColor('charts.green') : undefined
        );
        item.tooltip = this.createMilestoneTooltip(milestone);
        item.command = {
            command: 'vibeCodeGuardian.showMilestoneDetails',
            title: 'Show Milestone Details',
            arguments: [milestone.id]
        };

        return item;
    }

    /**
     * Build the children list for a Milestone node.
     * Layout:
     *   - PromptGroups with ≥2 checkpoints → collapsible group item
     *   - PromptGroups with exactly 1 checkpoint → inline checkpoint item (no extra nesting)
     *   - Checkpoints without a promptGroupId → shown directly
     */
    private getMilestoneChildren(milestoneId: string): TimelineItem[] {
        const allCheckpoints = this.checkpointManager.getMilestoneCheckpoints(milestoneId);
        const promptGroups = this.checkpointManager.getMilestonePromptGroups(milestoneId);

        // Build a set of checkpoint IDs that are covered by multi-checkpoint groups
        const coveredByGroup = new Set<string>();
        const multiGroups = promptGroups.filter(g => g.checkpointIds.length > 1);
        for (const g of multiGroups) {
            for (const cpId of g.checkpointIds) {
                coveredByGroup.add(cpId);
            }
        }

        const items: TimelineItem[] = [];

        // Track which groups + ungrouped checkpoints have been emitted so we preserve
        // chronological order (newest first, matching getSessionCheckpoints sort order).
        const addedGroupIds = new Set<string>();
        const allCheckpointsSorted = [...allCheckpoints].sort((a, b) => b.timestamp - a.timestamp);

        for (const cp of allCheckpointsSorted) {
            if (cp.promptGroupId) {
                const group = promptGroups.find(g => g.id === cp.promptGroupId);
                if (group && group.checkpointIds.length > 1) {
                    // Multi-checkpoint group: emit the group header once
                    if (!addedGroupIds.has(group.id)) {
                        items.push(this.createPromptGroupItem(group));
                        addedGroupIds.add(group.id);
                    }
                    // The checkpoint itself is shown when the group is expanded (via getChildren)
                    continue;
                }
            }
            // Single-checkpoint group or ungrouped: show the checkpoint directly
            items.push(this.createCheckpointItem(cp));
        }

        return items;
    }

    /** Build a tree item for a PromptGroup */
    private createPromptGroupItem(group: PromptGroup): TimelineItem {
        const sourceIcon = this.getSourceEmoji(group.source);
        const cpCount = group.checkpointIds.length;
        const fileCount = group.changedFiles.length;
        const timeRange = this.formatGroupTimeRange(group);

        const label = `${sourceIcon} ${group.name}`;
        const description = `${cpCount} saves · ${fileCount} files · ${timeRange}`;

        const item = new TimelineItem(
            label,
            description,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = 'prompt-group';
        item.promptGroupId = group.id;
        item.iconPath = new vscode.ThemeIcon('repo-forked', this.getSourceColor(group.source));
        item.tooltip = this.createPromptGroupTooltip(group);
        return item;
    }

    private createPromptGroupTooltip(group: PromptGroup): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`### ${this.getSourceEmoji(group.source)} ${group.name}\n\n`);
        if (group.prompt) {
            md.appendMarkdown(`**Prompt:** ${group.prompt}\n\n`);
        }
        md.appendMarkdown(`**Source:** ${group.source}\n\n`);
        md.appendMarkdown(`**Started:** ${new Date(group.createdAt).toLocaleString('zh-CN')}\n\n`);
        md.appendMarkdown(`**Last update:** ${new Date(group.lastUpdatedAt).toLocaleString('zh-CN')}\n\n`);
        md.appendMarkdown(`**Checkpoints:** ${group.checkpointIds.length}\n\n`);
        if (group.changedFiles.length > 0) {
            md.appendMarkdown(`**Changed files:**\n`);
            for (const f of group.changedFiles.slice(0, 8)) {
                const name = f.path.split('/').pop();
                md.appendMarkdown(`- ${name} (+${f.linesAdded}/-${f.linesRemoved})\n`);
            }
            if (group.changedFiles.length > 8) {
                md.appendMarkdown(`- … and ${group.changedFiles.length - 8} more\n`);
            }
        }
        return md;
    }

    private getSourceEmoji(source: CheckpointSource): string {
        const map: Partial<Record<CheckpointSource, string>> = {
            [CheckpointSource.Copilot]: '🤖',
            [CheckpointSource.Claude]: '🟠',
            [CheckpointSource.Cline]: '🟣',
            [CheckpointSource.OtherAI]: '✨',
            [CheckpointSource.User]: '👤',
            [CheckpointSource.AutoSave]: '⏰',
        };
        return map[source] ?? '📦';
    }

    private getSourceColor(source: CheckpointSource): vscode.ThemeColor | undefined {
        const map: Partial<Record<CheckpointSource, string>> = {
            [CheckpointSource.Copilot]: 'charts.blue',
            [CheckpointSource.Claude]: 'charts.orange',
            [CheckpointSource.Cline]: 'charts.purple',
            [CheckpointSource.OtherAI]: 'charts.green',
        };
        const colorId = map[source];
        return colorId ? new vscode.ThemeColor(colorId) : undefined;
    }

    private formatGroupTimeRange(group: PromptGroup): string {
        const start = new Date(group.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        if (group.createdAt === group.lastUpdatedAt) {
            return start;
        }
        const end = new Date(group.lastUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `${start} – ${end}`;
    }

    private createOrphanGroup(orphaned: Checkpoint[]): TimelineItem {
        const sorted = [...orphaned].sort((a, b) => b.timestamp - a.timestamp);
        const count = sorted.length;
        const lastSave = sorted.length > 0 ? this.relativeTime(sorted[0].timestamp) : '';
        const totalFiles = sorted.reduce((s, cp) => s + cp.changedFiles.length, 0);
        const fileStr = totalFiles > 0 ? ` · ${totalFiles} files` : '';
        const lastStr = lastSave ? ` · last ${lastSave}` : '';

        const item = new TimelineItem(
            '📋 Untracked',
            `${count} saves${fileStr}${lastStr}`,
            count <= 10
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = 'orphan-group';
        item.iconPath = new vscode.ThemeIcon('history');
        return item;
    }

    private createMilestoneTooltip(milestone: Milestone): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`### 🎯 ${milestone.name}\n\n`);
        md.appendMarkdown(`**Intent (WHY):** ${milestone.intent}\n\n`);
        if (milestone.description) {
            md.appendMarkdown(`**Context:** ${milestone.description}\n\n`);
        }
        md.appendMarkdown(`**Status:** ${milestone.status}\n\n`);
        md.appendMarkdown(`**Created:** ${new Date(milestone.createdAt).toLocaleString()}\n\n`);
        if (milestone.closedAt) {
            md.appendMarkdown(`**Closed:** ${new Date(milestone.closedAt).toLocaleString()}\n\n`);
        }
        if (milestone.changedFiles.length > 0) {
            md.appendMarkdown(`**Changed Files:**\n`);
            for (const file of milestone.changedFiles.slice(0, 8)) {
                const fileName = file.path.split('/').pop();
                md.appendMarkdown(`- ${fileName}\n`);
            }
            if (milestone.changedFiles.length > 8) {
                md.appendMarkdown(`- … and ${milestone.changedFiles.length - 8} more\n`);
            }
        }
        if (milestone.gitCommitHash) {
            md.appendMarkdown(`\n**Git Commit:** \`${milestone.gitCommitHash.substring(0, 8)}\`\n`);
        }
        md.appendMarkdown(`\n---\n*Right-click to rollback, complete, or abandon*`);
        return md;
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
        const sourceEmoji = this.getSourceEmoji(checkpoint.source);
        const relTime = this.relativeTime(checkpoint.timestamp);
        const filesCount = checkpoint.changedFiles.length;

        // Aggregate lines changed across all changed files
        const linesAdded   = checkpoint.changedFiles.reduce((s, f) => s + (f.linesAdded   ?? 0), 0);
        const linesRemoved = checkpoint.changedFiles.reduce((s, f) => s + (f.linesRemoved ?? 0), 0);
        const linesStr = (linesAdded > 0 || linesRemoved > 0)
            ? ` +${linesAdded}/-${linesRemoved}`
            : '';
        const filesStr = filesCount > 0 ? `${filesCount}f${linesStr}` : 'snapshot';

        const description = `${relTime} · ${filesStr}`;
        // Prefix label with source emoji so the icon column carries type and label shows origin
        const label = `${sourceEmoji} ${checkpoint.name}`;

        const hasFiles = filesCount > 0;
        const item = new TimelineItem(
            label,
            description,
            hasFiles ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        item.contextValue = checkpoint.starred ? 'checkpoint-starred' : 'checkpoint';
        item.checkpointId = checkpoint.id;
        item.iconPath = this.getCheckpointIcon(checkpoint);
        item.tooltip = this.createTooltip(checkpoint);
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
        const todayStr     = new Date().toLocaleDateString('zh-CN');
        const yesterdayStr = new Date(Date.now() - 86_400_000).toLocaleDateString('zh-CN');
        const displayDate  = date === todayStr ? '今日' : date === yesterdayStr ? '昨日' : date;

        const item = new TimelineItem(
            `📅 ${displayDate}`,
            `${count} checkpoints`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = 'date-group';
        item.dateKey = date;
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

    private relativeTime(timestamp: number): string {
        const ms  = Date.now() - timestamp;
        const s   = Math.floor(ms / 1000);
        const m   = Math.floor(s / 60);
        const h   = Math.floor(m / 60);
        const d   = Math.floor(h / 24);
        if (d > 0) { return `${d}d ago`; }
        if (h > 0) { return `${h}h ago`; }
        if (m > 0) { return `${m}m ago`; }
        return 'just now';
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
    public milestoneId?: string;
    public promptGroupId?: string;
    public dateKey?: string;
    
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.description = description;
    }
}
