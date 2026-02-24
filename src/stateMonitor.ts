/**
 * Vibe Code Guardian - State Monitor
 * Periodically monitors file changes and creates Git commits for tracking
 */

import * as vscode from 'vscode';
import { GitManager } from './gitManager';

export interface StateSnapshot {
    id: string;
    timestamp: number;
    commitHash: string;
    message: string;
    filesChanged: string[];
}

export class StateMonitor {
    private gitManager: GitManager;
    private commitTimeout: NodeJS.Timeout | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private pendingChanges: Set<string> = new Set();
    private lastCommitTime: number = 0;
    private isEnabled: boolean = true;
    private stateHistory: StateSnapshot[] = [];
    
    // Configuration
    private minTimeBetweenCommits: number = 10000; // 10 seconds minimum between auto-commits
    private commitDebounceMs: number = 5000; // 5 seconds debounce for file changes
    private autoCommitEnabled: boolean = true;

    private _onStateChanged = new vscode.EventEmitter<StateSnapshot>();
    public readonly onStateChanged = this._onStateChanged.event;

    constructor(gitManager: GitManager) {
        this.gitManager = gitManager;
        this.loadHistory();
    }

    /**
     * Start monitoring file changes
     */
    public start(): void {
        if (!this.isEnabled) {
            return;
        }

        console.log('🔍 State Monitor started (trigger-based auto-save)');

        // Watch for file changes - only save when files actually change
        this.startFileWatcher();

        // Do initial state capture
        this.captureState('State Monitor initialized');
    }

    /**
     * Stop monitoring
     */
    public stop(): void {
        console.log('🔍 State Monitor stopped');

        if (this.commitTimeout) {
            clearTimeout(this.commitTimeout);
            this.commitTimeout = null;
        }

        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }
    }

    /**
     * Start periodic state check
     */
    /**
     * Auto-save is now trigger-based:
     * - File changes are detected by FileSystemWatcher
     * - Changes are debounced (5 seconds) to batch rapid edits
     * - Only commits when there are actual Git changes
     * - Minimum time between commits is enforced (10 seconds)
     */

    /**
     * Start file system watcher
     */
    private startFileWatcher(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        // Watch all files in workspace
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

        this.fileWatcher.onDidChange((uri) => {
            if (this.shouldTrackFile(uri)) {
                this.pendingChanges.add(uri.fsPath);
                this.scheduleCommit();
            }
        });

        this.fileWatcher.onDidCreate((uri) => {
            if (this.shouldTrackFile(uri)) {
                this.pendingChanges.add(uri.fsPath);
                this.scheduleCommit();
            }
        });

        this.fileWatcher.onDidDelete((uri) => {
            if (this.shouldTrackFile(uri)) {
                this.pendingChanges.add(uri.fsPath);
                this.scheduleCommit();
            }
        });
    }

    /**
     * Check if file should be tracked
     */
    private shouldTrackFile(uri: vscode.Uri): boolean {
        const filePath = uri.fsPath;
        
        // Ignore common non-tracked paths
        const ignoredPatterns = [
            'node_modules',
            '.git',
            'dist',
            'out',
            '.vscode',
            '__pycache__',
            '.pyc',
            '.class',
            '.o',
            '.obj',
            'target',
            'build',
            '.DS_Store',
            'Thumbs.db',
            '.vsix',
            '.pkl',
            '.pickle',
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            '.serena/cache'
        ];

        for (const pattern of ignoredPatterns) {
            if (filePath.includes(pattern)) {
                return false;
            }
        }

        // Skip large files (> 512KB by default)
        try {
            const fs = require('fs');
            const stat = fs.statSync(filePath);
            const maxFileSize = 512 * 1024; // 512KB
            if (stat.size > maxFileSize) {
                console.log(`⏭️  State Monitor: Skipping large file (${(stat.size / 1024).toFixed(0)}KB): ${filePath}`);
                return false;
            }
        } catch {
            // File might not exist yet (creation event), allow tracking
        }

        return true;
    }

    /**
     * Schedule a commit after debounce period
     */
    private scheduleCommit(): void {
        if (!this.autoCommitEnabled) {
            return;
        }

        // Debounce commits - wait for file changes to settle
        if (this.commitTimeout) {
            clearTimeout(this.commitTimeout);
        }

        this.commitTimeout = setTimeout(async () => {
            await this.checkAndCommit();
        }, this.commitDebounceMs);
    }

    /**
     * Check for changes and commit if needed
     */
    private async checkAndCommit(): Promise<void> {
        if (!this.isEnabled || !this.autoCommitEnabled) {
            return;
        }

        // Check minimum time between commits
        const now = Date.now();
        if (now - this.lastCommitTime < this.minTimeBetweenCommits) {
            return;
        }

        try {
            // Check if there are uncommitted changes
            const status = await this.gitManager.getStatus();
            if (!status) {
                return;
            }

            const hasChanges = status.modified.length > 0 || 
                              status.created.length > 0 || 
                              status.deleted.length > 0 ||
                              status.not_added.length > 0;

            if (!hasChanges) {
                this.pendingChanges.clear();
                return;
            }

            // Create auto-commit
            const timestamp = new Date().toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            const changedFiles = [
                ...status.modified,
                ...status.created,
                ...status.deleted,
                ...status.not_added
            ];

            // Filter out large files from the changed list
            const { kept: trackedFiles, skipped } = this.gitManager.filterLargeFiles(changedFiles);
            if (skipped.length > 0) {
                console.log(`⏭️  State Monitor: Skipped ${skipped.length} large file(s): ${skipped.join(', ')}`);
            }

            if (trackedFiles.length === 0) {
                this.pendingChanges.clear();
                return;
            }

            const fileList = trackedFiles.slice(0, 3).join(', ');
            const moreFiles = trackedFiles.length > 3 ? ` +${trackedFiles.length - 3} more` : '';
            const message = `[Vibe Guardian] 📸 Auto-save @ ${timestamp} (${fileList}${moreFiles})`;

            const commitHash = await this.gitManager.createCommit(trackedFiles, message);
            
            if (commitHash) {
                this.lastCommitTime = now;
                this.pendingChanges.clear();

                const snapshot: StateSnapshot = {
                    id: `state-${now}`,
                    timestamp: now,
                    commitHash: commitHash,
                    message: message,
                    filesChanged: trackedFiles
                };

                this.stateHistory.push(snapshot);
                this.saveHistory();

                console.log(`📸 Auto-saved state: ${commitHash.substring(0, 7)}`);
                this._onStateChanged.fire(snapshot);
            }
        } catch (error) {
            console.error('State monitor check failed:', error);
        }
    }

    /**
     * Manually capture current state
     */
    public async captureState(description?: string): Promise<StateSnapshot | undefined> {
        if (!await this.gitManager.isGitRepository()) {
            return undefined;
        }

        try {
            const status = await this.gitManager.getStatus();
            if (!status) {
                return undefined;
            }

            const changedFiles = [
                ...status.modified,
                ...status.created,
                ...status.deleted,
                ...status.not_added
            ];

            // If no changes, still create a marker commit
            const timestamp = new Date().toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            const message = description 
                ? `[Vibe Guardian] 📌 ${description} @ ${timestamp}`
                : `[Vibe Guardian] 📌 Manual save @ ${timestamp}`;

            // Stage all changes if any
            if (changedFiles.length > 0) {
                const commitHash = await this.gitManager.createCommit([], message);
                if (commitHash) {
                    const now = Date.now();
                    const snapshot: StateSnapshot = {
                        id: `state-${now}`,
                        timestamp: now,
                        commitHash: commitHash,
                        message: message,
                        filesChanged: changedFiles
                    };

                    this.stateHistory.push(snapshot);
                    this.saveHistory();

                    return snapshot;
                }
            }

            return undefined;
        } catch (error) {
            console.error('Failed to capture state:', error);
            return undefined;
        }
    }

    /**
     * Get all state snapshots from git log
     */
    public async getStateHistory(): Promise<StateSnapshot[]> {
        try {
            // Get commits from git log that were created by Vibe Guardian
            const commits = await this.gitManager.getCommitHistory(100);
            const snapshots: StateSnapshot[] = [];

            for (const commit of commits) {
                snapshots.push({
                    id: commit.hash,
                    timestamp: new Date(commit.date).getTime(),
                    commitHash: commit.hash,
                    message: commit.message,
                    filesChanged: [] // Would need to get from diff
                });
            }

            return snapshots;
        } catch {
            return this.stateHistory;
        }
    }

    /**
     * Rollback to a specific state/commit using checkout (preserves history)
     * This allows switching back and forth between different states
     */
    public async rollbackToState(commitHash: string): Promise<{ success: boolean; message: string }> {
        try {
            // First, check if there are uncommitted changes
            const hasChanges = await this.gitManager.hasUncommittedChanges();
            
            if (hasChanges) {
                // Auto-save current state before switching
                const saved = await this.captureState('Auto-save before time travel');
                if (!saved) {
                    // If can't save, stash changes
                    await this.gitManager.stash('Vibe Guardian: stash before time travel');
                }
            }

            // Use checkout instead of reset to preserve history
            // This creates a detached HEAD state
            const success = await this.gitManager.checkoutCommit(commitHash);
            
            if (success) {
                // Refresh all open files
                await this.refreshAllEditors();
                
                return {
                    success: true,
                    message: `Successfully traveled to ${commitHash.substring(0, 7)}. You are in detached HEAD state - create a checkpoint to save changes.`
                };
            } else {
                return {
                    success: false,
                    message: 'Git checkout failed'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Time travel failed: ${error}`
            };
        }
    }

    /**
     * Return to the latest state (HEAD of main branch)
     */
    public async returnToLatest(): Promise<{ success: boolean; message: string }> {
        try {
            // Get the main branch name
            const branch = await this.gitManager.getCurrentBranch();
            const mainBranch = branch || 'master';
            
            // Checkout main branch
            const success = await this.gitManager.checkoutBranch(mainBranch);
            
            if (success) {
                await this.refreshAllEditors();
                return {
                    success: true,
                    message: `Returned to latest state (${mainBranch})`
                };
            } else {
                return {
                    success: false,
                    message: 'Failed to return to main branch'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Failed to return: ${error}`
            };
        }
    }

    /**
     * Get current position info (branch/detached HEAD status)
     */
    public async getCurrentPosition(): Promise<{
        isDetached: boolean;
        currentCommit: string;
        branch?: string;
    }> {
        return await this.gitManager.getHeadInfo();
    }

    /**
     * Rollback to a specific time
     */
    public async rollbackToTime(timestamp: number): Promise<{ success: boolean; message: string }> {
        try {
            // Find the commit closest to but not after the timestamp
            const commits = await this.gitManager.getCommitHistory(100);
            
            let targetCommit: string | null = null;
            for (const commit of commits) {
                const commitTime = new Date(commit.date).getTime();
                if (commitTime <= timestamp) {
                    targetCommit = commit.hash;
                    break;
                }
            }

            if (!targetCommit) {
                return {
                    success: false,
                    message: 'No commit found before the specified time'
                };
            }

            return await this.rollbackToState(targetCommit);
        } catch (error) {
            return {
                success: false,
                message: `Rollback failed: ${error}`
            };
        }
    }

    /**
     * Refresh all open editors to show updated content
     */
    private async refreshAllEditors(): Promise<void> {
        // Revert all open documents to reload from disk
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file' && !doc.isUntitled) {
                try {
                    await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri);
                } catch {
                    // Ignore errors
                }
            }
        }

        // Refresh file explorer
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    }

    /**
     * Save history to workspace state
     */
    private saveHistory(): void {
        // Keep only last 100 entries
        if (this.stateHistory.length > 100) {
            this.stateHistory = this.stateHistory.slice(-100);
        }
    }

    /**
     * Load history from workspace state
     */
    private loadHistory(): void {
        // History is primarily from git, so we just initialize empty
        this.stateHistory = [];
    }

    /**
     * Enable/disable auto-commit
     */
    public setAutoCommit(enabled: boolean): void {
        this.autoCommitEnabled = enabled;
        console.log(`Auto-commit ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Set check interval
     */
    /**
     * @deprecated This method is kept for API compatibility.
     * Auto-save is now trigger-based, not interval-based.
     * Use setCommitDebounce() instead to control debounce timing.
     */
    public setCheckInterval(_ms: number): void {
        console.log('⚠️ setCheckInterval is deprecated. Auto-save is now trigger-based.');
    }

    /**
     * Get monitoring status
     */
    public getStatus(): { enabled: boolean; autoCommit: boolean; debounceMs: number; pendingChanges: number } {
        return {
            enabled: this.isEnabled,
            autoCommit: this.autoCommitEnabled,
            debounceMs: this.commitDebounceMs,
            pendingChanges: this.pendingChanges.size
        };
    }

    public dispose(): void {
        this.stop();
        this._onStateChanged.dispose();
    }
}
