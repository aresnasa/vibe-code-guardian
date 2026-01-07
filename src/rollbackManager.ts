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
     * Uses native VS Code/Git diff when possible
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

        // If multiple files, let user select which to view
        let filesToShow = checkpoint.changedFiles;
        if (checkpoint.changedFiles.length > 1) {
            const items = checkpoint.changedFiles.map(f => ({
                label: path.basename(f.path),
                description: f.path,
                detail: `+${f.linesAdded} -${f.linesRemoved}`,
                file: f
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a file to view diff',
                canPickMany: false
            });
            
            if (!selected) {
                return;
            }
            filesToShow = [selected.file];
        }

        // Show diff for selected file(s)
        for (const file of filesToShow) {
            // Try native Git diff first if we have a commit hash
            if (checkpoint.gitCommitHash && await this.gitManager.isGitRepository()) {
                const shown = await this.showGitDiff(file.path, checkpoint.gitCommitHash, checkpoint.name);
                if (shown) {
                    continue;
                }
            }
            
            // Fallback to content-based diff
            if (file.previousContent !== undefined && file.currentContent !== undefined) {
                await this.showContentDiff(
                    file.path,
                    file.previousContent,
                    file.currentContent,
                    `Before: ${checkpoint.name}`,
                    `After: ${checkpoint.name}`
                );
            } else if (checkpoint.gitCommitHash) {
                // Try to get content from Git
                const oldContent = await this.gitManager.getFileAtCommit(
                    file.path,
                    `${checkpoint.gitCommitHash}^`
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
                } else {
                    vscode.window.showWarningMessage(`Cannot show diff for ${path.basename(file.path)}: content not available`);
                }
            } else {
                vscode.window.showWarningMessage(`Cannot show diff for ${path.basename(file.path)}: no previous content saved`);
            }
        }
    }

    /**
     * Show Git diff using VS Code's native Git extension
     */
    private async showGitDiff(filePath: string, commitHash: string, checkpointName: string): Promise<boolean> {
        try {
            // Get the Git extension
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return false;
            }

            const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
            const api = git.getAPI(1);
            
            if (!api || api.repositories.length === 0) {
                return false;
            }

            // Find the repository containing this file
            const fileUri = vscode.Uri.file(filePath);
            const repo = api.repositories.find((r: any) => 
                filePath.startsWith(r.rootUri.fsPath)
            );

            if (!repo) {
                return false;
            }

            // Use vscode.git's diff command
            const relativePath = path.relative(repo.rootUri.fsPath, filePath);
            
            // Create Git URI for the old version (parent commit)
            const oldUri = vscode.Uri.parse(`git:${relativePath}?${JSON.stringify({
                path: relativePath,
                ref: `${commitHash}^`
            })}`);
            
            // Create Git URI for the new version (at commit)
            const newUri = vscode.Uri.parse(`git:${relativePath}?${JSON.stringify({
                path: relativePath,
                ref: commitHash
            })}`);

            await vscode.commands.executeCommand(
                'vscode.diff',
                oldUri,
                newUri,
                `${path.basename(filePath)}: Before ↔ After (${checkpointName})`
            );

            return true;
        } catch (error) {
            console.warn('Failed to show Git diff:', error);
            return false;
        }
    }

    /**
     * Show content diff in VS Code using virtual documents
     */
    private async showContentDiff(
        filePath: string,
        oldContent: string,
        newContent: string,
        leftTitle: string,
        rightTitle: string
    ): Promise<void> {
        const fileName = path.basename(filePath);
        const timestamp = Date.now();
        
        // Create unique URIs with proper encoding
        // Use a simpler path structure that VS Code can resolve
        const oldUri = vscode.Uri.parse(`vibe-guardian-diff:/${timestamp}/old/${fileName}`);
        const newUri = vscode.Uri.parse(`vibe-guardian-diff:/${timestamp}/new/${fileName}`);

        // Store content for text document provider (use toString for consistency)
        DiffContentProvider.setContent(oldUri.toString(), oldContent);
        DiffContentProvider.setContent(newUri.toString(), newContent);

        try {
            // Open diff editor
            await vscode.commands.executeCommand(
                'vscode.diff',
                oldUri,
                newUri,
                `${leftTitle} ↔ ${rightTitle}`
            );
        } catch (error) {
            console.error('Failed to open diff editor:', error);
            vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
        }
    }

    /**
     * Rollback to a checkpoint with user confirmation
     */
    public async rollback(checkpointId: string, options?: {
        hard?: boolean;
        createBackup?: boolean;
        skipConfirmation?: boolean;
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

        // Show confirmation dialog unless skipped
        if (!options?.skipConfirmation) {
            const fileList = checkpoint.changedFiles
                .map(f => `  • ${path.basename(f.path)}`)
                .join('\n');
            
            const detail = checkpoint.changedFiles.length > 0
                ? `The following files will be reverted:\n${fileList}`
                : 'This will restore the project state to this checkpoint.';

            const result = await vscode.window.showWarningMessage(
                `Are you sure you want to rollback to "${checkpoint.name}"?`,
                {
                    modal: true,
                    detail: detail
                },
                { title: 'View Diff First', isCloseAffordance: false },
                { title: 'Rollback', isCloseAffordance: false },
                { title: 'Cancel', isCloseAffordance: true }
            );

            if (!result || result.title === 'Cancel') {
                return {
                    success: false,
                    message: 'Rollback cancelled by user',
                    filesRestored: [],
                    filesNotRestored: [],
                    errors: []
                };
            }

            if (result.title === 'View Diff First') {
                await this.showDiffViewer(checkpointId);
                // After viewing diff, ask again
                const confirmResult = await vscode.window.showWarningMessage(
                    `Proceed with rollback to "${checkpoint.name}"?`,
                    { modal: true },
                    'Yes, Rollback',
                    'Cancel'
                );
                if (confirmResult !== 'Yes, Rollback') {
                    return {
                        success: false,
                        message: 'Rollback cancelled after diff preview',
                        filesRestored: [],
                        filesNotRestored: [],
                        errors: []
                    };
                }
            }
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

        // Use Git rollback if we have a commit hash
        if (checkpoint.gitCommitHash && await this.gitManager.isGitRepository()) {
            console.log(`Attempting Git rollback to commit: ${checkpoint.gitCommitHash}`);
            
            // Always show method selection for clarity
            const method = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(history) Hard Reset (Recommended)',
                        description: 'Reset to checkpoint state, discard all changes after it',
                        value: 'hard'
                    },
                    {
                        label: '$(git-commit) Soft Reset',
                        description: 'Move HEAD to checkpoint, keep changes staged',
                        value: 'soft'
                    },
                    {
                        label: '$(file-symlink-file) Checkout Files Only',
                        description: 'Restore file contents without moving HEAD',
                        value: 'checkout'
                    }
                ],
                {
                    placeHolder: 'Choose rollback method',
                    title: `Rollback to: ${checkpoint.name}`
                }
            );

            if (!method) {
                return {
                    success: false,
                    message: 'Rollback cancelled',
                    filesRestored: [],
                    filesNotRestored: [],
                    errors: []
                };
            }

            try {
                let success = false;
                let restoredFiles: string[] = [];

                if (method.value === 'hard') {
                    // Hard reset - most reliable
                    success = await this.gitManager.rollbackToCommit(checkpoint.gitCommitHash, true);
                    restoredFiles = ['All files (hard reset)'];
                } else if (method.value === 'soft') {
                    // Soft reset
                    success = await this.gitManager.rollbackToCommit(checkpoint.gitCommitHash, false);
                    restoredFiles = ['All files (soft reset)'];
                } else {
                    // Checkout files only
                    const result = await this.gitManager.restoreToCommit(checkpoint.gitCommitHash);
                    success = result.success;
                    restoredFiles = result.restoredFiles;
                    if (result.errors.length > 0) {
                        errors.push(...result.errors);
                    }
                }

                if (success) {
                    // Refresh all open files in VS Code
                    await this.refreshAllOpenFiles();
                    
                    return {
                        success: true,
                        message: `Successfully rolled back to: ${checkpoint.name}`,
                        filesRestored: restoredFiles,
                        filesNotRestored: [],
                        errors: []
                    };
                } else {
                    errors.push('Git operation returned false');
                }
            } catch (error) {
                console.error('Git rollback error:', error);
                errors.push(`Git rollback failed: ${error}`);
            }
        }

        // Fallback to file content restoration (only if we have changedFiles and Git failed)
        if (checkpoint.changedFiles.length > 0 && errors.length > 0) {
            console.log('Attempting fallback file content restoration...');
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
                        }
                    } else {
                        filesNotRestored.push(file.path);
                    }
                } catch (error) {
                    filesNotRestored.push(file.path);
                    console.error(`Failed to restore ${file.path}:`, error);
                }
            }
        }

        // If we got here with errors and no restored files, the rollback failed
        if (errors.length > 0 && filesRestored.length === 0) {
            // Show detailed error
            const errorDetail = errors.join('\n');
            vscode.window.showErrorMessage(
                `Rollback failed. Errors:\n${errorDetail}`,
                { modal: true }
            );
        }

        const success = filesRestored.length > 0 || errors.length === 0;
        return {
            success,
            message: success 
                ? `Rolled back to checkpoint: ${checkpoint.name}` 
                : `Rollback failed: ${errors.join(', ')}`,
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
     * Refresh files in VS Code editor after Git operations
     * This ensures the editor shows the updated content from disk
     */
    private async refreshFilesInEditor(filePaths: string[]): Promise<void> {
        // Collect all open documents that need refresh
        const docsToRefresh: vscode.TextDocument[] = [];
        
        for (const filePath of filePaths) {
            const doc = vscode.workspace.textDocuments.find(
                d => d.uri.fsPath === filePath || d.uri.fsPath.endsWith(filePath)
            );
            if (doc) {
                docsToRefresh.push(doc);
            }
        }

        // If specific files provided, refresh them
        if (docsToRefresh.length > 0) {
            for (const doc of docsToRefresh) {
                try {
                    // Revert the document to reload from disk
                    await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri);
                } catch {
                    // If revert fails, try to close and reopen
                    try {
                        const uri = doc.uri;
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        await vscode.window.showTextDocument(uri);
                    } catch (e) {
                        console.warn(`Failed to refresh ${doc.uri.fsPath}:`, e);
                    }
                }
            }
        }

        // Also refresh any visible editors
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                try {
                    await vscode.commands.executeCommand('workbench.action.files.revert', editor.document.uri);
                } catch {
                    // Ignore errors for visible editors
                }
            }
        }

        // Trigger a workspace refresh
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    }

    /**
     * Refresh all open files in editor
     */
    private async refreshAllOpenFiles(): Promise<void> {
        const allDocs = vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'file');
        await this.refreshFilesInEditor(allDocs.map(d => d.uri.fsPath));
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
 * Handles virtual documents for showing checkpoint diffs
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    private static contents: Map<string, string> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    
    public readonly onDidChange = this._onDidChange.event;
    
    public static setContent(uriString: string, content: string): void {
        this.contents.set(uriString, content);
    }

    public static getContent(uriString: string): string | undefined {
        return this.contents.get(uriString);
    }

    public static clearContent(uriString: string): void {
        this.contents.delete(uriString);
    }

    public static clearAll(): void {
        this.contents.clear();
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        // Try exact match first
        let content = DiffContentProvider.contents.get(uri.toString());
        if (content !== undefined) {
            return content;
        }
        
        // Try with decoded URI
        const decodedUri = decodeURIComponent(uri.toString());
        content = DiffContentProvider.contents.get(decodedUri);
        if (content !== undefined) {
            return content;
        }
        
        // Try to find by path portion
        const uriPath = uri.path;
        for (const [key, value] of DiffContentProvider.contents.entries()) {
            if (key.includes(uriPath) || decodeURIComponent(key).includes(uriPath)) {
                return value;
            }
        }
        
        return `// Content not found for: ${uri.toString()}`;
    }

    public dispose(): void {
        this._onDidChange.dispose();
        DiffContentProvider.clearAll();
    }
}
