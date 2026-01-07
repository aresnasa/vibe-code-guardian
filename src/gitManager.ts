/**
 * Vibe Code Guardian - Git Manager
 * Handle Git operations for checkpoint versioning
 */

import * as vscode from 'vscode';
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { DiffInfo, DiffHunk } from './types';

/**
 * Project type detection result
 */
export interface ProjectInfo {
    type: 'nodejs' | 'python' | 'go' | 'rust' | 'java' | 'dotnet' | 'ruby' | 'php' | 'unknown';
    name: string;
    hasGit: boolean;
    hasGitignore: boolean;
    framework?: string;
    packageManager?: string;
}

export class GitManager {
    private git: SimpleGit | null = null;
    private workspaceRoot: string | undefined;
    private _gitInstalled: boolean = false;
    private _gitVersion: string | undefined;

    constructor() {
        this.checkGitInstallation();
        this.initializeGit();
    }

    /**
     * Check if Git is installed on the system
     */
    public checkGitInstallation(): boolean {
        try {
            const version = execSync('git --version', { encoding: 'utf8' });
            this._gitInstalled = true;
            this._gitVersion = version.trim().replace('git version ', '');
            console.log(`Git detected: ${this._gitVersion}`);
            return true;
        } catch {
            this._gitInstalled = false;
            this._gitVersion = undefined;
            console.warn('Git is not installed or not in PATH');
            return false;
        }
    }

    /**
     * Check if Git is installed
     */
    public isGitInstalled(): boolean {
        return this._gitInstalled;
    }

    /**
     * Get Git version
     */
    public getGitVersion(): string | undefined {
        return this._gitVersion;
    }

    /**
     * Show Git installation instructions based on OS
     */
    public async showGitInstallInstructions(): Promise<void> {
        const platform = process.platform;
        let instructions = '';
        let installCommand = '';

        switch (platform) {
            case 'darwin':
                instructions = 'Install Git on macOS using Homebrew or Xcode Command Line Tools';
                installCommand = 'brew install git';
                break;
            case 'win32':
                instructions = 'Download and install Git for Windows from https://git-scm.com/download/win';
                installCommand = 'winget install Git.Git';
                break;
            case 'linux':
                instructions = 'Install Git using your package manager';
                installCommand = 'sudo apt install git  # or: sudo yum install git';
                break;
            default:
                instructions = 'Please install Git from https://git-scm.com/';
        }

        const selection = await vscode.window.showErrorMessage(
            `Git is not installed. ${instructions}`,
            'Copy Install Command',
            'Open Git Website',
            'Check Again'
        );

        if (selection === 'Copy Install Command') {
            await vscode.env.clipboard.writeText(installCommand);
            vscode.window.showInformationMessage(`Copied to clipboard: ${installCommand}`);
        } else if (selection === 'Open Git Website') {
            vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
        } else if (selection === 'Check Again') {
            if (this.checkGitInstallation()) {
                vscode.window.showInformationMessage(`Git detected: version ${this._gitVersion}`);
                this.initializeGit();
            } else {
                vscode.window.showErrorMessage('Git is still not detected. Please install it and restart VS Code.');
            }
        }
    }

    /**
     * Detect project type from workspace files
     */
    public async detectProjectType(): Promise<ProjectInfo> {
        const info: ProjectInfo = {
            type: 'unknown',
            name: 'Unknown Project',
            hasGit: false,
            hasGitignore: false
        };

        if (!this.workspaceRoot) {
            return info;
        }

        // Check if Git repo exists
        info.hasGit = fs.existsSync(path.join(this.workspaceRoot, '.git'));
        info.hasGitignore = fs.existsSync(path.join(this.workspaceRoot, '.gitignore'));

        // Detect project type based on config files
        const files = fs.readdirSync(this.workspaceRoot);

        // Node.js / JavaScript / TypeScript
        if (files.includes('package.json')) {
            info.type = 'nodejs';
            try {
                const pkg = JSON.parse(fs.readFileSync(
                    path.join(this.workspaceRoot, 'package.json'), 'utf8'
                ));
                info.name = pkg.name || 'Node.js Project';
                
                // Detect framework
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if (deps['next']) {
                    info.framework = 'Next.js';
                } else if (deps['react']) {
                    info.framework = 'React';
                } else if (deps['vue']) {
                    info.framework = 'Vue';
                } else if (deps['@angular/core']) {
                    info.framework = 'Angular';
                } else if (deps['express']) {
                    info.framework = 'Express';
                } else if (deps['vscode']) {
                    info.framework = 'VS Code Extension';
                }

                // Detect package manager
                if (files.includes('pnpm-lock.yaml')) {
                    info.packageManager = 'pnpm';
                } else if (files.includes('yarn.lock')) {
                    info.packageManager = 'yarn';
                } else if (files.includes('package-lock.json')) {
                    info.packageManager = 'npm';
                }
            } catch {
                info.name = 'Node.js Project';
            }
        }
        // Python
        else if (files.includes('requirements.txt') || files.includes('setup.py') || 
                 files.includes('pyproject.toml') || files.includes('Pipfile')) {
            info.type = 'python';
            info.name = path.basename(this.workspaceRoot);
            if (files.includes('pyproject.toml')) {
                info.packageManager = 'poetry';
            } else if (files.includes('Pipfile')) {
                info.packageManager = 'pipenv';
            } else {
                info.packageManager = 'pip';
            }
        }
        // Go
        else if (files.includes('go.mod')) {
            info.type = 'go';
            try {
                const goMod = fs.readFileSync(
                    path.join(this.workspaceRoot, 'go.mod'), 'utf8'
                );
                const match = goMod.match(/module\s+(.+)/);
                info.name = match ? match[1] : path.basename(this.workspaceRoot);
            } catch {
                info.name = path.basename(this.workspaceRoot);
            }
        }
        // Rust
        else if (files.includes('Cargo.toml')) {
            info.type = 'rust';
            info.packageManager = 'cargo';
            try {
                const cargo = fs.readFileSync(
                    path.join(this.workspaceRoot, 'Cargo.toml'), 'utf8'
                );
                const match = cargo.match(/name\s*=\s*"([^"]+)"/);
                info.name = match ? match[1] : path.basename(this.workspaceRoot);
            } catch {
                info.name = path.basename(this.workspaceRoot);
            }
        }
        // Java
        else if (files.includes('pom.xml') || files.includes('build.gradle') || files.includes('build.gradle.kts')) {
            info.type = 'java';
            info.packageManager = files.includes('pom.xml') ? 'maven' : 'gradle';
            info.name = path.basename(this.workspaceRoot);
        }
        // .NET
        else if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) {
            info.type = 'dotnet';
            info.packageManager = 'nuget';
            info.name = path.basename(this.workspaceRoot);
        }
        // Ruby
        else if (files.includes('Gemfile')) {
            info.type = 'ruby';
            info.packageManager = 'bundler';
            info.name = path.basename(this.workspaceRoot);
        }
        // PHP
        else if (files.includes('composer.json')) {
            info.type = 'php';
            info.packageManager = 'composer';
            info.name = path.basename(this.workspaceRoot);
        }
        else {
            info.name = path.basename(this.workspaceRoot);
        }

        return info;
    }

    /**
     * Initialize Git repository with smart defaults
     */
    public async initializeRepository(): Promise<boolean> {
        if (!this._gitInstalled) {
            await this.showGitInstallInstructions();
            return false;
        }

        if (!this.workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return false;
        }

        // Check if already a Git repo
        if (fs.existsSync(path.join(this.workspaceRoot, '.git'))) {
            vscode.window.showInformationMessage('This folder is already a Git repository');
            return true;
        }

        const projectInfo = await this.detectProjectType();

        // Ask user for confirmation
        const result = await vscode.window.showInformationMessage(
            `Initialize Git repository for ${projectInfo.name}?`,
            {
                modal: true,
                detail: `Project type: ${projectInfo.type}${projectInfo.framework ? ` (${projectInfo.framework})` : ''}\n` +
                        `This will create a .git folder and optionally a .gitignore file.`
            },
            'Initialize',
            'Initialize with .gitignore',
            'Cancel'
        );

        if (result === 'Cancel' || !result) {
            return false;
        }

        try {
            // Initialize git
            this.git = simpleGit(this.workspaceRoot);
            await this.git.init();

            // Create .gitignore if requested
            if (result === 'Initialize with .gitignore') {
                await this.createGitignore(projectInfo.type);
            }

            // Create initial commit
            await this.git.add('.');
            await this.git.commit('🎮 Initial commit by Vibe Code Guardian');

            vscode.window.showInformationMessage(
                `✅ Git repository initialized for ${projectInfo.name}!`
            );

            return true;
        } catch (error) {
            console.error('Failed to initialize Git:', error);
            vscode.window.showErrorMessage(`Failed to initialize Git: ${error}`);
            return false;
        }
    }

    /**
     * Create .gitignore based on project type
     */
    private async createGitignore(projectType: ProjectInfo['type']): Promise<void> {
        if (!this.workspaceRoot) {
            return;
        }

        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        
        // Don't overwrite existing
        if (fs.existsSync(gitignorePath)) {
            return;
        }

        let content = '';

        switch (projectType) {
            case 'nodejs':
                content = `# Dependencies
node_modules/

# Build outputs
dist/
out/
build/
*.js.map

# IDE
.vscode/
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea/

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.*.local

# Testing
coverage/
.nyc_output/
`;
                break;

            case 'python':
                content = `# Byte-compiled
__pycache__/
*.py[cod]
*$py.class

# Virtual environments
venv/
env/
.venv/
.env/

# Distribution
dist/
build/
*.egg-info/

# IDE
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db

# Jupyter
.ipynb_checkpoints/

# Testing
.pytest_cache/
.coverage
htmlcov/
`;
                break;

            case 'go':
                content = `# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary
*.test

# Output
bin/
vendor/

# IDE
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db
`;
                break;

            case 'rust':
                content = `# Generated files
target/

# IDE
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db

# Cargo.lock in libraries
# Cargo.lock
`;
                break;

            case 'java':
                content = `# Compiled class files
*.class

# Build outputs
target/
build/
out/

# IDE
.idea/
*.iml
.vscode/
.classpath
.project
.settings/

# OS files
.DS_Store
Thumbs.db

# Gradle
.gradle/
gradle-app.setting
!gradle-wrapper.jar
`;
                break;

            case 'dotnet':
                content = `# Build outputs
bin/
obj/

# IDE
.vs/
.vscode/
*.user
*.suo
*.userosscache

# OS files
.DS_Store
Thumbs.db

# NuGet
*.nupkg
packages/
`;
                break;

            default:
                content = `# IDE
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
`;
        }

        fs.writeFileSync(gitignorePath, content, 'utf8');
        console.log(`Created .gitignore for ${projectType} project`);
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
        if (!this.git || !this.workspaceRoot) {
            return undefined;
        }
        try {
            // Convert absolute paths to paths relative to git root
            const relativePaths = files.map(file => {
                if (path.isAbsolute(file)) {
                    // Check if file is within the workspace root
                    if (file.startsWith(this.workspaceRoot!)) {
                        return path.relative(this.workspaceRoot!, file);
                    } else {
                        // File is outside current git repository - skip it
                        console.warn(`Skipping file outside repository: ${file}`);
                        return null;
                    }
                }
                return file;
            }).filter((f): f is string => f !== null);

            // Stage the files
            if (relativePaths.length > 0) {
                await this.git.add(relativePaths);
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
     * Checkout to a specific commit (detached HEAD) or restore files
     * This is safer than reset for viewing previous states
     */
    public async checkoutCommit(commitHash: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            // First stash any uncommitted changes
            const status = await this.git.status();
            const hasChanges = status.modified.length > 0 || status.staged.length > 0;
            
            if (hasChanges) {
                await this.git.stash(['push', '-m', 'Vibe Guardian: auto-stash before checkout']);
            }
            
            // Checkout the commit
            await this.git.checkout(commitHash);
            return true;
        } catch (error) {
            console.error('Failed to checkout:', error);
            return false;
        }
    }

    /**
     * Restore all files to a specific commit state without changing HEAD
     * This is the safest rollback method
     */
    public async restoreToCommit(commitHash: string): Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }> {
        if (!this.git) {
            return { success: false, restoredFiles: [], errors: ['Git not initialized'] };
        }
        
        const restoredFiles: string[] = [];
        const errors: string[] = [];
        
        try {
            // Get list of files that changed between the commit and current HEAD
            const diffSummary = await this.git.diffSummary([commitHash, 'HEAD']);
            
            for (const file of diffSummary.files) {
                try {
                    // Restore each file from the commit
                    await this.git.checkout([commitHash, '--', file.file]);
                    restoredFiles.push(file.file);
                } catch (fileError) {
                    errors.push(`Failed to restore ${file.file}: ${fileError}`);
                }
            }
            
            return {
                success: restoredFiles.length > 0,
                restoredFiles,
                errors
            };
        } catch (error) {
            return {
                success: false,
                restoredFiles,
                errors: [`Failed to get diff: ${error}`]
            };
        }
    }

    /**
     * Get all files in the repository at a specific commit
     */
    public async getFilesAtCommit(commitHash: string): Promise<string[]> {
        if (!this.git) {
            return [];
        }
        try {
            const result = await this.git.raw(['ls-tree', '-r', '--name-only', commitHash]);
            return result.trim().split('\n').filter(f => f.length > 0);
        } catch {
            return [];
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
