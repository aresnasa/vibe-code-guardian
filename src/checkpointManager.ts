/**
 * Vibe Code Guardian - Checkpoint Manager
 * Core logic for creating, managing, and organizing checkpoints
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import {
    Checkpoint,
    CheckpointType,
    CheckpointSource,
    CodingSession,
    CheckpointStorageData,
    GuardianSettings,
    ChangedFile,
    FileChangeType,
    DEFAULT_SETTINGS,
    CommitLanguage,
    PushStrategy,
    TrackingMode,
    Milestone,
    MilestoneStatus
} from './types';
import { GitManager } from './gitManager';
import { generateLocalizedCheckpointName } from './languageConfig';
import { MilestoneManager } from './milestoneManager';

export class CheckpointManager {
    private context: vscode.ExtensionContext;
    private gitManager: GitManager;
    private milestoneManager: MilestoneManager;
    private storageData: CheckpointStorageData;
    private _onCheckpointCreated: vscode.EventEmitter<Checkpoint> = new vscode.EventEmitter<Checkpoint>();
    private _onCheckpointDeleted: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private _onSessionChanged: vscode.EventEmitter<CodingSession | undefined> = new vscode.EventEmitter<CodingSession | undefined>();
    private _onMilestoneChanged: vscode.EventEmitter<Milestone | undefined> = new vscode.EventEmitter<Milestone | undefined>();

    public readonly onCheckpointCreated: vscode.Event<Checkpoint> = this._onCheckpointCreated.event;
    public readonly onCheckpointDeleted: vscode.Event<string> = this._onCheckpointDeleted.event;
    public readonly onSessionChanged: vscode.Event<CodingSession | undefined> = this._onSessionChanged.event;
    public readonly onMilestoneChanged: vscode.Event<Milestone | undefined> = this._onMilestoneChanged.event;

    constructor(context: vscode.ExtensionContext, gitManager: GitManager) {
        this.context = context;
        this.gitManager = gitManager;
        this.milestoneManager = new MilestoneManager(gitManager);
        this.storageData = this.loadStorageData();
    }

    /**
     * Load storage data from workspace state
     */
    private loadStorageData(): CheckpointStorageData {
        const data = this.context.workspaceState.get<CheckpointStorageData>('vibeCodeGuardian.data');
        if (data && data.version === 1) {
            // Merge with DEFAULT_SETTINGS to ensure new settings fields have default values
            return {
                ...data,
                milestones: data.milestones ?? [],
                activeMilestoneId: data.activeMilestoneId,
                settings: { ...DEFAULT_SETTINGS, ...data.settings }
            };
        }
        return {
            version: 1,
            checkpoints: [],
            sessions: [],
            activeSessionId: undefined,
            milestones: [],
            activeMilestoneId: undefined,
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
        return generateLocalizedCheckpointName(type, source, this.storageData.settings.commitLanguage);
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
        let actualChangedFiles = await this.captureCheckpointSnapshots(changedFiles);
        const shouldCreateGitCheckpoint =
            this.storageData.settings.enableGit &&
            this.storageData.settings.trackingMode === 'full' &&
            await this.gitManager.isGitRepository();
        
        if (shouldCreateGitCheckpoint) {
            try {
                // Use Git's actual changed files list for accuracy
                const gitChangedFiles = await this.gitManager.getDetailedChangedFiles();
                
                if (gitChangedFiles.length > 0) {
                    // Convert to ChangedFile format, filtering out files that don't exist
                    actualChangedFiles = await this.syncChangedFilesWithGit(actualChangedFiles, gitChangedFiles);
                }

                // Stage and commit, filtering large files
                const commitMessage = `[Vibe Guardian] ${name}`;
                const maxFileSize = this.storageData.settings.maxFileSize;
                const commitResult = await this.gitManager.stageAndCommitAll(commitMessage, maxFileSize);
                
                if (commitResult.skippedLargeFiles && commitResult.skippedLargeFiles.length > 0) {
                    console.log(`⏭️  Checkpoint skipped ${commitResult.skippedLargeFiles.length} large file(s)`);
                }

                if (commitResult.success && commitResult.commitHash) {
                    gitCommitHash = commitResult.commitHash;
                    
                    // Update changedFiles with actual committed files
                    if (commitResult.changedFiles.length > 0) {
                        actualChangedFiles = await this.convertToChangedFiles(commitResult.changedFiles, actualChangedFiles);
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
            branchName: this.getActiveSession()?.branchName,
            milestoneId: this.storageData.activeMilestoneId
        };

        this.storageData.checkpoints.push(checkpoint);

        // Link to active milestone if one exists
        if (this.storageData.activeMilestoneId) {
            const milestone = this.getActiveMilestone();
            if (milestone) {
                this.milestoneManager.linkCheckpoint(milestone, checkpoint);
            }
        }

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

        // Push to remote based on push strategy
        if (gitCommitHash && this.storageData.settings.enableGit) {
            await this.handlePushStrategy(checkpoint);
        }

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
     * Handle push to remote based on push strategy
     */
    private async handlePushStrategy(checkpoint: Checkpoint): Promise<void> {
        const strategy = this.storageData.settings.pushStrategy;
        
        if (strategy === 'none') {
            return;
        }

        const shouldPush = this.shouldPushCheckpoint(checkpoint, strategy);
        
        if (shouldPush) {
            try {
                const result = await this.gitManager.pushToRemote();
                if (result.success) {
                    console.log(`📤 Pushed milestone checkpoint: ${checkpoint.name}`);
                } else if (!result.message.includes('not found')) {
                    // Only log if it's not a "remote not found" error (common for local-only repos)
                    console.warn(`Push skipped: ${result.message}`);
                }
            } catch (error) {
                console.warn('Push failed:', error);
            }
        }
    }

    /**
     * Determine if a checkpoint should be pushed based on strategy
     */
    private shouldPushCheckpoint(checkpoint: Checkpoint, strategy: PushStrategy): boolean {
        if (strategy === 'all') {
            return true;
        }
        
        if (strategy === 'milestone') {
            // Only push manual checkpoints and session starts (milestones)
            return checkpoint.type === CheckpointType.Manual || 
                   checkpoint.type === CheckpointType.SessionStart;
        }
        
        return false;
    }

    /**
     * Sync changed files with Git status - ensures accuracy
     */
    private async syncChangedFilesWithGit(
        originalFiles: ChangedFile[],
        gitFiles: Array<{ path: string; changeType: 'added' | 'modified' | 'deleted' | 'renamed'; staged: boolean }>
    ): Promise<ChangedFile[]> {
        const result: ChangedFile[] = [];

        // Add Git files that match original files or are new
        for (const gitFile of gitFiles) {
            const originalFile = originalFiles.find(f => f.path.endsWith(gitFile.path) || gitFile.path.endsWith(f.path));
            const resolvedPath = this.resolveWorkspacePath(gitFile.path);
            
            result.push({
                path: resolvedPath,
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
    private async convertToChangedFiles(filePaths: string[], originalFiles: ChangedFile[] = []): Promise<ChangedFile[]> {
        return filePaths.map(filePath => ({
            path: this.resolveWorkspacePath(filePath),
            changeType: originalFiles.find(file => file.path.endsWith(filePath) || filePath.endsWith(file.path))?.changeType ?? FileChangeType.Modified,
            linesAdded: originalFiles.find(file => file.path.endsWith(filePath) || filePath.endsWith(file.path))?.linesAdded ?? 0,
            linesRemoved: originalFiles.find(file => file.path.endsWith(filePath) || filePath.endsWith(file.path))?.linesRemoved ?? 0,
            previousContent: originalFiles.find(file => file.path.endsWith(filePath) || filePath.endsWith(file.path))?.previousContent,
            currentContent: originalFiles.find(file => file.path.endsWith(filePath) || filePath.endsWith(file.path))?.currentContent
        }));
    }

    /**
     * Capture checkpoint snapshots so local-only tracking can restore files without Git commits
     */
    private async captureCheckpointSnapshots(changedFiles: ChangedFile[]): Promise<ChangedFile[]> {
        const isGitRepo = this.storageData.settings.enableGit && await this.gitManager.isGitRepository();

        return Promise.all(changedFiles.map(async (file) => {
            const resolvedPath = this.resolveWorkspacePath(file.path);
            const previousContent = file.previousContent ?? await this.getPreviousFileContent(resolvedPath, file.changeType, isGitRepo);
            const currentContent = file.currentContent ?? await this.getCurrentFileContent(resolvedPath, file.changeType);

            return {
                ...file,
                path: resolvedPath,
                previousContent,
                currentContent
            };
        }));
    }

    private async getCurrentFileContent(filePath: string, changeType: FileChangeType): Promise<string | undefined> {
        if (changeType === FileChangeType.Deleted) {
            return undefined;
        }

        const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
        if (openDocument) {
            return openDocument.getText();
        }

        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            return Buffer.from(bytes).toString('utf8');
        } catch {
            return undefined;
        }
    }

    private async getPreviousFileContent(
        filePath: string,
        changeType: FileChangeType,
        isGitRepo: boolean
    ): Promise<string | undefined> {
        if (!isGitRepo || changeType === FileChangeType.Added) {
            return undefined;
        }

        return this.gitManager.getFileAtCommit(filePath, 'HEAD');
    }

    private resolveWorkspacePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return workspaceFolder ? path.join(workspaceFolder, filePath) : filePath;
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
            
            // Only remove checkpoints that CANNOT be rolled back to
            // (missing git commit AND no stored content)
            if (!validation.canRollback) {
                details.push(`Removing "${checkpoint.name}": ${validation.issues.filter(i => !i.includes('ok for rollback')).join(', ')}`);
                await this.deleteCheckpoint(checkpoint.id);
                removed.push(checkpoint.id);
            } else if (!validation.valid) {
                // Log but don't remove - these can still be rolled back
                details.push(`Keeping "${checkpoint.name}" (can rollback): ${validation.issues.join(', ')}`);
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

    // ============================================
    // Milestone Operations
    // ============================================

    /**
     * Start a new milestone — all subsequent checkpoints will be linked to it
     */
    public async startMilestone(
        name: string,
        intent: string,
        options?: {
            description?: string;
            source?: CheckpointSource;
            tags?: string[];
            parentMilestoneId?: string;
        }
    ): Promise<Milestone> {
        const sessionId = this.storageData.activeSessionId;
        if (!sessionId) {
            await this.startSession();
        }

        const milestone = this.milestoneManager.createMilestone(
            name,
            intent,
            this.storageData.activeSessionId!,
            options
        );

        this.storageData.milestones.push(milestone);
        this.storageData.activeMilestoneId = milestone.id;
        await this.saveStorageData();
        this._onMilestoneChanged.fire(milestone);
        return milestone;
    }

    /**
     * Complete the active milestone
     */
    public async completeMilestone(
        milestoneId?: string,
        options?: { createGitCommit?: boolean; commitMessage?: string }
    ): Promise<{ milestone: Milestone; gitCommitHash?: string } | undefined> {
        const id = milestoneId ?? this.storageData.activeMilestoneId;
        if (!id) { return undefined; }

        const milestone = this.storageData.milestones.find(m => m.id === id);
        if (!milestone || milestone.status !== MilestoneStatus.Active) { return undefined; }

        const linkedCheckpoints = this.storageData.checkpoints.filter(
            cp => milestone.checkpointIds.includes(cp.id)
        );

        const result = await this.milestoneManager.completeMilestone(
            milestone,
            linkedCheckpoints,
            options
        );

        if (this.storageData.activeMilestoneId === id) {
            this.storageData.activeMilestoneId = undefined;
        }

        await this.saveStorageData();
        this._onMilestoneChanged.fire(milestone);
        return { milestone, gitCommitHash: result.gitCommitHash };
    }

    /**
     * Abandon the active milestone
     */
    public async abandonMilestone(milestoneId?: string): Promise<Milestone | undefined> {
        const id = milestoneId ?? this.storageData.activeMilestoneId;
        if (!id) { return undefined; }

        const milestone = this.storageData.milestones.find(m => m.id === id);
        if (!milestone || milestone.status !== MilestoneStatus.Active) { return undefined; }

        this.milestoneManager.abandonMilestone(milestone);

        if (this.storageData.activeMilestoneId === id) {
            this.storageData.activeMilestoneId = undefined;
        }

        await this.saveStorageData();
        this._onMilestoneChanged.fire(undefined);
        return milestone;
    }

    /**
     * Get the currently active milestone
     */
    public getActiveMilestone(): Milestone | undefined {
        if (!this.storageData.activeMilestoneId) { return undefined; }
        return this.storageData.milestones.find(m => m.id === this.storageData.activeMilestoneId);
    }

    /**
     * Get a milestone by ID
     */
    public getMilestone(id: string): Milestone | undefined {
        return this.storageData.milestones.find(m => m.id === id);
    }

    /**
     * Get all milestones, optionally filtered by status
     */
    public getMilestones(status?: MilestoneStatus): Milestone[] {
        const milestones = [...this.storageData.milestones].sort((a, b) => b.createdAt - a.createdAt);
        if (status !== undefined) {
            return milestones.filter(m => m.status === status);
        }
        return milestones;
    }

    /**
     * Get checkpoints belonging to a specific milestone
     */
    public getMilestoneCheckpoints(milestoneId: string): Checkpoint[] {
        const milestone = this.getMilestone(milestoneId);
        if (!milestone) { return []; }
        return this.storageData.checkpoints
            .filter(cp => milestone.checkpointIds.includes(cp.id))
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Update milestone metadata
     */
    public async updateMilestone(
        milestoneId: string,
        updates: { name?: string; intent?: string; description?: string; tags?: string[] }
    ): Promise<boolean> {
        const milestone = this.getMilestone(milestoneId);
        if (!milestone) { return false; }

        this.milestoneManager.updateMilestone(milestone, updates);
        await this.saveStorageData();
        this._onMilestoneChanged.fire(milestone);
        return true;
    }

    /**
     * Delete a milestone (but keep its checkpoints)
     */
    public async deleteMilestone(milestoneId: string): Promise<boolean> {
        const index = this.storageData.milestones.findIndex(m => m.id === milestoneId);
        if (index === -1) { return false; }

        // Unlink checkpoints from this milestone
        for (const cp of this.storageData.checkpoints) {
            if (cp.milestoneId === milestoneId) {
                cp.milestoneId = undefined;
            }
        }

        if (this.storageData.activeMilestoneId === milestoneId) {
            this.storageData.activeMilestoneId = undefined;
        }

        this.storageData.milestones.splice(index, 1);
        await this.saveStorageData();
        this._onMilestoneChanged.fire(undefined);
        return true;
    }

    /** Expose milestoneManager for direct event subscriptions */
    public getMilestoneManager(): MilestoneManager {
        return this.milestoneManager;
    }

    /**
     * Get the pre-milestone file states so the RollbackManager can restore them.
     * Returns each file's content as it was BEFORE the first checkpoint of the milestone.
     */
    public getMilestonePreState(milestoneId: string): Array<{ path: string; previousContent?: string; changeType: import('./types').FileChangeType }> {
        const milestone = this.getMilestone(milestoneId);
        if (!milestone) { return []; }

        const linked = this.getMilestoneCheckpoints(milestoneId);
        if (linked.length === 0) { return []; }

        // Earliest checkpoint recorded the "before" snapshot
        const first = linked[0];
        return first.changedFiles.map(f => ({
            path: f.path,
            previousContent: f.previousContent,
            changeType: f.changeType
        }));
    }

    /**
     * Export milestones to a human- and AI-readable intent file (.vibe/INTENT.md)
     * This file is auto-updated whenever milestones change so that AI agents always
     * have up-to-date context about WHY the code was modified.
     */
    public async exportIntentFile(): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) { return; }

        const milestones = this.getMilestones();
        if (milestones.length === 0) { return; }

        const lines: string[] = [
            '# Vibe Code Guardian — Intent Log',
            '',
            '> This file is auto-generated by Vibe Code Guardian.',
            '> It maps **why** each set of code changes was made.',
            '> Both developers and AI agents should read this to understand the codebase evolution.',
            ''
        ];

        const active = milestones.filter(m => m.status === MilestoneStatus.Active);
        const completed = milestones.filter(m => m.status === MilestoneStatus.Completed);
        const abandoned = milestones.filter(m => m.status === MilestoneStatus.Abandoned);

        if (active.length > 0) {
            lines.push('## 🟢 Active Work');
            lines.push('');
            for (const m of active) {
                lines.push(...this.formatMilestoneSection(m));
            }
        }

        if (completed.length > 0) {
            lines.push('## ✅ Completed');
            lines.push('');
            for (const m of completed) {
                lines.push(...this.formatMilestoneSection(m));
            }
        }

        if (abandoned.length > 0) {
            lines.push('## 🚫 Abandoned');
            lines.push('');
            for (const m of abandoned) {
                lines.push(...this.formatMilestoneSection(m));
            }
        }

        const content = lines.join('\n');

        try {
            const vibeDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.vibe');
            await vscode.workspace.fs.createDirectory(vibeDir);
            const intentFile = vscode.Uri.joinPath(vibeDir, 'INTENT.md');
            await vscode.workspace.fs.writeFile(intentFile, Buffer.from(content, 'utf8'));
        } catch (error) {
            console.warn('Failed to write intent file:', error);
        }
    }

    private formatMilestoneSection(m: Milestone): string[] {
        const lines: string[] = [];
        const date = new Date(m.createdAt).toISOString().split('T')[0];
        lines.push(`### ${m.name}`);
        lines.push('');
        lines.push(`**Intent (WHY):** ${m.intent}`);
        if (m.description) {
            lines.push('');
            lines.push(`**Context:** ${m.description}`);
        }
        lines.push('');
        lines.push(`- **Date:** ${date}`);
        lines.push(`- **Status:** ${m.status}`);
        if (m.gitCommitHash) {
            lines.push(`- **Commit:** \`${m.gitCommitHash}\``);
        }
        if (m.changedFiles.length > 0) {
            lines.push(`- **Files changed:**`);
            for (const f of m.changedFiles) {
                const rel = f.path.replace(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', '').replace(/^[/\\]/, '');
                lines.push(`  - \`${rel}\``);
            }
        }
        if (m.tags.length > 0) {
            lines.push(`- **Tags:** ${m.tags.join(', ')}`);
        }
        lines.push('');
        return lines;
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
            milestones: [],
            activeMilestoneId: undefined,
            settings: DEFAULT_SETTINGS
        };
        await this.saveStorageData();
    }

    public dispose(): void {
        this._onCheckpointCreated.dispose();
        this._onCheckpointDeleted.dispose();
        this._onSessionChanged.dispose();
        this._onMilestoneChanged.dispose();
        this.milestoneManager.dispose();
    }
}
