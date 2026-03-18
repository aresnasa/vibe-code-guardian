/**
 * Vibe Code Guardian - Milestone Manager
 * Groups code changes by developer intent so that both humans and AI agents
 * can understand WHY a set of changes was made.
 *
 * Flow:
 *   1. Developer (or AI) starts a milestone with a name + intent description
 *   2. All checkpoints created while a milestone is active are linked to it
 *   3. When the work is done the developer completes the milestone, which:
 *      - Aggregates changed files from all linked checkpoints
 *      - (optionally) Creates a single Git commit with the intent as message
 *      - Marks the milestone as completed
 *   4. Milestones can also be abandoned (reverts all linked checkpoints)
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
    Milestone,
    MilestoneStatus,
    Checkpoint,
    CheckpointSource,
    ChangedFile,
    FileChangeType
} from './types';
import { GitManager } from './gitManager';

export class MilestoneManager {
    private _onMilestoneCreated = new vscode.EventEmitter<Milestone>();
    private _onMilestoneCompleted = new vscode.EventEmitter<Milestone>();
    private _onMilestoneAbandoned = new vscode.EventEmitter<Milestone>();
    private _onMilestoneChanged = new vscode.EventEmitter<Milestone>();

    public readonly onMilestoneCreated = this._onMilestoneCreated.event;
    public readonly onMilestoneCompleted = this._onMilestoneCompleted.event;
    public readonly onMilestoneAbandoned = this._onMilestoneAbandoned.event;
    public readonly onMilestoneChanged = this._onMilestoneChanged.event;

    private gitManager: GitManager;

    constructor(gitManager: GitManager) {
        this.gitManager = gitManager;
    }

    // ------------------------------------------------------------------
    // Storage helpers (delegate to the calling CheckpointManager)
    // ------------------------------------------------------------------

    /**
     * Create a new milestone
     */
    public createMilestone(
        name: string,
        intent: string,
        sessionId: string,
        options?: {
            description?: string;
            source?: CheckpointSource;
            tags?: string[];
            parentMilestoneId?: string;
        }
    ): Milestone {
        const milestone: Milestone = {
            id: crypto.randomBytes(8).toString('hex'),
            name,
            intent,
            description: options?.description,
            createdAt: Date.now(),
            status: MilestoneStatus.Active,
            checkpointIds: [],
            changedFiles: [],
            source: options?.source ?? CheckpointSource.User,
            sessionId,
            tags: options?.tags ?? [],
            parentMilestoneId: options?.parentMilestoneId
        };

        this._onMilestoneCreated.fire(milestone);
        return milestone;
    }

    /**
     * Link a checkpoint to a milestone
     */
    public linkCheckpoint(milestone: Milestone, checkpoint: Checkpoint): void {
        if (!milestone.checkpointIds.includes(checkpoint.id)) {
            milestone.checkpointIds.push(checkpoint.id);
        }
        // Merge changed files without duplicates
        this.mergeChangedFiles(milestone, checkpoint.changedFiles);
        this._onMilestoneChanged.fire(milestone);
    }

    /**
     * Complete a milestone — optionally create a squashed Git commit
     */
    public async completeMilestone(
        milestone: Milestone,
        linkedCheckpoints: Checkpoint[],
        options?: { createGitCommit?: boolean; commitMessage?: string }
    ): Promise<{ gitCommitHash?: string }> {
        milestone.status = MilestoneStatus.Completed;
        milestone.closedAt = Date.now();

        // Aggregate all changed files from linked checkpoints
        milestone.changedFiles = this.aggregateChangedFiles(linkedCheckpoints);

        let gitCommitHash: string | undefined;

        if (options?.createGitCommit && await this.gitManager.isGitRepository()) {
            const message = options.commitMessage ??
                `[Milestone] ${milestone.name}\n\nIntent: ${milestone.intent}`;
            const result = await this.gitManager.stageAndCommitAll(message);
            if (result.success && result.commitHash) {
                gitCommitHash = result.commitHash;
                milestone.gitCommitHash = gitCommitHash;
            }
        }

        this._onMilestoneCompleted.fire(milestone);
        return { gitCommitHash };
    }

    /**
     * Abandon a milestone — mark it but do NOT delete the linked checkpoints
     * (the user can rollback individually if they want)
     */
    public abandonMilestone(milestone: Milestone): void {
        milestone.status = MilestoneStatus.Abandoned;
        milestone.closedAt = Date.now();
        this._onMilestoneAbandoned.fire(milestone);
    }

    /**
     * Update milestone metadata
     */
    public updateMilestone(
        milestone: Milestone,
        updates: { name?: string; intent?: string; description?: string; tags?: string[] }
    ): void {
        if (updates.name !== undefined) { milestone.name = updates.name; }
        if (updates.intent !== undefined) { milestone.intent = updates.intent; }
        if (updates.description !== undefined) { milestone.description = updates.description; }
        if (updates.tags !== undefined) { milestone.tags = updates.tags; }
        this._onMilestoneChanged.fire(milestone);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /**
     * Aggregate changed files from checkpoint list, deduplicating by path
     * and preferring the latest version
     */
    private aggregateChangedFiles(checkpoints: Checkpoint[]): ChangedFile[] {
        const fileMap = new Map<string, ChangedFile>();

        // Process checkpoints in chronological order
        const sorted = [...checkpoints].sort((a, b) => a.timestamp - b.timestamp);
        for (const cp of sorted) {
            for (const file of cp.changedFiles) {
                const existing = fileMap.get(file.path);
                if (existing) {
                    // Accumulate line counts, keep latest content
                    existing.linesAdded += file.linesAdded;
                    existing.linesRemoved += file.linesRemoved;
                    if (file.currentContent !== undefined) {
                        existing.currentContent = file.currentContent;
                    }
                    // If file was added then later deleted, mark as deleted
                    if (file.changeType === FileChangeType.Deleted) {
                        existing.changeType = FileChangeType.Deleted;
                    }
                } else {
                    fileMap.set(file.path, { ...file });
                }
            }
        }

        return Array.from(fileMap.values());
    }

    /**
     * Merge changed files into milestone without duplicates
     */
    private mergeChangedFiles(milestone: Milestone, files: ChangedFile[]): void {
        for (const file of files) {
            const existing = milestone.changedFiles.find(f => f.path === file.path);
            if (existing) {
                existing.linesAdded += file.linesAdded;
                existing.linesRemoved += file.linesRemoved;
                if (file.currentContent !== undefined) {
                    existing.currentContent = file.currentContent;
                }
            } else {
                milestone.changedFiles.push({ ...file });
            }
        }
    }

    public dispose(): void {
        this._onMilestoneCreated.dispose();
        this._onMilestoneCompleted.dispose();
        this._onMilestoneAbandoned.dispose();
        this._onMilestoneChanged.dispose();
    }
}
