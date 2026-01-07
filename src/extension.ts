/**
 * Vibe Code Guardian - Main Extension Entry Point
 * Game-like checkpoint system for AI-assisted coding sessions
 */

import * as vscode from 'vscode';
import { GitManager } from './gitManager';
import { CheckpointManager } from './checkpointManager';
import { AIDetector } from './aiDetector';
import { RollbackManager } from './rollbackManager';
import { TimelineTreeProvider, TimelineItem } from './timelineTreeProvider';
import { CheckpointType, CheckpointSource, ChangedFile, FileChangeType } from './types';

let gitManager: GitManager;
let checkpointManager: CheckpointManager;
let aiDetector: AIDetector;
let rollbackManager: RollbackManager;
let treeProvider: TimelineTreeProvider;

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

        // Check Git repository
        const isGitRepo = await gitManager.isGitRepository();
        if (!isGitRepo) {
            vscode.window.showWarningMessage('Vibe Code Guardian: Not a Git repository. Some features may be limited.');
        }

        // Register Tree View for sidebar
        const treeView = vscode.window.createTreeView('vibeCodeGuardian.checkpointExplorer', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);

        // Register all commands
        registerCommands(context);

        // Setup event listeners
        setupEventListeners(context);

        // Start auto-save timer
        startAutoSaveTimer(context);

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
                    vscode.window.showWarningMessage('No checkpoints available.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    checkpoints.map(cp => ({
                        label: cp.name,
                        description: cp.description || '',
                        detail: `📅 ${new Date(cp.timestamp).toLocaleString()} | 📁 ${cp.changedFiles.length} files`,
                        checkpoint: cp
                    })),
                    { placeHolder: 'Select a checkpoint to rollback to' }
                );

                if (!selected) { return; }
                checkpointId = selected.checkpoint.id;
            }

            const confirm = await vscode.window.showWarningMessage(
                '⚠️ Rollback will revert all changes since this checkpoint.',
                { modal: true },
                'Rollback',
                'Cancel'
            );

            if (confirm === 'Rollback' && checkpointId) {
                try {
                    const result = await rollbackManager.rollback(checkpointId);
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
}

function setupEventListeners(context: vscode.ExtensionContext) {
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
            if (checkpoint && settings.showNotifications) {
                vscode.window.showInformationMessage(`🤖 AI checkpoint: ${checkpoint.name}`);
            }
            treeProvider.refresh();
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

export function deactivate() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    console.log('🎮 Vibe Code Guardian deactivated');
}
