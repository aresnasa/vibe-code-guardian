/**
 * Vibe Code Guardian - Main Extension Entry Point
 * Game-like checkpoint system for AI-assisted coding sessions
 */

import * as vscode from 'vscode';
import { GitManager } from './gitManager';
import { CheckpointManager } from './checkpointManager';
import { AIDetector, ChangeSignificanceAnalyzer } from './aiDetector';
import { RollbackManager, DiffContentProvider } from './rollbackManager';
import { TimelineTreeProvider, TimelineItem } from './timelineTreeProvider';
import { StateMonitor } from './stateMonitor';
import { CheckpointType, CheckpointSource, ChangedFile, FileChangeType, CommitLanguage, NotificationLevel, PushStrategy, TrackingMode, MilestoneStatus } from './types';
import { getLanguageDisplayName, getNextLanguage, getNotificationLevelDisplayName, getNextNotificationLevel, getPushStrategyDisplayName, getNextPushStrategy, getTrackingModeDisplayName, getNextTrackingMode } from './languageConfig';
import { GitGraphTreeProvider, GitGraphTreeItem } from './gitGraphTreeProvider';
import { GitGraphWebviewManager } from './gitGraphWebview';
import { BlameDecorator } from './blameDecorator';
import { ProjectVerifier } from './verification';

/**
 * Smart Notification Manager
 * Manages notification frequency and prevents notification spam
 */
class SmartNotificationManager {
    private lastNotificationTime = 0;
    private lastNotificationMessage = '';
    private notificationHistory: { message: string; time: number }[] = [];
    private throttleTime = 30000; // Default 30 seconds (raised from 15)
    private consecutiveThrottles = 0; // Exponential back-off counter

    constructor() {
        const settings = this.loadSettings();
        if (settings.notificationThrottle) {
            this.throttleTime = settings.notificationThrottle;
        }
    }

    private loadSettings() {
        try {
            const config = vscode.workspace.getConfiguration('vibeCodeGuardian');
            return {
                notificationThrottle: config.get<number>('notificationThrottle', 30000),
                maxNotificationWindows: config.get<number>('maxNotificationWindows', 3)
            };
        } catch (error) {
            console.error('Failed to load notification settings:', error);
            return { notificationThrottle: 30000, maxNotificationWindows: 3 };
        }
    }

    /**
     * Effective throttle interval — grows exponentially when many similar
     * notifications are suppressed consecutively, resets on a successful show.
     */
    private get effectiveThrottleMs(): number {
        // Cap the multiplier at 8× (i.e. 2^3)
        const multiplier = Math.min(Math.pow(2, this.consecutiveThrottles), 8);
        return this.throttleTime * multiplier;
    }

    async showInformationMessage(message: string, dismissible: boolean = true): Promise<void> {
        const now = Date.now();

        // Hard throttle — time since last shown notification
        if (now - this.lastNotificationTime < this.effectiveThrottleMs) {
            this.consecutiveThrottles++;
            console.log(`🔇 Notification throttled (${this.effectiveThrottleMs}ms): ${message}`);
            return;
        }

        // De-duplicate — skip if a very similar message was shown within a 60-second window
        if (this.isSimilarToRecent(message, now)) {
            this.consecutiveThrottles++;
            console.log(`🔇 Similar notification skipped: ${message}`);
            return;
        }

        // Enforce max visible windows based on recent history
        const settings = this.loadSettings();
        const recentWindow = 30_000; // 30 seconds
        const recentCount = this.notificationHistory.filter(h => now - h.time < recentWindow).length;
        if (recentCount >= (settings.maxNotificationWindows || 3)) {
            this.consecutiveThrottles++;
            console.log(`🔇 Too many recent notifications (${recentCount}), skipping: ${message}`);
            return;
        }

        await vscode.window.showInformationMessage(message, dismissible ? 'Dismiss' : 'OK');

        // Reset exponential back-off on successful show
        this.consecutiveThrottles = 0;
        this.lastNotificationTime = now;
        this.lastNotificationMessage = message;
        this.notificationHistory.push({ message, time: now });

        // Prune entries older than 2 minutes
        this.notificationHistory = this.notificationHistory.filter(h => now - h.time < 120_000);
    }

    /**
     * Check if message is similar to any shown within the past `windowMs` milliseconds.
     */
    private isSimilarToRecent(message: string, now: number, windowMs: number = 60_000): boolean {
        const messageLower = message.toLowerCase();
        const messageWords = new Set(messageLower.split(/\s+/));
        return this.notificationHistory.some(entry => {
            if (now - entry.time > windowMs) { return false; }
            const historyWords = entry.message.toLowerCase().split(/\s+/);
            const commonCount = historyWords.filter(w => messageWords.has(w)).length;
            return commonCount / Math.max(messageWords.size, 1) > 0.4;
        });
    }

    async showWarningMessage(message: string): Promise<void> {
        const now = Date.now();
        if (now - this.lastNotificationTime < 5000) {
            console.log(`🔇 Warning throttled: ${message}`);
            return;
        }
        await vscode.window.showWarningMessage(message);
        this.lastNotificationTime = now;
        this.lastNotificationMessage = message;
    }

    async showErrorMessage(message: string): Promise<void> {
        await vscode.window.showErrorMessage(message);
        this.lastNotificationTime = Date.now();
    }

    /** Reset throttling (call when user explicitly triggers an action) */
    reset(): void {
        this.lastNotificationTime = 0;
        this.lastNotificationMessage = '';
        this.notificationHistory = [];
        this.consecutiveThrottles = 0;
        console.log('🔄 Notification throttling reset');
    }
}

/**
 * Global notification manager instance
 */
const notificationManager = new SmartNotificationManager();

/**
 * Determines if a notification should be shown based on notification level and checkpoint type
 * @param notificationLevel Current notification level setting
 * @param checkpointType Type of checkpoint being created
 * @param isUserAction Whether this was triggered by explicit user action
 * @returns true if notification should be shown
 */
function shouldShowNotification(
    notificationLevel: NotificationLevel,
    checkpointType: CheckpointType,
    isUserAction: boolean = false
): boolean {
    switch (notificationLevel) {
        case 'none':
            return false;
        case 'all':
            return true;
        case 'milestone':
            // Only show for manual checkpoints, session starts, and explicit user actions
            return isUserAction || 
                   checkpointType === CheckpointType.Manual ||
                   checkpointType === CheckpointType.SessionStart;
        default:
            return false;
    }
}

let gitManager: GitManager;
let checkpointManager: CheckpointManager;
let aiDetector: AIDetector;
let rollbackManager: RollbackManager;
let treeProvider: TimelineTreeProvider;
let stateMonitor: StateMonitor;
let gitGraphTreeProvider: GitGraphTreeProvider;
let gitGraphWebview: GitGraphWebviewManager;
let blameDecorator: BlameDecorator;
let guardianMainStatusBarItem: vscode.StatusBarItem;
let guardianInfoStatusBarItem: vscode.StatusBarItem;
let guardianGroupManagementStatusBarItem: vscode.StatusBarItem; // New: dedicated group management button

async function syncSettingsFromConfiguration(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vibeCodeGuardian');
    const autoSaveEnabled = config.get<boolean>('autoSaveEnabled', true);
    const autoSaveIntervalMinutes = config.get<number>('autoSaveIntervalMinutes', 5);

    await checkpointManager.updateSettings({
        autoCheckpointOnAI: config.get<boolean>('autoCheckpointOnAIChanges', true),
        autoCheckpointOnUserSave: config.get<boolean>('autoCheckpointOnUserSave', true),
        minLinesForUserCheckpoint: config.get<number>('minLinesForUserCheckpoint', 5),
        autoSaveInterval: autoSaveEnabled ? autoSaveIntervalMinutes * 60 : 0,
        maxCheckpoints: config.get<number>('maxCheckpointsPerSession', 50),
        showNotifications: config.get<boolean>('showNotifications', true),
        notificationLevel: config.get<NotificationLevel>('notificationLevel', 'milestone'),
        notificationThrottle: config.get<number>('notificationThrottle', 5000),
        maxNotificationWindows: config.get<number>('maxNotificationWindows', 3),
        commitLanguage: config.get<CommitLanguage>('commitLanguage', 'auto'),
        pushStrategy: config.get<PushStrategy>('pushStrategy', 'none'),
        maxFileSize: config.get<number>('maxFileSizeKB', 512) * 1024,
        trackingMode: config.get<TrackingMode>('trackingMode', 'local-only'),
        milestoneEnabled: config.get<boolean>('milestoneEnabled', true)
    });
}

function applyRuntimeSettings(context: vscode.ExtensionContext): void {
    const settings = checkpointManager.getSettings();
    stateMonitor.setAutoCommit(settings.trackingMode === 'full');
    updateGuardianInfoStatusBar();
    startAutoSaveTimer(context);
}

function isMilestoneEnabled(): boolean {
    return checkpointManager.getSettings().milestoneEnabled;
}

async function showMilestoneDisabledGuidance(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
        'Milestone is currently OFF. Use the status bar button "🎯 OFF" or run "Vibe Guardian: Toggle Milestone" to enable it.',
        'Enable Now',
        'Open Settings'
    );

    if (action === 'Enable Now') {
        await vscode.commands.executeCommand('vibeCodeGuardian.toggleMilestone');
    } else if (action === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'vibeCodeGuardian.milestoneEnabled');
    }
}

/**
 * Applies recommended VS Code settings for optimal Vibe Code Guardian experience
 */
async function applyRecommendedSettings() {
    const config = vscode.workspace.getConfiguration();
    const needsUpdate: string[] = [];

    // Notification position
    const notificationPosition = config.inspect('workbench.notifications.position')?.globalValue;
    if (notificationPosition !== 'bottom-left') {
        await config.update('workbench.notifications.position', 'bottom-left', vscode.ConfigurationTarget.Global);
        needsUpdate.push('notification position → bottom-left');
    }

    // Notification timeout
    const notificationTimeout = config.inspect('workbench.notifications.timeout')?.globalValue;
    if (notificationTimeout !== 10000) {
        await config.update('workbench.notifications.timeout', 10000, vscode.ConfigurationTarget.Global);
        needsUpdate.push('notification timeout → 10s');
    }

    if (needsUpdate.length > 0) {
        console.log(`⚙️ Vibe Code Guardian applied recommended settings: ${needsUpdate.join(', ')}`);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('🎮 Vibe Code Guardian is activating...');

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Vibe Code Guardian: Please open a workspace folder first.');
        return;
    }

    try {
        // Apply recommended VS Code settings
        await applyRecommendedSettings();
        // Initialize all managers
        gitManager = new GitManager();
        checkpointManager = new CheckpointManager(context, gitManager);
        await syncSettingsFromConfiguration();
        aiDetector = new AIDetector();
        rollbackManager = new RollbackManager(gitManager, checkpointManager);
        treeProvider = new TimelineTreeProvider(checkpointManager);

        // Check Git installation first
        if (!gitManager.isGitInstalled()) {
            const choice = await vscode.window.showWarningMessage(
                'Vibe Code Guardian: Git is not installed. Most features require Git.',
                'Install Git',
                'Continue Anyway'
            );
            if (choice === 'Install Git') {
                await gitManager.showGitInstallInstructions();
            }
        }

        // Detect project type
        const projectInfo = await gitManager.detectProjectType();
        console.log(`Detected project: ${projectInfo.name} (${projectInfo.type})`);

        // Check Git repository
        const isGitRepo = await gitManager.isGitRepository();
        if (!isGitRepo && gitManager.isGitInstalled()) {
            const choice = await vscode.window.showWarningMessage(
                `Vibe Code Guardian: "${projectInfo.name}" is not a Git repository. Initialize one?`,
                'Initialize Git',
                'Later'
            );
            if (choice === 'Initialize Git') {
                await gitManager.initializeRepository();
            }
        } else if (isGitRepo) {
            const frameworkInfo = projectInfo.framework ? ` (${projectInfo.framework})` : '';
            console.log(`✅ Git repository ready: ${projectInfo.name}${frameworkInfo}`);
        }

        // Register Tree View for sidebar
        const treeView = vscode.window.createTreeView('vibeCodeGuardian.checkpointExplorer', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);

        // Register Git Graph Tree View
        gitGraphTreeProvider = new GitGraphTreeProvider(gitManager);
        const gitGraphTreeView = vscode.window.createTreeView('vibeCodeGuardian.gitGraph', {
            treeDataProvider: gitGraphTreeProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(gitGraphTreeView);

        // Create Git Graph WebView Manager
        gitGraphWebview = new GitGraphWebviewManager(context, gitManager);
        context.subscriptions.push({ dispose: () => gitGraphWebview.dispose() });

        // Initialize inline blame decorator (GitLens-style current-line annotations)
        blameDecorator = new BlameDecorator(gitManager);
        context.subscriptions.push(blameDecorator);

        // Register DiffContentProvider for diff view
        const diffProvider = new DiffContentProvider();
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider('vibe-guardian-diff', diffProvider)
        );

        // Initialize and start State Monitor
        stateMonitor = new StateMonitor(gitManager);
        applyRuntimeSettings(context);
        stateMonitor.start();
        context.subscriptions.push({ dispose: () => stateMonitor.dispose() });

        // Register all commands
        registerCommands(context);

        // Setup event listeners
        setupEventListeners(context);

        // Start auto-save timer
        startAutoSaveTimer(context);

        // Create status bar items
        createGuardianStatusBars(context);

        // Show welcome and auto-start session
        vscode.window.showInformationMessage('🎮 Vibe Code Guardian activated!');
        await checkpointManager.startSession('Coding Session');

        console.log('✅ Vibe Code Guardian fully activated');

    } catch (error) {
        console.error('Failed to activate Vibe Code Guardian:', error);
        vscode.window.showErrorMessage(`Activation failed: ${error}`);
    }
}

async function getChangedFilesForCheckpoint(): Promise<ChangedFile[]> {
    const changedFiles: ChangedFile[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
        const gitFiles = await gitManager.getChangedFiles();
        for (const filePath of gitFiles) {
            changedFiles.push({
                path: workspaceRoot && !filePath.startsWith('/')
                    ? vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), filePath).fsPath
                    : filePath,
                changeType: FileChangeType.Modified,
                linesAdded: 0,
                linesRemoved: 0
            });
        }
    } catch {
        // If git fails, return empty array
    }
    return changedFiles;
}

function registerCommands(context: vscode.ExtensionContext) {
    // Create Checkpoint with description
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.createCheckpoint', async () => {
            const description = await vscode.window.showInputBox({
                prompt: '💾 Enter checkpoint description (optional)',
                placeHolder: 'e.g., Added login feature'
            });
            
            try {
                const changedFiles = await getChangedFilesForCheckpoint();
                const checkpoint = await checkpointManager.createCheckpoint(
                    CheckpointType.Manual,
                    CheckpointSource.User,
                    changedFiles,
                    { description: description || undefined }
                );
                if (checkpoint) {
                    await notificationManager.showInformationMessage(`✅ Checkpoint saved: ${checkpoint.name}`);
                    treeProvider.refresh();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create checkpoint: ${error}`);
            }
        })
    );

    // Quick Save (no prompt)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.quickSave', async () => {
            try {
                const changedFiles = await getChangedFilesForCheckpoint();
                const checkpoint = await checkpointManager.createCheckpoint(
                    CheckpointType.Manual,
                    CheckpointSource.User,
                    changedFiles
                );
                if (checkpoint) {
                    await notificationManager.showInformationMessage(`⚡ Quick saved: ${checkpoint.name}`);
                    treeProvider.refresh();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Quick save failed: ${error}`);
            }
        })
    );

    // Rollback to Checkpoint
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.rollback', async (item?: TimelineItem) => {
            let checkpointId: string | undefined;
            
            if (item && item.checkpointId) {
                checkpointId = item.checkpointId;
            } else {
                const checkpoints = checkpointManager.getCheckpoints();
                if (checkpoints.length === 0) {
                    // Offer to use Time Machine instead
                    const action = await vscode.window.showWarningMessage(
                        'No checkpoints available. Use Time Machine to rollback from Git history?',
                        'Open Time Machine',
                        'Cancel'
                    );
                    if (action === 'Open Time Machine') {
                        await vscode.commands.executeCommand('vibeCodeGuardian.timeMachine');
                    }
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    checkpoints.map(cp => ({
                        label: cp.name,
                        description: cp.gitCommitHash ? `🔗 ${cp.gitCommitHash.substring(0, 7)}` : '⚠️ No Git',
                        detail: `📅 ${new Date(cp.timestamp).toLocaleString()} | 📁 ${cp.changedFiles.length} files`,
                        checkpoint: cp
                    })),
                    { placeHolder: 'Select a checkpoint to rollback to' }
                );

                if (!selected) { return; }
                checkpointId = selected.checkpoint.id;
            }

            // Verify checkpoint exists
            const checkpoint = checkpointManager.getCheckpoint(checkpointId);
            if (!checkpoint) {
                const action = await vscode.window.showErrorMessage(
                    'Checkpoint not found. It may have been cleaned up. Use Time Machine instead?',
                    'Open Time Machine',
                    'Cancel'
                );
                if (action === 'Open Time Machine') {
                    await vscode.commands.executeCommand('vibeCodeGuardian.timeMachine');
                }
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                '⚠️ Rollback will revert all changes since this checkpoint.',
                { modal: true },
                'Rollback',
                'Cancel'
            );

            if (confirm === 'Rollback' && checkpointId) {
                try {
                    // Skip confirmation in rollbackManager since we already confirmed here
                    const result = await rollbackManager.rollback(checkpointId, { skipConfirmation: true });
                    if (result.success) {
                        vscode.window.showInformationMessage(`✅ Rolled back! ${result.filesRestored.length} files restored.`);
                        treeProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage(`Rollback failed: ${result.message}`);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Rollback failed: ${error}`);
                }
            }
        })
    );

    // View Checkpoint Diff
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.viewDiff', async (item?: TimelineItem) => {
            let checkpointId: string | undefined;

            if (item && item.checkpointId) {
                checkpointId = item.checkpointId;
            } else {
                const checkpoints = checkpointManager.getCheckpoints();
                if (checkpoints.length === 0) {
                    vscode.window.showWarningMessage('No checkpoints available.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    checkpoints.map(cp => ({
                        label: cp.name,
                        description: cp.description || '',
                        checkpoint: cp
                    })),
                    { placeHolder: 'Select a checkpoint to view diff' }
                );

                if (!selected) { return; }
                checkpointId = selected.checkpoint.id;
            }

            if (checkpointId) {
                try {
                    await rollbackManager.showDiffViewer(checkpointId);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
                }
            }
        })
    );

    // Show Checkpoint Details (clicked from tree view)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showCheckpointDetails', async (checkpointId: string) => {
            const checkpoint = checkpointManager.getCheckpoint(checkpointId);
            if (!checkpoint) {
                vscode.window.showWarningMessage('Checkpoint not found.');
                return;
            }

            const items = [
                { label: '$(history) Rollback to this checkpoint', action: 'rollback' },
                { label: '$(diff) View changes since checkpoint', action: 'diff' },
                { label: '$(star) Toggle star', action: 'star' },
                { label: '$(trash) Delete checkpoint', action: 'delete' }
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${checkpoint.name} - ${new Date(checkpoint.timestamp).toLocaleString()}`
            });

            if (selected) {
                switch (selected.action) {
                    case 'rollback':
                        vscode.commands.executeCommand('vibeCodeGuardian.rollback', { checkpointId });
                        break;
                    case 'diff':
                        await rollbackManager.showDiffViewer(checkpointId);
                        break;
                    case 'star':
                        await checkpointManager.toggleStarred(checkpointId);
                        treeProvider.refresh();
                        break;
                    case 'delete':
                        vscode.commands.executeCommand('vibeCodeGuardian.deleteCheckpoint', { checkpointId });
                        break;
                }
            }
        })
    );

    // Open Changed File (click from tree view - open file directly in editor)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.openChangedFile', async (checkpointIdOrItem: string | TimelineItem, filePath?: string) => {
            try {
                let resolvedFilePath: string | undefined;

                if (typeof checkpointIdOrItem === 'string') {
                    // Called with (checkpointId, filePath) arguments
                    resolvedFilePath = filePath;
                } else if (checkpointIdOrItem && 'checkpointId' in checkpointIdOrItem) {
                    // Called with TimelineItem from context menu
                    resolvedFilePath = checkpointIdOrItem.description as string;
                }

                if (!resolvedFilePath) {
                    vscode.window.showWarningMessage('Cannot open file: file path not found.');
                    return;
                }

                // Resolve to absolute path
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return;
                }

                const absolutePath = resolvedFilePath.startsWith('/')
                    ? resolvedFilePath
                    : vscode.Uri.joinPath(workspaceFolder.uri, resolvedFilePath).fsPath;

                const fileUri = vscode.Uri.file(absolutePath);

                // Check if file exists
                try {
                    await vscode.workspace.fs.stat(fileUri);
                    await vscode.window.showTextDocument(fileUri, { preview: true });
                } catch {
                    // File doesn't exist (maybe deleted), show from git history
                    const checkpointId = typeof checkpointIdOrItem === 'string' 
                        ? checkpointIdOrItem 
                        : checkpointIdOrItem.checkpointId;

                    if (checkpointId) {
                        const checkpoint = checkpointManager.getCheckpoint(checkpointId);
                        if (checkpoint?.gitCommitHash) {
                            const content = await gitManager.getFileAtCommit(absolutePath, checkpoint.gitCommitHash);
                            if (content) {
                                const doc = await vscode.workspace.openTextDocument({
                                    content,
                                    language: resolvedFilePath.split('.').pop() || 'plaintext'
                                });
                                await vscode.window.showTextDocument(doc, { preview: true });
                                return;
                            }
                        }
                    }
                    vscode.window.showWarningMessage(`File not found: ${resolvedFilePath}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${error}`);
            }
        })
    );

    // Show File Diff (show side-by-side diff for a specific file)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showFileDiff', async (checkpointIdOrItem: string | TimelineItem, filePath?: string) => {
            try {
                let resolvedCheckpointId: string | undefined;
                let resolvedFilePath: string | undefined;

                if (typeof checkpointIdOrItem === 'string') {
                    // Called with (checkpointId, filePath) arguments
                    resolvedCheckpointId = checkpointIdOrItem;
                    resolvedFilePath = filePath;
                } else if (checkpointIdOrItem && 'checkpointId' in checkpointIdOrItem) {
                    // Called with TimelineItem from context menu
                    resolvedCheckpointId = checkpointIdOrItem.checkpointId;
                    resolvedFilePath = checkpointIdOrItem.description as string;
                }

                if (!resolvedCheckpointId || !resolvedFilePath) {
                    vscode.window.showWarningMessage('Cannot show diff: missing checkpoint or file information.');
                    return;
                }

                const checkpoint = checkpointManager.getCheckpoint(resolvedCheckpointId);
                if (!checkpoint) {
                    vscode.window.showWarningMessage('Cannot show diff: checkpoint not found.');
                    return;
                }

                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return;
                }

                const absolutePath = resolvedFilePath.startsWith('/')
                    ? resolvedFilePath
                    : vscode.Uri.joinPath(workspaceFolder.uri, resolvedFilePath).fsPath;

                const normalizePath = (p: string) => p.replace(/\\/g, '/');
                const workspaceRoot = normalizePath(workspaceFolder.uri.fsPath);
                const normalizedResolvedPath = normalizePath(resolvedFilePath);
                const normalizedAbsolutePath = normalizePath(absolutePath);
                const normalizedRelativePath = normalizedResolvedPath.startsWith('/')
                    ? normalizedResolvedPath.replace(`${workspaceRoot}/`, '')
                    : normalizedResolvedPath;

                const fileSnapshot = checkpoint.changedFiles.find((f) => {
                    const checkpointPath = normalizePath(f.path);
                    return checkpointPath === normalizedResolvedPath ||
                        checkpointPath === normalizedAbsolutePath ||
                        checkpointPath === normalizedRelativePath ||
                        checkpointPath.endsWith(`/${normalizedRelativePath}`);
                });

                // Fallback for checkpoints without Git commit: use stored snapshot/current file content.
                if (!checkpoint.gitCommitHash) {
                    let fallbackCurrentContent = '';
                    try {
                        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                        fallbackCurrentContent = Buffer.from(bytes).toString('utf8');
                    } catch {
                        // keep empty if file cannot be read (deleted/missing)
                    }

                    const beforeContent = fileSnapshot?.previousContent ?? '';
                    const afterContent = fileSnapshot?.currentContent ?? fallbackCurrentContent;

                    const beforeDoc = await vscode.workspace.openTextDocument({
                        content: beforeContent,
                        language: resolvedFilePath.split('.').pop() || 'plaintext'
                    });
                    const afterDoc = await vscode.workspace.openTextDocument({
                        content: afterContent,
                        language: resolvedFilePath.split('.').pop() || 'plaintext'
                    });

                    const fileName = resolvedFilePath.split('/').pop() || resolvedFilePath;
                    await vscode.commands.executeCommand('vscode.diff',
                        beforeDoc.uri,
                        afterDoc.uri,
                        `${fileName} (snapshot ↔ current)`,
                        { preview: true }
                    );
                    return;
                }

                // Use VS Code's built-in diff editor
                // Show diff between parent commit (before) and this commit (after)
                const commitHash = checkpoint.gitCommitHash;
                const parentCommit = `${commitHash}~1`;

                // Get file content at both commits
                const beforeContent = await gitManager.getFileAtCommit(absolutePath, parentCommit) ?? '';
                const afterContent = await gitManager.getFileAtCommit(absolutePath, commitHash) ?? '';

                // Create virtual documents for diff view
                const beforeDoc = await vscode.workspace.openTextDocument({
                    content: beforeContent,
                    language: resolvedFilePath.split('.').pop() || 'plaintext'
                });
                const afterDoc = await vscode.workspace.openTextDocument({
                    content: afterContent,
                    language: resolvedFilePath.split('.').pop() || 'plaintext'
                });

                const fileName = resolvedFilePath.split('/').pop() || resolvedFilePath;
                const shortHash = commitHash.substring(0, 8);

                await vscode.commands.executeCommand('vscode.diff',
                    beforeDoc.uri,
                    afterDoc.uri,
                    `${fileName} (${shortHash}~1 ↔ ${shortHash})`,
                    { preview: true }
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to show file diff: ${error}`);
            }
        })
    );

    // Delete Checkpoint
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.deleteCheckpoint', async (item?: TimelineItem | { checkpointId: string }) => {
            let checkpointId: string | undefined;
            
            if (item && 'checkpointId' in item) {
                checkpointId = item.checkpointId;
            }

            if (!checkpointId) {
                vscode.window.showWarningMessage('Please select a checkpoint to delete.');
                return;
            }

            const checkpoint = checkpointManager.getCheckpoint(checkpointId);
            const name = checkpoint?.name || 'this checkpoint';

            const confirm = await vscode.window.showWarningMessage(
                `Delete checkpoint "${name}"?`,
                { modal: true },
                'Delete',
                'Cancel'
            );

            if (confirm === 'Delete') {
                try {
                    await checkpointManager.deleteCheckpoint(checkpointId);
                    vscode.window.showInformationMessage('🗑️ Checkpoint deleted.');
                    treeProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete: ${error}`);
                }
            }
        })
    );

    // Start New Session
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.startSession', async () => {
            const name = await vscode.window.showInputBox({
                prompt: '🎮 Enter session name',
                placeHolder: 'e.g., Feature: User Authentication'
            });

            if (name) {
                try {
                    const session = await checkpointManager.startSession(name);
                    vscode.window.showInformationMessage(`🎮 New session started: ${session.name}`);
                    treeProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to start session: ${error}`);
                }
            }
        })
    );

    // End Current Session
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.endSession', async () => {
            try {
                await checkpointManager.endSession();
                vscode.window.showInformationMessage('🏁 Session ended.');
                treeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to end session: ${error}`);
            }
        })
    );

    // Refresh Tree View
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.refresh', () => {
            treeProvider.refresh();
        })
    );

    // Toggle Auto-Save
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleAutoSave', async () => {
            const settings = checkpointManager.getSettings();
            const newValue = settings.autoSaveInterval === 0 ? 300 : 0;
            await checkpointManager.updateSettings({ autoSaveInterval: newValue });
            vscode.window.showInformationMessage(
                newValue > 0 ? '⏰ Auto-save enabled' : '⏸️ Auto-save disabled'
            );
        })
    );

    // Show All Sessions
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showSessions', async () => {
            const sessions = checkpointManager.getSessions();
            if (sessions.length === 0) {
                vscode.window.showInformationMessage('No sessions found.');
                return;
            }

            await vscode.window.showQuickPick(
                sessions.map(s => ({
                    label: `${s.isActive ? '🟢' : '⚪'} ${s.name}`,
                    description: `${s.checkpointIds.length} checkpoints`,
                    detail: `Started: ${new Date(s.startTime).toLocaleString()}`
                })),
                { placeHolder: 'View session details' }
            );
        })
    );

    // Open Settings
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'vibeCodeGuardian');
        })
    );

    // Initialize Git Repository
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.initGit', async () => {
            const success = await gitManager.initializeRepository();
            if (success) {
                treeProvider.refresh();
            }
        })
    );

    // Show Project Info
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showProjectInfo', async () => {
            const projectInfo = await gitManager.detectProjectType();
            const gitStatus = await gitManager.isGitRepository();
            
            const items = [
                `📁 Project: ${projectInfo.name}`,
                `🔧 Type: ${projectInfo.type}`,
                projectInfo.framework ? `📦 Framework: ${projectInfo.framework}` : null,
                projectInfo.packageManager ? `📋 Package Manager: ${projectInfo.packageManager}` : null,
                `${gitStatus ? '✅' : '❌'} Git Repository: ${gitStatus ? 'Yes' : 'No'}`,
                `${projectInfo.hasGitignore ? '✅' : '❌'} .gitignore: ${projectInfo.hasGitignore ? 'Present' : 'Missing'}`,
                gitManager.isGitInstalled() ? `🔧 Git Version: ${gitManager.getGitVersion()}` : '❌ Git: Not Installed'
            ].filter(Boolean);

            await vscode.window.showQuickPick(items as string[], {
                placeHolder: 'Project Information',
                canPickMany: false
            });
        })
    );

    // Time Machine - Rollback to any point in Git history
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.timeMachine', async () => {
            try {
                // Debug: Check if gitManager is working
                const isGitRepo = await gitManager.isGitRepository();
                if (!isGitRepo) {
                    vscode.window.showErrorMessage('Not a Git repository. Please initialize Git first.');
                    return;
                }

                const commits = await gitManager.getCommitHistory(50);
                if (commits.length === 0) {
                    vscode.window.showWarningMessage('No commit history found.');
                    return;
                }

                const items = commits.map(commit => ({
                    label: `$(git-commit) ${commit.hash.substring(0, 7)}`,
                    description: commit.message.substring(0, 60),
                    detail: `${new Date(commit.date).toLocaleString()} by ${commit.author}`,
                    commit: commit
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: '🕐 Select a point in time to rollback to',
                    title: 'Time Machine - Git History',
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (!selected) {
                    return;
                }

                // Confirm rollback
                const confirm = await vscode.window.showWarningMessage(
                    `Rollback to "${selected.commit.message.substring(0, 40)}..."?`,
                    { modal: true, detail: 'This will switch to this commit. You can return to latest anytime.' },
                    'Rollback',
                    'Cancel'
                );

                if (confirm !== 'Rollback') {
                    return;
                }

                // Perform rollback directly using gitManager.checkoutCommit
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Time traveling...',
                    cancellable: false
                }, async () => {
                    const success = await gitManager.checkoutCommit(selected.commit.hash);
                    
                    if (success) {
                        // Refresh all open editors
                        for (const editor of vscode.window.visibleTextEditors) {
                            const doc = editor.document;
                            if (doc.uri.scheme === 'file') {
                                await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri);
                            }
                        }
                        vscode.window.showInformationMessage(
                            `✅ Traveled to ${selected.commit.hash.substring(0, 7)}! Use "Return to Latest" to go back.`
                        );
                        treeProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage('❌ Git checkout failed. Check if there are uncommitted changes.');
                    }
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Time Machine failed: ${error}`);
            }
        })
    );

    // Manual state capture
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.captureState', async () => {
            const description = await vscode.window.showInputBox({
                prompt: 'Enter a description for this state (optional)',
                placeHolder: 'e.g., Before refactoring'
            });

            const snapshot = await stateMonitor.captureState(description || undefined);
            if (snapshot) {
                vscode.window.showInformationMessage(`📌 State captured: ${snapshot.commitHash.substring(0, 7)}`);
                treeProvider.refresh();
            } else if (checkpointManager.getSettings().trackingMode === 'local-only') {
                const changedFiles = await getChangedFilesForCheckpoint();
                const checkpoint = await checkpointManager.createCheckpoint(
                    CheckpointType.Manual,
                    CheckpointSource.User,
                    changedFiles,
                    { description: description || 'Local state snapshot' }
                );
                if (checkpoint) {
                    vscode.window.showInformationMessage(`📦 Local state captured: ${checkpoint.name}`);
                    treeProvider.refresh();
                } else {
                    vscode.window.showWarningMessage('No changes to capture.');
                }
            } else {
                vscode.window.showWarningMessage('No changes to capture.');
            }
        })
    );

    // Show Timeline / Focus on checkpoint explorer view
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showTimeline', async () => {
            // Focus on the Vibe Code Guardian view container in the activity bar
            await vscode.commands.executeCommand('workbench.view.extension.vibeCodeGuardian');
            // Optionally also reveal the checkpoint explorer
            await vscode.commands.executeCommand('vibeCodeGuardian.checkpointExplorer.focus');
        })
    );

    // Cleanup Invalid History
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.cleanupHistory', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'This will remove checkpoints with missing git commits or inaccessible files. Continue?',
                { modal: true },
                'Yes, Cleanup',
                'Cancel'
            );

            if (confirm !== 'Yes, Cleanup') {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Cleaning up invalid history...',
                cancellable: false
            }, async () => {
                const result = await checkpointManager.cleanupInvalidCheckpoints();
                
                if (result.removed > 0) {
                    vscode.window.showInformationMessage(
                        `✅ Cleaned up ${result.removed} invalid checkpoint(s).`
                    );
                    // Show details in output channel
                    const outputChannel = vscode.window.createOutputChannel('Vibe Guardian Cleanup');
                    outputChannel.appendLine('Cleanup Details:');
                    result.details.forEach(d => outputChannel.appendLine(`  - ${d}`));
                    outputChannel.show();
                } else {
                    vscode.window.showInformationMessage('✅ No invalid checkpoints found.');
                }
                
                treeProvider.refresh();
            });
        })
    );

    // Clear All History (Reset)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.clearAllHistory', async () => {
            const confirm = await vscode.window.showWarningMessage(
                '⚠️ This will DELETE ALL checkpoint history. This action cannot be undone!',
                { modal: true },
                'Yes, Clear All',
                'Cancel'
            );

            if (confirm !== 'Yes, Clear All') {
                return;
            }

            // Double confirmation for safety
            const doubleConfirm = await vscode.window.showWarningMessage(
                'Are you absolutely sure? All checkpoints and sessions will be permanently deleted.',
                { modal: true },
                'DELETE EVERYTHING',
                'Cancel'
            );

            if (doubleConfirm !== 'DELETE EVERYTHING') {
                return;
            }

            await checkpointManager.clearAllData();
            vscode.window.showInformationMessage('🗑️ All history cleared. Starting fresh!');
            treeProvider.refresh();
        })
    );

    // Debug: Show Checkpoint Details
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.debugShowCheckpoints', async () => {
            const checkpoints = checkpointManager.getCheckpoints();
            
            if (checkpoints.length === 0) {
                vscode.window.showInformationMessage('No checkpoints found.');
                return;
            }

            const output = vscode.window.createOutputChannel('Vibe Guardian Debug');
            output.clear();
            output.appendLine('=== Checkpoint Debug Info ===\n');
            output.appendLine(`Total checkpoints: ${checkpoints.length}\n`);
            
            for (const cp of checkpoints) {
                output.appendLine(`--- ${cp.name} ---`);
                output.appendLine(`  ID: ${cp.id}`);
                output.appendLine(`  Timestamp: ${new Date(cp.timestamp).toLocaleString()}`);
                output.appendLine(`  Git Commit: ${cp.gitCommitHash || 'NONE'}`);
                output.appendLine(`  Type: ${cp.type}`);
                output.appendLine(`  Source: ${cp.source}`);
                output.appendLine(`  Changed Files: ${cp.changedFiles.length}`);
                for (const f of cp.changedFiles) {
                    output.appendLine(`    - ${f.path} (${f.changeType})`);
                }
                output.appendLine('');
            }

            // Also show Git history for comparison
            output.appendLine('\n=== Git Commit History (last 10) ===\n');
            const commits = await gitManager.getCommitHistory(10);
            for (const commit of commits) {
                output.appendLine(`${commit.hash.substring(0, 7)} - ${commit.message}`);
            }

            output.show();
        })
    );

    // Sync Checkpoints with Git
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.syncWithGit', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing checkpoints with Git...',
                cancellable: false
            }, async () => {
                const result = await checkpointManager.syncWithGit();
                
                vscode.window.showInformationMessage(
                    `🔄 Sync complete! Found ${result.synced} commits, added ${result.added}, removed ${result.removed}.`
                );
                
                treeProvider.refresh();
            });
        })
    );

    // Return to Latest State
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.returnToLatest', async () => {
            const headInfo = await gitManager.getHeadInfo();
            
            if (!headInfo.isDetached) {
                vscode.window.showInformationMessage('You are already at the latest state.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Returning to latest state...',
                cancellable: false
            }, async () => {
                // Try to find the main branch
                const branches = ['master', 'main'];
                let success = false;
                
                for (const branch of branches) {
                    if (await gitManager.checkoutBranch(branch)) {
                        success = true;
                        break;
                    }
                }

                if (success) {
                    vscode.window.showInformationMessage('✅ Returned to latest state!');
                    treeProvider.refresh();
                } else {
                    vscode.window.showErrorMessage('Failed to return to main branch.');
                }
            });
        })
    );

    // Time Travel to Specific Point
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.timeTravelTo', async () => {
            // Get all checkpoints with Git commits
            const checkpoints = checkpointManager.getCheckpoints()
                .filter(cp => cp.gitCommitHash);
            
            if (checkpoints.length === 0) {
                vscode.window.showWarningMessage('No checkpoints with Git history found.');
                return;
            }

            const items = checkpoints.map(cp => ({
                label: cp.name,
                description: new Date(cp.timestamp).toLocaleString(),
                detail: `Commit: ${cp.gitCommitHash?.substring(0, 7)}`,
                checkpoint: cp
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a checkpoint to travel to',
                title: '🕐 Time Travel'
            });

            if (!selected) {
                return;
            }

            const result = await rollbackManager.rollback(selected.checkpoint.id, { skipConfirmation: true });
            
            if (result.success) {
                vscode.window.showInformationMessage(result.message);
                treeProvider.refresh();
            } else {
                vscode.window.showErrorMessage(`Time travel failed: ${result.message}`);
            }
        })
    );

    // Show Current Position in History
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showCurrentPosition', async () => {
            const headInfo = await gitManager.getHeadInfo();
            
            if (headInfo.isDetached) {
                const commitHistory = await gitManager.getCommitHistory(1);
                const currentMessage = commitHistory.length > 0 ? commitHistory[0].message : 'Unknown';
                
                const action = await vscode.window.showInformationMessage(
                    `📍 Current Position: Detached HEAD at ${headInfo.currentCommit.substring(0, 7)}\n\nCommit: ${currentMessage}`,
                    'Return to Latest',
                    'Stay Here'
                );
                
                if (action === 'Return to Latest') {
                    await vscode.commands.executeCommand('vibeCodeGuardian.returnToLatest');
                }
            } else {
                vscode.window.showInformationMessage(
                    `📍 Current Position: Branch "${headInfo.branch}" at ${headInfo.currentCommit.substring(0, 7)}`
                );
            }
        })
    );

    // Toggle Commit Language

    // Open Guardian Panel (replaces individual status bar buttons)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.openGuardianPanel', () => {
            showGuardianPanel();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleCommitLanguage', async () => {
            const settings = checkpointManager.getSettings();
            const nextLanguage = getNextLanguage(settings.commitLanguage);
            await checkpointManager.updateSettings({ commitLanguage: nextLanguage });
            const displayName = getLanguageDisplayName(nextLanguage);
            vscode.window.showInformationMessage(`🌐 Commit language changed to: ${displayName}`);
        })
    );

    // Toggle Notification Level
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleNotificationLevel', async () => {
            const settings = checkpointManager.getSettings();
            const nextLevel = getNextNotificationLevel(settings.notificationLevel);
            await checkpointManager.updateSettings({ notificationLevel: nextLevel });
            const displayName = getNotificationLevelDisplayName(nextLevel);
            vscode.window.showInformationMessage(`🔔 Notification level changed to: ${displayName}`);
        })
    );

    // Toggle Push Strategy
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.togglePushStrategy', async () => {
            const settings = checkpointManager.getSettings();
            const nextStrategy = getNextPushStrategy(settings.pushStrategy);
            await checkpointManager.updateSettings({ pushStrategy: nextStrategy });
            const displayName = getPushStrategyDisplayName(nextStrategy);
            vscode.window.showInformationMessage(`📤 Push strategy changed to: ${displayName}`);
        })
    );

    // Toggle Tracking Mode
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleTrackingMode', async () => {
            const settings = checkpointManager.getSettings();
            const nextMode = getNextTrackingMode(settings.trackingMode);
            await checkpointManager.updateSettings({ trackingMode: nextMode });
            applyRuntimeSettings(context);

            const displayName = getTrackingModeDisplayName(nextMode);
            const detail = nextMode === 'local-only'
                ? 'Plugin Git commits are disabled. Checkpoints stay local and rollback uses file snapshots.'
                : 'Plugin Git commits are enabled again. Automatic checkpoints can create local Git history.';
            vscode.window.showInformationMessage(`${displayName}: ${detail}`);
        })
    );

    // Toggle Milestone Enable/Disable
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleMilestone', async () => {
            const settings = checkpointManager.getSettings();
            const nextEnabled = !settings.milestoneEnabled;
            await checkpointManager.updateSettings({ milestoneEnabled: nextEnabled });
            updateGuardianInfoStatusBar();

            if (!nextEnabled) {
                vscode.window.showInformationMessage(
                    '🎯 Milestone OFF. To enable again, click status bar "🎯 OFF" or run "Vibe Guardian: Toggle Milestone".'
                );
                return;
            }

            vscode.window.showInformationMessage(
                '🎯 Milestone ON. Start with "Vibe Guardian: Start Milestone" (Cmd+Alt+M). Use the same status bar button to turn it off.'
            );
        })
    );

    // ============================================
    // Git Graph Commands
    // ============================================

    // ============================================
    // Milestone Commands
    // ============================================

    // Start Milestone
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.startMilestone', async () => {
            if (!isMilestoneEnabled()) {
                await showMilestoneDisabledGuidance();
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: '🎯 Milestone name (WHAT you are doing)',
                placeHolder: 'e.g., Add user authentication'
            });
            if (!name) { return; }

            const intent = await vscode.window.showInputBox({
                prompt: '💡 Intent (WHY this change is needed)',
                placeHolder: 'e.g., Users need to log in before accessing paid content'
            });
            if (!intent) { return; }

            const description = await vscode.window.showInputBox({
                prompt: '📝 Additional context (optional)',
                placeHolder: 'e.g., Uses JWT tokens, OAuth2 flow with Google'
            });

            const milestone = await checkpointManager.startMilestone(name, intent, {
                description: description || undefined
            });
            updateGuardianInfoStatusBar(milestone.name);
            await checkpointManager.exportIntentFile();
            vscode.window.showInformationMessage(`🎯 Milestone started: ${milestone.name}`);
            treeProvider.refresh();
        })
    );

    // Complete Milestone
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.completeMilestone', async () => {
            const active = checkpointManager.getActiveMilestone();
            if (!active) {
                // Let user pick from active milestones
                const milestones = checkpointManager.getMilestones(MilestoneStatus.Active);
                if (milestones.length === 0) {
                    vscode.window.showWarningMessage('No active milestones.');
                    return;
                }
                const selected = await vscode.window.showQuickPick(
                    milestones.map(m => ({
                        label: m.name,
                        description: m.intent,
                        detail: `${m.checkpointIds.length} checkpoints · ${m.changedFiles.length} files`,
                        milestoneId: m.id
                    })),
                    { placeHolder: 'Select a milestone to complete' }
                );
                if (!selected) { return; }

                const createCommit = await vscode.window.showQuickPick(
                    [
                        { label: '$(git-commit) Create Git commit', description: 'Squash into a single meaningful commit', value: true },
                        { label: '$(archive) Keep local only', description: 'No Git commit, local snapshot only', value: false }
                    ],
                    { placeHolder: 'How to record this milestone?' }
                );
                if (!createCommit) { return; }

                const result = await checkpointManager.completeMilestone(selected.milestoneId, {
                    createGitCommit: createCommit.value
                });
                if (result) {
                    await checkpointManager.exportIntentFile();
                    vscode.window.showInformationMessage(
                        `✅ Milestone completed: ${result.milestone.name}` +
                        (result.gitCommitHash ? ` (${result.gitCommitHash.substring(0, 7)})` : '')
                    );
                }
            } else {
                const createCommit = await vscode.window.showQuickPick(
                    [
                        { label: '$(git-commit) Create Git commit', description: 'Squash into a single meaningful commit', value: true },
                        { label: '$(archive) Keep local only', description: 'No Git commit, local snapshot only', value: false }
                    ],
                    { placeHolder: `Complete "${active.name}" — How to record?` }
                );
                if (!createCommit) { return; }

                const result = await checkpointManager.completeMilestone(undefined, {
                    createGitCommit: createCommit.value
                });
                if (result) {
                    await checkpointManager.exportIntentFile();
                    vscode.window.showInformationMessage(
                        `✅ Milestone completed: ${result.milestone.name}` +
                        (result.gitCommitHash ? ` (${result.gitCommitHash.substring(0, 7)})` : '')
                    );
                }
            }
            updateGuardianInfoStatusBar();
            treeProvider.refresh();
        })
    );

    // Abandon Milestone
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.abandonMilestone', async () => {
            const active = checkpointManager.getActiveMilestone();
            const milestones = active
                ? [active]
                : checkpointManager.getMilestones(MilestoneStatus.Active);

            if (milestones.length === 0) {
                vscode.window.showWarningMessage('No active milestones.');
                return;
            }

            let targetId: string;
            if (milestones.length === 1) {
                targetId = milestones[0].id;
            } else {
                const selected = await vscode.window.showQuickPick(
                    milestones.map(m => ({ label: m.name, description: m.intent, id: m.id })),
                    { placeHolder: 'Select a milestone to abandon' }
                );
                if (!selected) { return; }
                targetId = selected.id;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Abandon milestone "${milestones.find(m => m.id === targetId)?.name}"? Checkpoints will be kept.`,
                { modal: true },
                'Abandon',
                'Cancel'
            );
            if (confirm !== 'Abandon') { return; }

            const result = await checkpointManager.abandonMilestone(targetId);
            if (result) {
                vscode.window.showInformationMessage(`🚫 Milestone abandoned: ${result.name}`);
            }
            updateGuardianInfoStatusBar();
            treeProvider.refresh();
        })
    );

    // Show Milestones
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showMilestones', async () => {
            if (!isMilestoneEnabled()) {
                await showMilestoneDisabledGuidance();
                return;
            }

            const milestones = checkpointManager.getMilestones();
            if (milestones.length === 0) {
                const action = await vscode.window.showInformationMessage(
                    'No milestones yet. Start one to associate your intent with code changes.',
                    'Start Milestone'
                );
                if (action === 'Start Milestone') {
                    await vscode.commands.executeCommand('vibeCodeGuardian.startMilestone');
                }
                return;
            }

            const statusIcon = (s: MilestoneStatus) =>
                s === MilestoneStatus.Active ? '🟢' : s === MilestoneStatus.Completed ? '✅' : '🚫';

            const items = milestones.map(m => ({
                label: `${statusIcon(m.status)} ${m.name}`,
                description: m.intent,
                detail: `${m.checkpointIds.length} checkpoints · ${m.changedFiles.length} files · ${new Date(m.createdAt).toLocaleString()}`,
                milestoneId: m.id
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Browse milestones',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selected) { return; }

            const milestone = checkpointManager.getMilestone(selected.milestoneId);
            if (!milestone) { return; }

            const actions = [
                { label: '$(list-tree) View checkpoints', action: 'checkpoints' },
                ...(milestone.status === MilestoneStatus.Active
                    ? [
                        { label: '$(check) Complete', action: 'complete' },
                        { label: '$(close) Abandon', action: 'abandon' },
                        { label: '$(edit) Edit intent', action: 'edit' }
                    ]
                    : []),
                { label: '$(trash) Delete', action: 'delete' }
            ];

            const action = await vscode.window.showQuickPick(actions, {
                placeHolder: `${milestone.name} — ${milestone.intent}`
            });

            if (!action) { return; }
            switch (action.action) {
                case 'checkpoints': {
                    const cps = checkpointManager.getMilestoneCheckpoints(milestone.id);
                    if (cps.length === 0) {
                        vscode.window.showInformationMessage('No checkpoints in this milestone yet.');
                    } else {
                        const cpItems = cps.map(cp => ({
                            label: cp.name,
                            description: `${cp.changedFiles.length} files`,
                            detail: new Date(cp.timestamp).toLocaleString()
                        }));
                        await vscode.window.showQuickPick(cpItems, {
                            placeHolder: `Checkpoints in "${milestone.name}"`
                        });
                    }
                    break;
                }
                case 'complete':
                    await vscode.commands.executeCommand('vibeCodeGuardian.completeMilestone');
                    break;
                case 'abandon':
                    await vscode.commands.executeCommand('vibeCodeGuardian.abandonMilestone');
                    break;
                case 'edit': {
                    const newIntent = await vscode.window.showInputBox({
                        prompt: 'Update intent',
                        value: milestone.intent
                    });
                    if (newIntent) {
                        await checkpointManager.updateMilestone(milestone.id, { intent: newIntent });
                        vscode.window.showInformationMessage(`Updated intent for "${milestone.name}"`);
                    }
                    break;
                }
                case 'delete': {
                    const confirmDel = await vscode.window.showWarningMessage(
                        `Delete milestone "${milestone.name}"? Checkpoints will be kept.`,
                        { modal: true }, 'Delete', 'Cancel'
                    );
                    if (confirmDel === 'Delete') {
                        await checkpointManager.deleteMilestone(milestone.id);
                        vscode.window.showInformationMessage('Milestone deleted.');
                        treeProvider.refresh();
                    }
                    break;
                }
            }
        })
    );

    // Rollback to Before Milestone  
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.rollbackToMilestone', async (item?: import('./timelineTreeProvider').TimelineItem) => {
            let milestoneId: string | undefined = item?.milestoneId;

            if (!milestoneId) {
                const milestones = checkpointManager.getMilestones();
                if (milestones.length === 0) {
                    vscode.window.showWarningMessage('No milestones yet.');
                    return;
                }
                const statusIcon = (s: MilestoneStatus) =>
                    s === MilestoneStatus.Active ? '🟢' : s === MilestoneStatus.Completed ? '✅' : '🚫';
                const selected = await vscode.window.showQuickPick(
                    milestones.map(m => ({
                        label: `${statusIcon(m.status)} ${m.name}`,
                        description: m.intent,
                        detail: `${m.checkpointIds.length} checkpoints · ${m.changedFiles.length} files`,
                        milestoneId: m.id
                    })),
                    { placeHolder: 'Select a milestone to rollback to (before it started)' }
                );
                if (!selected) { return; }
                milestoneId = selected.milestoneId;
            }

            try {
                const result = await rollbackManager.rollbackToMilestone(milestoneId);
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    treeProvider.refresh();
                } else if (result.message !== 'Cancelled') {
                    vscode.window.showErrorMessage(`Rollback failed: ${result.message}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Rollback failed: ${error}`);
            }
        })
    );

    // Show Milestone Details (invoked from timeline tree item click)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showMilestoneDetails', async (milestoneId: string) => {
            const milestone = checkpointManager.getMilestone(milestoneId);
            if (!milestone) {
                vscode.window.showWarningMessage('Milestone not found.');
                return;
            }

            const isActive = milestone.status === MilestoneStatus.Active;
            const actions = [
                ...(isActive ? [
                    { label: '$(check) Complete milestone', action: 'complete' },
                    { label: '$(discard) Rollback to before this milestone', action: 'rollback' },
                    { label: '$(close) Abandon', action: 'abandon' },
                    { label: '$(edit) Edit intent', action: 'edit' }
                ] : [
                    { label: '$(discard) Rollback to before this milestone', action: 'rollback' }
                ]),
                { label: '$(trash) Delete', action: 'delete' }
            ];

            const selected = await vscode.window.showQuickPick(actions, {
                placeHolder: `🎯 ${milestone.name} — ${milestone.intent}`
            });
            if (!selected) { return; }

            switch (selected.action) {
                case 'complete':
                    await vscode.commands.executeCommand('vibeCodeGuardian.completeMilestone');
                    break;
                case 'rollback':
                    await vscode.commands.executeCommand('vibeCodeGuardian.rollbackToMilestone', { milestoneId });
                    break;
                case 'abandon':
                    await vscode.commands.executeCommand('vibeCodeGuardian.abandonMilestone');
                    break;
                case 'edit': {
                    const newIntent = await vscode.window.showInputBox({
                        prompt: 'Update intent (WHY)',
                        value: milestone.intent
                    });
                    if (newIntent) {
                        await checkpointManager.updateMilestone(milestone.id, { intent: newIntent });
                        await checkpointManager.exportIntentFile();
                        treeProvider.refresh();
                    }
                    break;
                }
                case 'delete': {
                    const confirmDel = await vscode.window.showWarningMessage(
                        `Delete milestone "${milestone.name}"? Checkpoints will be kept.`,
                        { modal: true }, 'Delete', 'Cancel'
                    );
                    if (confirmDel === 'Delete') {
                        await checkpointManager.deleteMilestone(milestone.id);
                        await checkpointManager.exportIntentFile();
                        treeProvider.refresh();
                    }
                    break;
                }
            }
        })
    );

    // Toggle Timeline View Mode (Milestone / Session / All)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleTimelineView', async () => {
            const modes = [
                { label: '$(target) Milestone View', description: 'Group by intent & milestone (recommended)', mode: 'milestone' as const },
                { label: '$(game) Session View', description: 'Group by coding session', mode: 'session' as const },
                { label: '$(history) All Checkpoints', description: 'Show all checkpoints by date', mode: 'all' as const },
                { label: '$(star) Starred', description: 'Only starred checkpoints', mode: 'starred' as const }
            ];
            const selected = await vscode.window.showQuickPick(modes, { placeHolder: 'Select timeline view mode' });
            if (selected) {
                treeProvider.setViewMode(selected.mode);
            }
        })
    );

    // Show Git Graph (opens WebView panel)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showGitGraph', async () => {
            await gitGraphWebview.show();
        })
    );

    // Refresh Git Graph
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.refreshGitGraph', () => {
            gitGraphTreeProvider.refresh();
            gitGraphWebview.refresh();
        })
    );

    // Toggle Graph Mode
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleGitGraphMode', async () => {
            const current = gitGraphTreeProvider.getMode();
            const newMode = current === 'guardian' ? 'full' : 'guardian';
            gitGraphTreeProvider.setMode(newMode);
            gitGraphWebview.setMode(newMode);
            vscode.window.showInformationMessage(
                `Git Graph: ${newMode === 'guardian' ? 'Guardian checkpoints only' : 'Full history'}`
            );
        })
    );

    // Show specific commit in graph (from tree view click)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.gitGraphCommitDetail', async (item?: GitGraphTreeItem | { commitHash: string }) => {
            const commitHash = item && 'commitHash' in item ? item.commitHash : undefined;
            if (commitHash) {
                await gitGraphWebview.show(commitHash);
            }
        })
    );

    // Show file diff from graph tree view
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showGitGraphFileDiff', async (commitHash?: string, filePath?: string) => {
            if (!commitHash || !filePath) { return; }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) { return; }

            const absolutePath = filePath.startsWith('/')
                ? filePath
                : vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;

            const parentCommit = `${commitHash}^`;
            const beforeContent = await gitManager.getFileAtCommit(absolutePath, parentCommit) ?? '';
            const afterContent = await gitManager.getFileAtCommit(absolutePath, commitHash) ?? '';

            const beforeDoc = await vscode.workspace.openTextDocument({
                content: beforeContent,
                language: filePath.split('.').pop() || 'plaintext'
            });
            const afterDoc = await vscode.workspace.openTextDocument({
                content: afterContent,
                language: filePath.split('.').pop() || 'plaintext'
            });

            const fileName = filePath.split('/').pop() || filePath;
            const shortHash = commitHash.substring(0, 8);

            await vscode.commands.executeCommand('vscode.diff',
                beforeDoc.uri,
                afterDoc.uri,
                `${fileName} (${shortHash}~1 ↔ ${shortHash})`,
                { preview: true }
            );
        })
    );

    // ── Git Graph multi-tab shortcuts ──────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showBranches', async () => {
            await gitGraphWebview.show(undefined, 'branches');
        }),
        vscode.commands.registerCommand('vibeCodeGuardian.showContributors', async () => {
            await gitGraphWebview.show(undefined, 'contributors');
        }),
        vscode.commands.registerCommand('vibeCodeGuardian.showStashes', async () => {
            await gitGraphWebview.show(undefined, 'stashes');
        }),
        vscode.commands.registerCommand('vibeCodeGuardian.showRemotes', async () => {
            await gitGraphWebview.show(undefined, 'remotes');
        })
    );

    // ── Inline Blame (GitLens-style current-line annotation) ─────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleBlame', () => {
            const enabled = !blameDecorator.isEnabled();
            blameDecorator.setEnabled(enabled);
            const icon = enabled ? '$(eye)' : '$(eye-closed)';
            vscode.window.showInformationMessage(
                `${icon} Git Blame ${enabled ? 'enabled' : 'disabled'}`
            );
            updateGuardianInfoStatusBar();
        })
    );

    // ── Verification Commands ─────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.runVerification', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found for verification.');
                return;
            }

            const verifier = new ProjectVerifier(gitManager);
            const results = await verifier.runComprehensiveVerification();
            ProjectVerifier.displayResults(results);
        })
    );
}

function setupEventListeners(context: vscode.ExtensionContext) {
    // Re-initialize Git when active editor changes to handle multi-root workspaces
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            gitManager.reinitializeForActiveEditor();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (!event.affectsConfiguration('vibeCodeGuardian')) {
                return;
            }

            await syncSettingsFromConfiguration();
            applyRuntimeSettings(context);
        })
    );

    // Listen for AI edit detection
    aiDetector.onAIEditDetected(async (event) => {
        const settings = checkpointManager.getSettings();
        if (settings.autoCheckpointOnAI) {
            const checkpoint = await checkpointManager.createCheckpoint(
                CheckpointType.AIGenerated,
                event.source,
                event.changedFiles,
                { description: `AI-detected changes (${event.source})` }
            );
            if (checkpoint && shouldShowNotification(settings.notificationLevel, CheckpointType.AIGenerated)) {
                await notificationManager.showInformationMessage(`🤖 AI checkpoint: ${checkpoint.name}`);
            }
            treeProvider.refresh();
        }
    });

    // Listen for ALL file changes (including user edits and new file creation)
    aiDetector.onFileChanged(async (event) => {
        console.log(`📁 File change detected: ${event.changedFiles.length} files, source: ${event.source}, isNew: ${event.isNewFile}`);
        
        const settings = checkpointManager.getSettings();
        
        // Handle user edits - create checkpoint if enabled
        if (event.source === CheckpointSource.User && settings.autoCheckpointOnUserSave) {
            // Use ChangeSignificanceAnalyzer for smart evaluation
            const significance = ChangeSignificanceAnalyzer.analyze(event.changedFiles);

            // Require significance score >= 20 (meaningful code change)
            // New files always pass (score 30+ from the analyzer)
            if (event.isNewFile || significance.score >= 20) {
                const fileNames = event.changedFiles.map(f => f.path.split('/').pop()).join(', ');
                const description = event.isNewFile 
                    ? `New file: ${fileNames}`
                    : `User edit: ${fileNames} (sig=${significance.score}: ${significance.reasons.slice(0, 2).join(', ')})`;
                
                const checkpoint = await checkpointManager.createCheckpoint(
                    event.isNewFile ? CheckpointType.Auto : CheckpointType.Manual,
                    CheckpointSource.User,
                    event.changedFiles,
                    { description }
                );
                
                if (checkpoint && shouldShowNotification(settings.notificationLevel, checkpoint.type)) {
                    await notificationManager.showInformationMessage(`💾 User checkpoint: ${checkpoint.name}`);
                }
                treeProvider.refresh();
            } else {
                console.log(`🔇 Skipped user checkpoint: significance=${significance.score} (threshold=20)`);
            }
        }
        
        // Notify for new files (only in 'all' mode)
        if (event.isNewFile && settings.notificationLevel === 'all') {
            const fileNames = event.changedFiles.map(f => f.path.split('/').pop()).join(', ');
            console.log(`📁 New file created: ${fileNames}`);
        }
    });

    // Listen for checkpoint events
    checkpointManager.onCheckpointCreated(() => {
        treeProvider.refresh();
        gitGraphTreeProvider.refresh();
        blameDecorator?.invalidateCache();
    });
    checkpointManager.onCheckpointDeleted(() => {
        treeProvider.refresh();
        gitGraphTreeProvider.refresh();
    });
    checkpointManager.onMilestoneChanged(() => {
        treeProvider.refresh();
        gitGraphTreeProvider.refresh();
        updateGuardianInfoStatusBar();
    });
}

let autoSaveInterval: NodeJS.Timeout | undefined;

function startAutoSaveTimer(context: vscode.ExtensionContext) {
    const settings = checkpointManager.getSettings();
    
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }

    if (settings.autoSaveInterval > 0) {
        const intervalMs = settings.autoSaveInterval * 1000;
        
        autoSaveInterval = setInterval(async () => {
            const currentSettings = checkpointManager.getSettings();
            if (currentSettings.autoSaveInterval > 0) {
                try {
                    const changedFiles = await getChangedFilesForCheckpoint();
                    if (changedFiles.length > 0) {
                        const checkpoint = await checkpointManager.createCheckpoint(
                            CheckpointType.AutoSave,
                            CheckpointSource.AutoSave,
                            changedFiles
                        );
                        if (checkpoint) {
                            console.log(`⏰ Auto-save: ${checkpoint.name}`);
                            treeProvider.refresh();
                        }
                    }
                } catch (error) {
                    console.error('Auto-save failed:', error);
                }
            }
        }, intervalMs);

        context.subscriptions.push({
            dispose: () => {
                if (autoSaveInterval) {
                    clearInterval(autoSaveInterval);
                }
            }
        });
    }
}

/**
 * Creates the two consolidated Guardian status bar items.
 * Replaces the previous 6 individual status bar buttons.
 */
function createGuardianStatusBars(context: vscode.ExtensionContext) {
    // Main button — left-most, always visible, opens the Guardian panel
    guardianMainStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
    guardianMainStatusBarItem.command = 'vibeCodeGuardian.openGuardianPanel';
    guardianMainStatusBarItem.text = '$(shield) Guardian';
    guardianMainStatusBarItem.tooltip = 'Vibe Code Guardian — 点击展开功能面板';
    guardianMainStatusBarItem.show();
    context.subscriptions.push(guardianMainStatusBarItem);

    // Group management button — dedicated for milestone/group management (default action)
    guardianGroupManagementStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
    guardianGroupManagementStatusBarItem.command = 'vibeCodeGuardian.openGuardianPanel';
    guardianGroupManagementStatusBarItem.text = '$(rocket) Groups';
    guardianGroupManagementStatusBarItem.tooltip = 'Manage code groups & milestones (default action)';
    updateGuardianGroupManagementStatusBar();
    guardianGroupManagementStatusBarItem.show();
    context.subscriptions.push(guardianGroupManagementStatusBarItem);

    // Info bar — shows active milestone name and tracking mode icon
    guardianInfoStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    guardianInfoStatusBarItem.command = 'vibeCodeGuardian.openGuardianPanel';
    guardianInfoStatusBarItem.tooltip = '当前里程碑 — 点击展开功能面板';
    updateGuardianInfoStatusBar();
    guardianInfoStatusBarItem.show();
    context.subscriptions.push(guardianInfoStatusBarItem);
}

/**
 * Updates the info status bar item with the current milestone and tracking mode.
 */
function updateGuardianInfoStatusBar(activeName?: string) {
    if (!guardianInfoStatusBarItem) { return; }
    const name = activeName ?? checkpointManager?.getActiveMilestone()?.name;
    const settings = checkpointManager?.getSettings();
    const trackingIcon = settings?.trackingMode === 'full' ? '$(database)' : '$(device-floppy)';
    const milestoneEnabled = settings?.milestoneEnabled ?? true;

    if (name) {
        guardianInfoStatusBarItem.text = `$(milestone) ${name} ${trackingIcon}`;
        guardianInfoStatusBarItem.backgroundColor = undefined;
    } else if (!milestoneEnabled) {
        guardianInfoStatusBarItem.text = `$(target) OFF ${trackingIcon}`;
        guardianInfoStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        guardianInfoStatusBarItem.text = `$(milestone) 无里程碑 ${trackingIcon}`;
        guardianInfoStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

/**
 * Updates the group management status bar item with current status.
 */
function updateGuardianGroupManagementStatusBar(activeName?: string) {
    if (!guardianGroupManagementStatusBarItem) { return; }
    const name = activeName ?? checkpointManager?.getActiveMilestone()?.name;
    const settings = checkpointManager?.getSettings();
    const milestoneEnabled = settings?.milestoneEnabled ?? true;

    if (name) {
        guardianGroupManagementStatusBarItem.text = `$(rocket) ${name}`;
        guardianGroupManagementStatusBarItem.tooltip = `Active: ${name} — Manage groups & milestones`;
        guardianGroupManagementStatusBarItem.backgroundColor = undefined;
    } else if (!milestoneEnabled) {
        guardianGroupManagementStatusBarItem.text = '$(rocket) Groups (OFF)';
        guardianGroupManagementStatusBarItem.tooltip = 'Milestone tracking disabled — Manage groups & milestones';
        guardianGroupManagementStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        guardianGroupManagementStatusBarItem.text = '$(rocket) No Group';
        guardianGroupManagementStatusBarItem.tooltip = 'No active milestone — Start new group';
        guardianGroupManagementStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

/**
 * Opens the Guardian feature panel — a QuickPick acting as a vertical expandable menu.
 * Default action is milestone/group management.
 */
function showGuardianPanel() {
    const settings = checkpointManager.getSettings();
    const activeMilestone = checkpointManager.getActiveMilestone();

    interface GuardianItem extends vscode.QuickPickItem {
        action?: string;
    }

    const milestoneDesc = activeMilestone ? activeMilestone.name : '(无活跃里程碑)';
    const trackingLabel = getTrackingModeDisplayName(settings.trackingMode);
    const notifLabel = getNotificationLevelDisplayName(settings.notificationLevel);
    const pushLabel = getPushStrategyDisplayName(settings.pushStrategy);
    const langLabel = getLanguageDisplayName(settings.commitLanguage);
    const milestoneToggleLabel = settings.milestoneEnabled ? '✅ 已启用' : '⭕ 已禁用';
    const blameLabel = blameDecorator?.isEnabled() ? '✅ 已启用' : '⭕ 已禁用';

    const items: GuardianItem[] = [
        // ── 分组管理 ──────────────────────────────────
        { label: '里程碑 / 分组管理', kind: vscode.QuickPickItemKind.Separator },
        {
            label: '$(rocket) 开始新里程碑',
            description: '设定任务意图，开始代码分组追踪',
            action: 'startMilestone'
        },
        {
            label: '$(check) 完成当前里程碑',
            description: milestoneDesc,
            action: 'completeMilestone'
        },
        {
            label: '$(close) 放弃当前里程碑',
            description: milestoneDesc,
            action: 'abandonMilestone'
        },
        // ── 视图 ──────────────────────────────────────
        { label: '视图', kind: vscode.QuickPickItemKind.Separator },
        {
            label: '$(list-tree) 打开时间线视图',
            description: '查看 AI 分组变更历史',
            action: 'showTimeline'
        },
        {
            label: '$(git-branch) 打开 Git 图',
            description: '守护者提交图谱',
            action: 'showGitGraph'
        },
        {
            label: '$(eye) 内联 Blame 注释',
            description: blameLabel,
            detail: 'GitLens 风格：光标行显示提交人/时间/摘要',
            action: 'toggleBlame'
        },
        {
            label: '$(history) 管理里程碑',
            action: 'showMilestones'
        },
        // ── 设置 ──────────────────────────────────────
        { label: '设置', kind: vscode.QuickPickItemKind.Separator },
        {
            label: '$(record-keys) 追踪模式',
            description: trackingLabel,
            detail: '切换至下一模式（Full↔Local Backup）',
            action: 'toggleTracking'
        },
        {
            label: '$(bell) 通知级别',
            description: notifLabel,
            detail: '切换通知级别（All→Milestone→None）',
            action: 'toggleNotification'
        },
        {
            label: '$(cloud-upload) 推送策略',
            description: pushLabel,
            detail: '切换 Git 推送时机（None→Milestone→All）',
            action: 'togglePush'
        },
        {
            label: '$(globe) 提交语言',
            description: langLabel,
            detail: '切换提交信息语言（Auto→EN→中文）',
            action: 'toggleLanguage'
        },
        {
            label: '$(target) 里程碑功能',
            description: milestoneToggleLabel,
            detail: '开关里程碑追踪功能',
            action: 'toggleMilestone'
        },
    ];

    vscode.window.showQuickPick(items, {
        title: '🛡️ Vibe Code Guardian',
        placeHolder: '选择操作...',
        matchOnDescription: true
    }).then(selected => {
        if (!selected?.action) { return; }
        switch (selected.action) {
            case 'startMilestone':
                vscode.commands.executeCommand('vibeCodeGuardian.startMilestone');
                break;
            case 'completeMilestone':
                vscode.commands.executeCommand('vibeCodeGuardian.completeMilestone');
                break;
            case 'abandonMilestone':
                vscode.commands.executeCommand('vibeCodeGuardian.abandonMilestone');
                break;
            case 'showTimeline':
                vscode.commands.executeCommand('vibeCodeGuardian.showTimeline');
                break;
            case 'showGitGraph':
                vscode.commands.executeCommand('vibeCodeGuardian.showGitGraph');
                break;
            case 'showMilestones':
                vscode.commands.executeCommand('vibeCodeGuardian.showMilestones');
                break;
            case 'toggleTracking':
                vscode.commands.executeCommand('vibeCodeGuardian.toggleTrackingMode');
                break;
            case 'toggleNotification':
                vscode.commands.executeCommand('vibeCodeGuardian.toggleNotificationLevel');
                break;
            case 'togglePush':
                vscode.commands.executeCommand('vibeCodeGuardian.togglePushStrategy');
                break;
            case 'toggleLanguage':
                vscode.commands.executeCommand('vibeCodeGuardian.toggleCommitLanguage');
                break;
            case 'toggleMilestone':
                vscode.commands.executeCommand('vibeCodeGuardian.toggleMilestone');
                break;
            case 'toggleBlame':
                vscode.commands.executeCommand('vibeCodeGuardian.toggleBlame');
                break;
        }
    });
}

export function deactivate() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    console.log('🎮 Vibe Code Guardian deactivated');
}
