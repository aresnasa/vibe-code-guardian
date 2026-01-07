/**
 * Vibe Code Guardian - Checkpoint Manager
 * Core logic for creating, managing, and organizing checkpoints
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
    Checkpoint,
    CheckpointType,
    CheckpointSource,
    CodingSession,
    CheckpointStorageData,
    GuardianSettings,
    ChangedFile,
    FileChangeType,
    DEFAULT_SETTINGS
} from './types';
import { GitManager } from './gitManager';

export class CheckpointManager {
    private context: vscode.ExtensionContext;
    private gitManager: GitManager;
    private storageData: CheckpointStorageData;
    private _onCheckpointCreated: vscode.EventEmitter<Checkpoint> = new vscode.EventEmitter<Checkpoint>();
    private _onCheckpointDeleted: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private _onSessionChanged: vscode.EventEmitter<CodingSession | undefined> = new vscode.EventEmitter<CodingSession | undefined>();

    public readonly onCheckpointCreated: vscode.Event<Checkpoint> = this._onCheckpointCreated.event;
    public readonly onCheckpointDeleted: vscode.Event<string> = this._onCheckpointDeleted.event;
    public readonly onSessionChanged: vscode.Event<CodingSession | undefined> = this._onSessionChanged.event;

    constructor(context: vscode.ExtensionContext, gitManager: GitManager) {
        this.context = context;
        this.gitManager = gitManager;
        this.storageData = this.loadStorageData();
    }

    /**
     * Load storage data from workspace state
     */
    private loadStorageData(): CheckpointStorageData {
        const data = this.context.workspaceState.get<CheckpointStorageData>('vibeCodeGuardian.data');
        if (data && data.version === 1) {
            return data;
        }
        return {
            version: 1,
            checkpoints: [],
            sessions: [],
            activeSessionId: undefined,
            settings: DEFAULT_SETTINGS
        };
    }

    /**
     * Save storage data to workspace state
     */
    private async saveStorageData(): Promise<void> {
        await this.context.workspaceState.update('vibeCodeGuardian.data', this.storageData);
    }

    /**
     * Generate a unique ID
     */
    private generateId(): string {
        return crypto.randomBytes(8).toString('hex');
    }

    /**
     * Generate checkpoint name based on pattern
     */
    private generateCheckpointName(type: CheckpointType, source: CheckpointSource): string {
        const now = new Date();
        const timestamp = now.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(/\//g, '-');

        const typeEmoji: Record<CheckpointType, string> = {
            [CheckpointType.Auto]: '🔄',
            [CheckpointType.Manual]: '💾',
            [CheckpointType.AIGenerated]: '🤖',
            [CheckpointType.SessionStart]: '🎮',
            [CheckpointType.AutoSave]: '⏰'
        };

        const sourceLabel: Record<CheckpointSource, string> = {
            [CheckpointSource.User]: 'Manual',
            [CheckpointSource.Copilot]: 'Copilot',
            [CheckpointSource.Claude]: 'Claude',
            [CheckpointSource.Cline]: 'Cline',
            [CheckpointSource.OtherAI]: 'AI',
            [CheckpointSource.AutoSave]: 'AutoSave',
            [CheckpointSource.FileWatcher]: 'Watcher',
            [CheckpointSource.Unknown]: 'Unknown'
        };

        return `${typeEmoji[type]} ${sourceLabel[source]} @ ${timestamp}`;
    }

    /**
     * Get current settings
     */
    public getSettings(): GuardianSettings {
        return { ...this.storageData.settings };
    }

    /**
     * Update settings
     */
    public async updateSettings(settings: Partial<GuardianSettings>): Promise<void> {
        this.storageData.settings = { ...this.storageData.settings, ...settings };
        await this.saveStorageData();
    }

    /**
     * Get all checkpoints
     */
    public getCheckpoints(): Checkpoint[] {
        return [...this.storageData.checkpoints].sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Get checkpoint by ID
     */
    public getCheckpoint(id: string): Checkpoint | undefined {
        return this.storageData.checkpoints.find(cp => cp.id === id);
    }

    /**
     * Get checkpoints for current session
     */
    public getSessionCheckpoints(sessionId?: string): Checkpoint[] {
        const sid = sessionId || this.storageData.activeSessionId;
        if (!sid) {
            return [];
        }
        return this.storageData.checkpoints
            .filter(cp => cp.sessionId === sid)
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Create a new checkpoint
     */
    public async createCheckpoint(
        type: CheckpointType,
        source: CheckpointSource,
        changedFiles: ChangedFile[],
        options?: {
            name?: string;
            description?: string;
            tags?: string[];
        }
    ): Promise<Checkpoint> {
        // Ensure we have an active session
        if (!this.storageData.activeSessionId) {
            await this.startSession();
        }

        const id = this.generateId();
        const name = options?.name || this.generateCheckpointName(type, source);

        // Sync with Git: Get actual changed files from Git status
        let gitCommitHash: string | undefined;
        let actualChangedFiles = changedFiles;
        
        if (this.storageData.settings.enableGit && await this.gitManager.isGitRepository()) {
            try {
                // Use Git's actual changed files list for accuracy
                const gitChangedFiles = await this.gitManager.getDetailedChangedFiles();
                
                if (gitChangedFiles.length > 0) {
                    // Convert to ChangedFile format, filtering out files that don't exist
                    actualChangedFiles = await this.syncChangedFilesWithGit(changedFiles, gitChangedFiles);
                }

                // Stage all and commit
                const commitMessage = `[Vibe Guardian] ${name}`;
                const commitResult = await this.gitManager.stageAndCommitAll(commitMessage);
                
                if (commitResult.success && commitResult.commitHash) {
                    gitCommitHash = commitResult.commitHash;
                    
                    // Update changedFiles with actual committed files
                    if (commitResult.changedFiles.length > 0) {
                        actualChangedFiles = await this.convertToChangedFiles(commitResult.changedFiles);
                    }
                }
            } catch (error) {
                console.warn('Failed to sync with Git:', error);
            }
        }

        // Find parent checkpoint
        const sessionCheckpoints = this.getSessionCheckpoints();
        const parentId = sessionCheckpoints.length > 0 ? sessionCheckpoints[0].id : undefined;

        const checkpoint: Checkpoint = {
            id,
            name,
            description: options?.description,
            timestamp: Date.now(),
            gitCommitHash,
            type,
            source,
            changedFiles: actualChangedFiles,
            sessionId: this.storageData.activeSessionId!,
            parentId,
            tags: options?.tags || [],
            starred: false,
            branchName: this.getActiveSession()?.branchName
        };

        this.storageData.checkpoints.push(checkpoint);

        // Update session
        const session = this.getActiveSession();
        if (session) {
            session.checkpointIds.push(id);
            session.totalFilesChanged += actualChangedFiles.length;
            if (source !== CheckpointSource.User && source !== CheckpointSource.AutoSave && source !== CheckpointSource.FileWatcher) {
                if (!session.aiToolsUsed.includes(source)) {
                    session.aiToolsUsed.push(source);
                }
            }
        }

        // Enforce max checkpoints limit
        await this.enforceCheckpointLimit();

        await this.saveStorageData();
        this._onCheckpointCreated.fire(checkpoint);

        // Show notification if enabled
        if (this.storageData.settings.showNotifications) {
            vscode.window.showInformationMessage(
                `💾 Checkpoint saved: ${name}`,
                'View Timeline'
            ).then(selection => {
                if (selection === 'View Timeline') {
                    vscode.commands.executeCommand('vibeCodeGuardian.showTimeline');
                }
            });
        }

        return checkpoint;
    }

    /**
     * Sync changed files with Git status - ensures accuracy
     */
    private async syncChangedFilesWithGit(
        originalFiles: ChangedFile[],
        gitFiles: Array<{ path: string; changeType: 'added' | 'modified' | 'deleted' | 'renamed'; staged: boolean }>
    ): Promise<ChangedFile[]> {
        const result: ChangedFile[] = [];
        const gitFilePaths = new Set(gitFiles.map(f => f.path));

        // Add Git files that match original files or are new
        for (const gitFile of gitFiles) {
            const originalFile = originalFiles.find(f => f.path.endsWith(gitFile.path) || gitFile.path.endsWith(f.path));
            
            result.push({
                path: gitFile.path,
                changeType: this.mapChangeType(gitFile.changeType),
                linesAdded: originalFile?.linesAdded ?? 0,
                linesRemoved: originalFile?.linesRemoved ?? 0,
                previousContent: originalFile?.previousContent,
                currentContent: originalFile?.currentContent
            });
        }

        return result;
    }

    /**
     * Convert file paths to ChangedFile format
     */
    private async convertToChangedFiles(filePaths: string[]): Promise<ChangedFile[]> {
        return filePaths.map(filePath => ({
            path: filePath,
            changeType: FileChangeType.Modified,
            linesAdded: 0,
            linesRemoved: 0
        }));
    }

    /**
     * Map Git change type to FileChangeType
     */
    private mapChangeType(gitChangeType: 'added' | 'modified' | 'deleted' | 'renamed'): FileChangeType {
        switch (gitChangeType) {
            case 'added': return FileChangeType.Added;
            case 'deleted': return FileChangeType.Deleted;
            case 'renamed': return FileChangeType.Modified;
            default: return FileChangeType.Modified;
        }
    }

    /**
     * Delete a checkpoint
     */
    public async deleteCheckpoint(id: string): Promise<boolean> {
        const index = this.storageData.checkpoints.findIndex(cp => cp.id === id);
        if (index === -1) {
            return false;
        }

        const checkpoint = this.storageData.checkpoints[index];
        
        // Update child checkpoints to point to parent
        this.storageData.checkpoints.forEach(cp => {
            if (cp.parentId === id) {
                cp.parentId = checkpoint.parentId;
            }
        });

        // Remove from session
        const session = this.storageData.sessions.find(s => s.id === checkpoint.sessionId);
        if (session) {
            session.checkpointIds = session.checkpointIds.filter(cpId => cpId !== id);
        }

        this.storageData.checkpoints.splice(index, 1);
        await this.saveStorageData();
        this._onCheckpointDeleted.fire(id);

        return true;
    }

    /**
     * Toggle checkpoint starred status
     */
    public async toggleStarred(id: string): Promise<boolean> {
        const checkpoint = this.getCheckpoint(id);
        if (!checkpoint) {
            return false;
        }
        checkpoint.starred = !checkpoint.starred;
        await this.saveStorageData();
        return checkpoint.starred;
    }

    /**
     * Rename checkpoint
     */
    public async renameCheckpoint(id: string, newName: string): Promise<boolean> {
        const checkpoint = this.getCheckpoint(id);
        if (!checkpoint) {
            return false;
        }
        checkpoint.name = newName;
        await this.saveStorageData();
        return true;
    }

    /**
     * Enforce maximum checkpoint limit
     */
    private async enforceCheckpointLimit(): Promise<void> {
        const maxCheckpoints = this.storageData.settings.maxCheckpoints;
        if (this.storageData.checkpoints.length <= maxCheckpoints) {
            return;
        }

        // Sort by timestamp, keep starred ones
        const sortedCheckpoints = [...this.storageData.checkpoints]
            .sort((a, b) => a.timestamp - b.timestamp);

        const toDelete: string[] = [];
        for (const cp of sortedCheckpoints) {
            if (this.storageData.checkpoints.length - toDelete.length <= maxCheckpoints) {
                break;
            }
            if (!cp.starred) {
                toDelete.push(cp.id);
            }
        }

        for (const id of toDelete) {
            await this.deleteCheckpoint(id);
        }
    }

    /**
     * Validate checkpoint - check if git commit exists (files are secondary)
     * For rollback purposes, only the Git commit hash is essential
     */
    public async validateCheckpoint(checkpoint: Checkpoint): Promise<{
        valid: boolean;
        issues: string[];
        canRollback: boolean; // Can still rollback even if some files are inaccessible
    }> {
        const issues: string[] = [];
        let canRollback = true;

        // Check if git commit exists - this is the primary validation
        if (checkpoint.gitCommitHash) {
            const commitExists = await this.gitManager.commitExists(checkpoint.gitCommitHash);
            if (!commitExists) {
                issues.push(`Git commit ${checkpoint.gitCommitHash.substring(0, 7)} not found`);
                canRollback = false; // Cannot rollback without valid commit
            }
        } else {
            // No git commit - check if we have file content stored
            const hasStoredContent = checkpoint.changedFiles.some(f => f.previousContent !== undefined);
            if (!hasStoredContent) {
                issues.push('No Git commit and no stored file content');
                canRollback = false;
            }
        }

        // File accessibility is informational only - doesn't prevent rollback if we have git commit
        for (const file of checkpoint.changedFiles) {
            const fileExists = await this.checkFileAccessible(file.path, checkpoint.gitCommitHash);
            if (!fileExists) {
                issues.push(`File ${file.path} not in current state (ok for rollback)`);
            }
        }

        return {
            valid: issues.length === 0,
            issues,
            canRollback
        };
    }

    /**
     * Check if a file is accessible (exists in git or filesystem)
     */
    private async checkFileAccessible(filePath: string, commitHash?: string): Promise<boolean> {
        // Check filesystem first
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return true;
        } catch {
            // File not in filesystem, check git if we have a commit
        }

        // Check in git history
        if (commitHash) {
            const content = await this.gitManager.getFileAtCommit(filePath, commitHash);
            if (content !== undefined) {
                return true;
            }
        }

        return false;
    }

    /**
     * Cleanup invalid checkpoints - remove checkpoints with missing git commits or inaccessible files
     */
    public async cleanupInvalidCheckpoints(): Promise<{
        removed: number;
        details: string[];
    }> {
        const removed: string[] = [];
        const details: string[] = [];

        for (const checkpoint of [...this.storageData.checkpoints]) {
            const validation = await this.validateCheckpoint(checkpoint);
            if (!validation.valid) {
                details.push(`Removing "${checkpoint.name}": ${validation.issues.join(', ')}`);
                await this.deleteCheckpoint(checkpoint.id);
                removed.push(checkpoint.id);
            }
        }

        return {
            removed: removed.length,
            details
        };
    }

    /**
     * Sync checkpoints with Git - rebuild checkpoint list from git history
     */
    public async syncWithGit(): Promise<{
        synced: number;
        added: number;
        removed: number;
    }> {
        let added = 0;
        let removed = 0;

        // Get git commits that look like Vibe Guardian checkpoints
        const gitCommits = await this.gitManager.getVibeGuardianCommits();
        
        // Create a map of existing checkpoints by git hash
        const existingByHash = new Map<string, Checkpoint>();
        for (const cp of this.storageData.checkpoints) {
            if (cp.gitCommitHash) {
                existingByHash.set(cp.gitCommitHash, cp);
            }
        }

        // Add missing checkpoints from git
        for (const commit of gitCommits) {
            if (!existingByHash.has(commit.hash)) {
                // Create checkpoint from git commit
                const checkpoint: Checkpoint = {
                    id: this.generateId(),
                    name: commit.message.replace('[Vibe Guardian] ', ''),
                    timestamp: new Date(commit.date).getTime(),
                    gitCommitHash: commit.hash,
                    type: this.inferTypeFromMessage(commit.message),
                    source: this.inferSourceFromMessage(commit.message),
                    changedFiles: [],
                    sessionId: this.storageData.activeSessionId || 'synced',
                    tags: ['synced-from-git'],
                    starred: false
                };
                this.storageData.checkpoints.push(checkpoint);
                added++;
            }
        }

        // Remove checkpoints whose git commits no longer exist
        const gitHashSet = new Set(gitCommits.map(c => c.hash));
        const toRemove: string[] = [];
        for (const cp of this.storageData.checkpoints) {
            if (cp.gitCommitHash && !gitHashSet.has(cp.gitCommitHash)) {
                toRemove.push(cp.id);
            }
        }

        for (const id of toRemove) {
            await this.deleteCheckpoint(id);
            removed++;
        }

        await this.saveStorageData();

        return {
            synced: gitCommits.length,
            added,
            removed
        };
    }

    /**
     * Infer checkpoint type from commit message
     */
    private inferTypeFromMessage(message: string): CheckpointType {
        if (message.includes('AutoSave') || message.includes('⏰')) {
            return CheckpointType.Auto;
        }
        if (message.includes('Manual') || message.includes('💾')) {
            return CheckpointType.Manual;
        }
        return CheckpointType.AIGenerated;
    }

    /**
     * Infer checkpoint source from commit message
     */
    private inferSourceFromMessage(message: string): CheckpointSource {
        if (message.includes('Copilot') || message.includes('🤖')) {
            return CheckpointSource.Copilot;
        }
        if (message.includes('Cline')) {
            return CheckpointSource.Cline;
        }
        if (message.includes('Claude')) {
            return CheckpointSource.Claude;
        }
        if (message.includes('AutoSave') || message.includes('⏰')) {
            return CheckpointSource.AutoSave;
        }
        if (message.includes('Manual') || message.includes('💾')) {
            return CheckpointSource.User;
        }
        return CheckpointSource.Unknown;
    }

    /**
     * Start a new coding session
     */
    public async startSession(name?: string): Promise<CodingSession> {
        // End current session if exists
        if (this.storageData.activeSessionId) {
            await this.endSession();
        }

        const id = this.generateId();
        const sessionName = name || `Session ${this.storageData.sessions.length + 1}`;
        
        let branchName: string | undefined;
        if (this.storageData.settings.createSessionBranch && await this.gitManager.isGitRepository()) {
            branchName = `vibe-session-${id.substring(0, 8)}`;
            await this.gitManager.createBranch(branchName);
        }

        const session: CodingSession = {
            id,
            name: sessionName,
            startTime: Date.now(),
            isActive: true,
            branchName,
            checkpointIds: [],
            totalFilesChanged: 0,
            aiToolsUsed: []
        };

        this.storageData.sessions.push(session);
        this.storageData.activeSessionId = id;
        await this.saveStorageData();

        // Create session start checkpoint
        await this.createCheckpoint(
            CheckpointType.SessionStart,
            CheckpointSource.User,
            [],
            { name: `🎮 Session Started: ${sessionName}` }
        );

        this._onSessionChanged.fire(session);
        return session;
    }

    /**
     * End current session
     */
    public async endSession(): Promise<void> {
        const session = this.getActiveSession();
        if (!session) {
            return;
        }

        session.endTime = Date.now();
        session.isActive = false;
        this.storageData.activeSessionId = undefined;
        await this.saveStorageData();
        this._onSessionChanged.fire(undefined);
    }

    /**
     * Get active session
     */
    public getActiveSession(): CodingSession | undefined {
        if (!this.storageData.activeSessionId) {
            return undefined;
        }
        return this.storageData.sessions.find(s => s.id === this.storageData.activeSessionId);
    }

    /**
     * Get all sessions
     */
    public getSessions(): CodingSession[] {
        return [...this.storageData.sessions].sort((a, b) => b.startTime - a.startTime);
    }

    /**
     * Get statistics
     */
    public getStatistics(): {
        totalCheckpoints: number;
        totalSessions: number;
        checkpointsBySource: Record<CheckpointSource, number>;
        checkpointsByType: Record<CheckpointType, number>;
    } {
        const checkpointsBySource: Record<CheckpointSource, number> = {
            [CheckpointSource.User]: 0,
            [CheckpointSource.Copilot]: 0,
            [CheckpointSource.Claude]: 0,
            [CheckpointSource.Cline]: 0,
            [CheckpointSource.OtherAI]: 0,
            [CheckpointSource.AutoSave]: 0,
            [CheckpointSource.FileWatcher]: 0,
            [CheckpointSource.Unknown]: 0
        };

        const checkpointsByType: Record<CheckpointType, number> = {
            [CheckpointType.Auto]: 0,
            [CheckpointType.Manual]: 0,
            [CheckpointType.AIGenerated]: 0,
            [CheckpointType.SessionStart]: 0,
            [CheckpointType.AutoSave]: 0
        };

        for (const cp of this.storageData.checkpoints) {
            checkpointsBySource[cp.source]++;
            checkpointsByType[cp.type]++;
        }

        return {
            totalCheckpoints: this.storageData.checkpoints.length,
            totalSessions: this.storageData.sessions.length,
            checkpointsBySource,
            checkpointsByType
        };
    }

    /**
     * Clear all data (for testing/reset)
     */
    public async clearAllData(): Promise<void> {
        this.storageData = {
            version: 1,
            checkpoints: [],
            sessions: [],
            activeSessionId: undefined,
            settings: DEFAULT_SETTINGS
        };
        await this.saveStorageData();
    }

    public dispose(): void {
        this._onCheckpointCreated.dispose();
        this._onCheckpointDeleted.dispose();
        this._onSessionChanged.dispose();
    }
}
