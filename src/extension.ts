/**
 * Vibe Code Guardian - Main Extension Entry Point
 * Game-like checkpoint system for AI-assisted coding sessions
 */

import * as vscode from 'vscode';
import { GitManager } from './gitManager';
import { CheckpointManager } from './checkpointManager';
import { AIDetector } from './aiDetector';
import { RollbackManager, DiffContentProvider } from './rollbackManager';
import { TimelineTreeProvider, TimelineItem } from './timelineTreeProvider';
import { StateMonitor } from './stateMonitor';
import { CheckpointType, CheckpointSource, ChangedFile, FileChangeType, CommitLanguage, NotificationLevel } from './types';
import { getLanguageDisplayName, getNextLanguage, getNotificationLevelDisplayName, getNextNotificationLevel } from './languageConfig';

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
let languageStatusBarItem: vscode.StatusBarItem;
let notificationStatusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
    console.log('🎮 Vibe Code Guardian is activating...');

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Vibe Code Guardian: Please open a workspace folder first.');
        return;
    }

    try {
        // Initialize all managers
        gitManager = new GitManager();
        checkpointManager = new CheckpointManager(context, gitManager);
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

        // Register DiffContentProvider for diff view
        const diffProvider = new DiffContentProvider();
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider('vibe-guardian-diff', diffProvider)
        );

        // Initialize and start State Monitor
        stateMonitor = new StateMonitor(gitManager);
        stateMonitor.start();
        context.subscriptions.push({ dispose: () => stateMonitor.dispose() });

        // Register all commands
        registerCommands(context);

        // Setup event listeners
        setupEventListeners(context);

        // Start auto-save timer
        startAutoSaveTimer(context);

        // Create status bar items
        createLanguageStatusBar(context);
        createNotificationStatusBar(context);

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
    try {
        const gitFiles = await gitManager.getChangedFiles();
        for (const filePath of gitFiles) {
            changedFiles.push({
                path: filePath,
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
                    vscode.window.showInformationMessage(`✅ Checkpoint saved: ${checkpoint.name}`);
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
                    vscode.window.showInformationMessage(`⚡ Quick saved: ${checkpoint.name}`);
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

    // Show File Diff (clicked from tree view)
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.showFileDiff', async (checkpointId: string, filePath: string) => {
            try {
                const checkpoint = checkpointManager.getCheckpoint(checkpointId);
                if (!checkpoint || !checkpoint.gitCommitHash) {
                    vscode.window.showWarningMessage('Cannot show diff: no git commit associated.');
                    return;
                }

                const diffContent = await gitManager.getDiff(checkpoint.gitCommitHash);
                if (diffContent) {
                    const doc = await vscode.workspace.openTextDocument({
                        content: diffContent || 'No changes',
                        language: 'diff'
                    });
                    await vscode.window.showTextDocument(doc, { preview: true });
                }
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
    context.subscriptions.push(
        vscode.commands.registerCommand('vibeCodeGuardian.toggleCommitLanguage', async () => {
            const settings = checkpointManager.getSettings();
            const nextLanguage = getNextLanguage(settings.commitLanguage);
            await checkpointManager.updateSettings({ commitLanguage: nextLanguage });
            
            // Update status bar
            updateLanguageStatusBar(nextLanguage);
            
            const displayName = getLanguageDisplayName(nextLanguage);
            vscode.window.showInformationMessage(`🌐 Commit language changed to: ${displayName}`);
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
                vscode.window.showInformationMessage(`🤖 AI checkpoint: ${checkpoint.name}`);
            }
            treeProvider.refresh();
        }
    });

    // Listen for ALL file changes (including user edits and new file creation)
    aiDetector.onFileChanged(async (event) => {
        console.log(`📁 File change detected: ${event.changedFiles.length} files, source: ${event.source}, isNew: ${event.isNewFile}`);
        
        // Log details for debugging
        for (const file of event.changedFiles) {
            console.log(`  - ${file.changeType}: ${file.path}`);
        }
        
        const settings = checkpointManager.getSettings();
        
        // Handle user edits - create checkpoint if enabled
        if (event.source === CheckpointSource.User && settings.autoCheckpointOnUserSave) {
            // Calculate total lines changed
            const totalLinesChanged = event.changedFiles.reduce((sum, file) => {
                return sum + (file.linesAdded || 0) + (file.linesRemoved || 0);
            }, 0);
            
            // Only create checkpoint if significant changes or new file
            if (event.isNewFile || totalLinesChanged >= settings.minLinesForUserCheckpoint) {
                const fileNames = event.changedFiles.map(f => f.path.split('/').pop()).join(', ');
                const description = event.isNewFile 
                    ? `New file: ${fileNames}`
                    : `User edit: ${fileNames} (+${totalLinesChanged} lines)`;
                
                const checkpoint = await checkpointManager.createCheckpoint(
                    event.isNewFile ? CheckpointType.Auto : CheckpointType.Manual,
                    CheckpointSource.User,
                    event.changedFiles,
                    { description }
                );
                
                if (checkpoint && shouldShowNotification(settings.notificationLevel, checkpoint.type)) {
                    vscode.window.showInformationMessage(`💾 User checkpoint: ${checkpoint.name}`);
                }
                treeProvider.refresh();
            }
        }
        
        // Notify for new files (only in 'all' mode)
        if (event.isNewFile && settings.notificationLevel === 'all') {
            const fileNames = event.changedFiles.map(f => f.path.split('/').pop()).join(', ');
            console.log(`📁 New file created: ${fileNames}`);
        }
    });

    // Listen for checkpoint events
    checkpointManager.onCheckpointCreated(() => treeProvider.refresh());
    checkpointManager.onCheckpointDeleted(() => treeProvider.refresh());
    checkpointManager.onSessionChanged(() => treeProvider.refresh());
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
 * Creates the language status bar item
 */
function createLanguageStatusBar(context: vscode.ExtensionContext) {
    languageStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    languageStatusBarItem.command = 'vibeCodeGuardian.toggleCommitLanguage';
    languageStatusBarItem.tooltip = 'Click to toggle commit message language (EN/中文/Auto)';
    
    // Initialize with current setting
    const settings = checkpointManager.getSettings();
    updateLanguageStatusBar(settings.commitLanguage);
    
    languageStatusBarItem.show();
    context.subscriptions.push(languageStatusBarItem);
}

/**
 * Updates the language status bar item text
 */
function updateLanguageStatusBar(language: CommitLanguage) {
    if (languageStatusBarItem) {
        languageStatusBarItem.text = `$(globe) ${getLanguageDisplayName(language)}`;
    }
}

export function deactivate() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    console.log('🎮 Vibe Code Guardian deactivated');
}
