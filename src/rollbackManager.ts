/**
 * Vibe Code Guardian - Rollback Manager
 * Handle rollback operations with diff preview
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Checkpoint, RollbackResult, DiffInfo, ChangedFile } from './types';
import { GitManager } from './gitManager';
import { CheckpointManager } from './checkpointManager';

export class RollbackManager {
    private gitManager: GitManager;
    private checkpointManager: CheckpointManager;
    private workspaceRoot: string | undefined;

    constructor(gitManager: GitManager, checkpointManager: CheckpointManager) {
        this.gitManager = gitManager;
        this.checkpointManager = checkpointManager;
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        }
    }

    /**
     * Preview diff before rollback
     */
    public async previewRollback(checkpointId: string): Promise<DiffInfo[] | undefined> {
        const checkpoint = this.checkpointManager.getCheckpoint(checkpointId);
        if (!checkpoint) {
            vscode.window.showErrorMessage('Checkpoint not found');
            return undefined;
        }

        const diffs: DiffInfo[] = [];

        // If checkpoint has Git commit, show Git diff
        if (checkpoint.gitCommitHash && await this.gitManager.isGitRepository()) {
            for (const file of checkpoint.changedFiles) {
                const diff = await this.gitManager.getFileDiff(
                    file.path,
                    checkpoint.gitCommitHash
                );
                if (diff) {
                    diffs.push(diff);
                }
            }
        } else {
            // Use stored content snapshots
            for (const file of checkpoint.changedFiles) {
                if (file.previousContent !== undefined) {
                    const currentContent = await this.getCurrentFileContent(file.path);
                    diffs.push({
                        filePath: file.path,
                        hunks: [],
                        linesAdded: file.linesAdded,
                        linesRemoved: file.linesRemoved
                    });
                }
            }
        }

        return diffs;
    }

    /**
     * Show diff in VS Code's diff viewer
     */
    public async showDiffViewer(checkpointId: string): Promise<void> {
        const checkpoint = this.checkpointManager.getCheckpoint(checkpointId);
        if (!checkpoint) {
            vscode.window.showErrorMessage('Checkpoint not found');
            return;
        }

        if (checkpoint.changedFiles.length === 0) {
            vscode.window.showInformationMessage('No files changed in this checkpoint');
            return;
        }

        // For each file, show diff
        for (const file of checkpoint.changedFiles) {
            if (checkpoint.gitCommitHash && await this.gitManager.isGitRepository()) {
                // Use Git diff
                const oldContent = await this.gitManager.getFileAtCommit(
                    file.path,
                    `${checkpoint.gitCommitHash}^` // Parent commit
                );
                const newContent = await this.gitManager.getFileAtCommit(
                    file.path,
                    checkpoint.gitCommitHash
                );

                if (oldContent !== undefined && newContent !== undefined) {
                    await this.showContentDiff(
                        file.path,
                        oldContent,
                        newContent,
                        `Before: ${checkpoint.name}`,
                        `After: ${checkpoint.name}`
                    );
                }
            } else if (file.previousContent !== undefined && file.currentContent !== undefined) {
                // Use stored snapshots
                await this.showContentDiff(
                    file.path,
                    file.previousContent,
                    file.currentContent,
                    `Before: ${checkpoint.name}`,
                    `After: ${checkpoint.name}`
                );
            }
        }
    }

    /**
     * Show content diff in VS Code
     */
    private async showContentDiff(
        filePath: string,
        oldContent: string,
        newContent: string,
        leftTitle: string,
        rightTitle: string
    ): Promise<void> {
        const fileName = path.basename(filePath);
        
        // Create virtual documents for diff
        const oldUri = vscode.Uri.parse(`vibe-guardian-diff:${fileName}?content=old`);
        const newUri = vscode.Uri.parse(`vibe-guardian-diff:${fileName}?content=new`);

        // Store content for text document provider
        DiffContentProvider.setContent(oldUri.toString(), oldContent);
        DiffContentProvider.setContent(newUri.toString(), newContent);

        // Open diff editor
        await vscode.commands.executeCommand(
            'vscode.diff',
            oldUri,
            newUri,
            `${leftTitle} ↔ ${rightTitle}`
        );
    }

    /**
     * Rollback to a checkpoint
     */
    public async rollback(checkpointId: string, options?: {
        hard?: boolean;
        createBackup?: boolean;
    }): Promise<RollbackResult> {
        const checkpoint = this.checkpointManager.getCheckpoint(checkpointId);
        if (!checkpoint) {
            return {
                success: false,
                message: 'Checkpoint not found',
                filesRestored: [],
                filesNotRestored: [],
                errors: ['Checkpoint not found']
            };
        }

        const filesRestored: string[] = [];
        const filesNotRestored: string[] = [];
        const errors: string[] = [];

        // Create backup checkpoint before rollback
        if (options?.createBackup !== false) {
            try {
                const currentFiles = await this.getCurrentChangedFiles();
                await this.checkpointManager.createCheckpoint(
                    checkpoint.type,
                    checkpoint.source,
                    currentFiles,
                    {
                        name: `🔙 Backup before rollback to: ${checkpoint.name}`,
                        description: `Automatic backup created before rolling back to checkpoint ${checkpointId}`
                    }
                );
            } catch (error) {
                console.warn('Failed to create backup checkpoint:', error);
            }
        }

        // Use Git rollback if available
        if (checkpoint.gitCommitHash && await this.gitManager.isGitRepository()) {
            try {
                const success = await this.gitManager.rollbackToCommit(
                    checkpoint.gitCommitHash,
                    options?.hard ?? false
                );
                if (success) {
                    return {
                        success: true,
                        message: `Rolled back to checkpoint: ${checkpoint.name}`,
                        filesRestored: checkpoint.changedFiles.map(f => f.path),
                        filesNotRestored: [],
                        errors: []
                    };
                }
            } catch (error) {
                errors.push(`Git rollback failed: ${error}`);
            }
        }

        // Fallback to file content restoration
        for (const file of checkpoint.changedFiles) {
            try {
                if (file.previousContent !== undefined) {
                    await this.restoreFileContent(file.path, file.previousContent);
                    filesRestored.push(file.path);
                } else if (checkpoint.gitCommitHash) {
                    const content = await this.gitManager.getFileAtCommit(
                        file.path,
                        `${checkpoint.gitCommitHash}^`
                    );
                    if (content !== undefined) {
                        await this.restoreFileContent(file.path, content);
                        filesRestored.push(file.path);
                    } else {
                        filesNotRestored.push(file.path);
                        errors.push(`Could not get content for: ${file.path}`);
                    }
                } else {
                    filesNotRestored.push(file.path);
                    errors.push(`No previous content for: ${file.path}`);
                }
            } catch (error) {
                filesNotRestored.push(file.path);
                errors.push(`Failed to restore ${file.path}: ${error}`);
            }
        }

        const success = filesRestored.length > 0 && errors.length === 0;
        return {
            success,
            message: success 
                ? `Rolled back to checkpoint: ${checkpoint.name}` 
                : `Partial rollback to: ${checkpoint.name}`,
            filesRestored,
            filesNotRestored,
            errors
        };
    }

    /**
     * Rollback a single file
     */
    public async rollbackFile(checkpointId: string, filePath: string): Promise<boolean> {
        const checkpoint = this.checkpointManager.getCheckpoint(checkpointId);
        if (!checkpoint) {
            vscode.window.showErrorMessage('Checkpoint not found');
            return false;
        }

        const file = checkpoint.changedFiles.find(f => f.path === filePath);
        if (!file) {
            vscode.window.showErrorMessage('File not found in checkpoint');
            return false;
        }

        try {
            if (file.previousContent !== undefined) {
                await this.restoreFileContent(filePath, file.previousContent);
                vscode.window.showInformationMessage(`Restored: ${path.basename(filePath)}`);
                return true;
            } else if (checkpoint.gitCommitHash) {
                const success = await this.gitManager.restoreFile(
                    filePath,
                    `${checkpoint.gitCommitHash}^`
                );
                if (success) {
                    vscode.window.showInformationMessage(`Restored: ${path.basename(filePath)}`);
                }
                return success;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to restore file: ${error}`);
        }

        return false;
    }

    /**
     * Restore file content
     */
    private async restoreFileContent(filePath: string, content: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        
        // Check if file is open in editor
        const openDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.fsPath === filePath
        );

        if (openDoc) {
            // Use workspace edit for open documents
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                openDoc.positionAt(0),
                openDoc.positionAt(openDoc.getText().length)
            );
            edit.replace(uri, fullRange, content);
            await vscode.workspace.applyEdit(edit);
        } else {
            // Write directly to file
            fs.writeFileSync(filePath, content, 'utf8');
        }
    }

    /**
     * Get current file content
     */
    private async getCurrentFileContent(filePath: string): Promise<string | undefined> {
        try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            return doc.getText();
        } catch {
            return undefined;
        }
    }

    /**
     * Get current changed files
     */
    private async getCurrentChangedFiles(): Promise<ChangedFile[]> {
        const files: ChangedFile[] = [];
        
        // Get dirty documents
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.isDirty && doc.uri.scheme === 'file') {
                files.push({
                    path: doc.uri.fsPath,
                    changeType: 'modified' as any,
                    linesAdded: 0,
                    linesRemoved: 0,
                    currentContent: doc.getText()
                });
            }
        }

        return files;
    }

    public dispose(): void {
        // Cleanup if needed
    }
}

/**
 * Content provider for diff view
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    private static contents: Map<string, string> = new Map();
    
    public static setContent(uri: string, content: string): void {
        this.contents.set(uri, content);
    }

    public static clearContent(uri: string): void {
        this.contents.delete(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return DiffContentProvider.contents.get(uri.toString()) || '';
    }
}
