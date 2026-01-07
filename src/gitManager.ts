/**
 * Vibe Code Guardian - Git Manager
 * Handle Git operations for checkpoint versioning
 */

import * as vscode from 'vscode';
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { DiffInfo, DiffHunk } from './types';

export class GitManager {
    private git: SimpleGit | null = null;
    private workspaceRoot: string | undefined;

    constructor() {
        this.initializeGit();
    }

    /**
     * Initialize Git instance for the workspace
     */
    private initializeGit(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri.fsPath;
            this.git = simpleGit(this.workspaceRoot);
        }
    }

    /**
     * Find the Git root directory for a given file path
     * This walks up the directory tree to find the .git folder
     */
    private findGitRoot(filePath: string): string | undefined {
        let currentDir = path.dirname(filePath);
        
        while (currentDir !== path.dirname(currentDir)) { // Stop at filesystem root
            const gitDir = path.join(currentDir, '.git');
            if (fs.existsSync(gitDir)) {
                return currentDir;
            }
            currentDir = path.dirname(currentDir);
        }
        
        return undefined;
    }

    /**
     * Get a Git instance for a specific file, ensuring we use the correct repository
     */
    public getGitForFile(filePath: string): SimpleGit | null {
        const gitRoot = this.findGitRoot(filePath);
        if (gitRoot) {
            return simpleGit(gitRoot);
        }
        return this.git;
    }

    /**
     * Re-initialize Git for the current active workspace folder
     * Call this when the active editor changes to a different workspace
     */
    public reinitializeForActiveEditor(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const filePath = activeEditor.document.uri.fsPath;
            const gitRoot = this.findGitRoot(filePath);
            if (gitRoot && gitRoot !== this.workspaceRoot) {
                this.workspaceRoot = gitRoot;
                this.git = simpleGit(gitRoot);
                console.log(`Git re-initialized for: ${gitRoot}`);
            }
        }
    }

    /**
     * Get the current workspace root
     */
    public getWorkspaceRoot(): string | undefined {
        return this.workspaceRoot;
    }

    /**
     * Check if current workspace is a Git repository
     */
    public async isGitRepository(): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            await this.git.revparse(['--git-dir']);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get current branch name
     */
    public async getCurrentBranch(): Promise<string | undefined> {
        if (!this.git) {
            return undefined;
        }
        try {
            const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
            return branch.trim();
        } catch {
            return undefined;
        }
    }

    /**
     * Get status of the repository
     */
    public async getStatus(): Promise<StatusResult | undefined> {
        if (!this.git) {
            return undefined;
        }
        try {
            return await this.git.status();
        } catch {
            return undefined;
        }
    }

    /**
     * Create a new commit with the given files
     */
    public async createCommit(files: string[], message: string): Promise<string | undefined> {
        if (!this.git) {
            return undefined;
        }
        try {
            // Stage the files
            if (files.length > 0) {
                await this.git.add(files);
            } else {
                // Stage all changes
                await this.git.add('.');
            }

            // Check if there are changes to commit
            const status = await this.git.status();
            if (status.staged.length === 0) {
                return undefined;
            }

            // Create commit
            const result = await this.git.commit(message);
            return result.commit || undefined;
        } catch (error) {
            console.error('Git commit failed:', error);
            return undefined;
        }
    }

    /**
     * Create a new branch
     */
    public async createBranch(branchName: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            await this.git.checkoutLocalBranch(branchName);
            return true;
        } catch (error) {
            console.error('Failed to create branch:', error);
            return false;
        }
    }

    /**
     * Switch to a branch
     */
    public async switchBranch(branchName: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            await this.git.checkout(branchName);
            return true;
        } catch (error) {
            console.error('Failed to switch branch:', error);
            return false;
        }
    }

    /**
     * Get list of changed files
     */
    public async getChangedFiles(): Promise<string[]> {
        if (!this.git) {
            return [];
        }
        try {
            const status = await this.git.status();
            return [
                ...status.modified,
                ...status.created,
                ...status.deleted,
                ...status.renamed.map(r => r.to)
            ];
        } catch {
            return [];
        }
    }

    /**
     * Rollback to a specific commit
     */
    public async rollbackToCommit(commitHash: string, hard: boolean = false): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            if (hard) {
                await this.git.reset(['--hard', commitHash]);
            } else {
                await this.git.reset(['--soft', commitHash]);
            }
            return true;
        } catch (error) {
            console.error('Failed to rollback:', error);
            return false;
        }
    }

    /**
     * Get diff between two commits
     */
    public async getDiff(fromCommit: string, toCommit?: string): Promise<string> {
        if (!this.git) {
            return '';
        }
        try {
            if (toCommit) {
                return await this.git.diff([fromCommit, toCommit]);
            } else {
                return await this.git.diff([fromCommit]);
            }
        } catch {
            return '';
        }
    }

    /**
     * Get diff for a specific file between commits
     */
    public async getFileDiff(filePath: string, fromCommit: string, toCommit?: string): Promise<DiffInfo | undefined> {
        if (!this.git) {
            return undefined;
        }
        try {
            let diff: string;
            if (toCommit) {
                diff = await this.git.diff([fromCommit, toCommit, '--', filePath]);
            } else {
                diff = await this.git.diff([fromCommit, '--', filePath]);
            }
            return this.parseDiff(filePath, diff);
        } catch {
            return undefined;
        }
    }

    /**
     * Parse diff output into structured format
     */
    private parseDiff(filePath: string, diff: string): DiffInfo {
        const hunks: DiffHunk[] = [];
        let linesAdded = 0;
        let linesRemoved = 0;

        const hunkRegex = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/g;
        const lines = diff.split('\n');
        let currentHunk: DiffHunk | null = null;
        let hunkContent: string[] = [];

        for (const line of lines) {
            const hunkMatch = hunkRegex.exec(line);
            if (hunkMatch) {
                if (currentHunk) {
                    currentHunk.content = hunkContent.join('\n');
                    hunks.push(currentHunk);
                }
                currentHunk = {
                    oldStart: parseInt(hunkMatch[1], 10),
                    oldLines: parseInt(hunkMatch[2] || '1', 10),
                    newStart: parseInt(hunkMatch[3], 10),
                    newLines: parseInt(hunkMatch[4] || '1', 10),
                    content: ''
                };
                hunkContent = [line];
                hunkRegex.lastIndex = 0;
            } else if (currentHunk) {
                hunkContent.push(line);
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    linesAdded++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    linesRemoved++;
                }
            }
        }

        if (currentHunk) {
            currentHunk.content = hunkContent.join('\n');
            hunks.push(currentHunk);
        }

        return {
            filePath,
            hunks,
            linesAdded,
            linesRemoved
        };
    }

    /**
     * Get file content at a specific commit
     */
    public async getFileAtCommit(filePath: string, commitHash: string): Promise<string | undefined> {
        if (!this.git) {
            return undefined;
        }
        try {
            const relativePath = this.workspaceRoot 
                ? path.relative(this.workspaceRoot, filePath) 
                : filePath;
            return await this.git.show([`${commitHash}:${relativePath}`]);
        } catch {
            return undefined;
        }
    }

    /**
     * Restore a file to a specific commit version
     */
    public async restoreFile(filePath: string, commitHash: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            const relativePath = this.workspaceRoot 
                ? path.relative(this.workspaceRoot, filePath) 
                : filePath;
            await this.git.checkout([commitHash, '--', relativePath]);
            return true;
        } catch (error) {
            console.error('Failed to restore file:', error);
            return false;
        }
    }

    /**
     * Get commit history
     */
    public async getCommitHistory(maxCount: number = 50): Promise<Array<{
        hash: string;
        date: string;
        message: string;
        author: string;
    }>> {
        if (!this.git) {
            return [];
        }
        try {
            const log = await this.git.log({ maxCount });
            return log.all.map(commit => ({
                hash: commit.hash,
                date: commit.date,
                message: commit.message,
                author: commit.author_name
            }));
        } catch {
            return [];
        }
    }

    /**
     * Stash current changes
     */
    public async stash(message?: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            if (message) {
                await this.git.stash(['push', '-m', message]);
            } else {
                await this.git.stash();
            }
            return true;
        } catch (error) {
            console.error('Failed to stash:', error);
            return false;
        }
    }

    /**
     * Pop stash
     */
    public async stashPop(): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            await this.git.stash(['pop']);
            return true;
        } catch (error) {
            console.error('Failed to pop stash:', error);
            return false;
        }
    }

    public dispose(): void {
        // Cleanup if needed
    }
}
