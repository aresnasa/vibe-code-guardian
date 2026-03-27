/**
 * Vibe Code Guardian - Git Manager
 * Handle Git operations for checkpoint versioning
 */

import * as vscode from 'vscode';
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { DiffInfo, DiffHunk, DEFAULT_SETTINGS } from './types';

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
                        `This will create a .git folder and a comprehensive .gitignore file.`
            },
            'Initialize',
            'Cancel'
        );

        if (result === 'Cancel' || !result) {
            return false;
        }

        try {
            // Initialize git
            this.git = simpleGit(this.workspaceRoot);
            await this.git.init();

            // Always create .gitignore automatically
            await this.createGitignore(projectInfo.type);

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

        // Common ignore patterns for all project types
        const commonIgnore = `# Logs
*.log
logs/
*.log.*
log/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*
.pnpm-debug.log

# Cache and temporary files
.cache/
*.tmp
*.temp
tmp/
temp/
.DS_Store
Thumbs.db
desktop.ini

# IDE and Editor
.vscode/
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea/
*.swp
*.swo
*~
.project
.classpath
.c9/
*.sublime-workspace
.netbeans/

# OS specific
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Testing and Coverage
coverage/
.nyc_output/
.pytest_cache/
.coverage
htmlcov/
*.lcov
.tested

# Playwright
playwright-session/
.pw-cache/
test-results/
blob-report/
playwright/.cache/

# Node.js specific patterns
dist/
out/
build/
`;

        let content = commonIgnore;

        switch (projectType) {
            case 'nodejs':
                content += `# Dependencies
node_modules/
npm-list.json
package-lock.json
yarn.lock
pnpm-lock.yaml

# Build outputs
*.js.map
*.ts.map

# Environment
.env
.env.local
.env.*.local

# Testing
.mocha_output
.jest_cache
`;
                break;

            case 'python':
                content += `# Byte-compiled / optimized / DLL files
__pycache__/
*.py[cod]
*$py.class
*.so

# Virtual environments
venv/
env/
.venv/
ENV/
env.bak/
venv.bak/
.env
.venv

# Distribution / packaging
dist/
build/
*.egg-info/
*.egg
*.whl

# Testing
.pytest_cache/
.tox/
.coverage
htmlcov/
.hypothesis/

# Jupyter Notebook
.ipynb_checkpoints/
*.ipynb

# PyCharm
.idea/

# mypy
.mypy_cache/
.dmypy.json
dmypy.json

# Compiler outputs
*.pyc
`;
                break;

            case 'go':
                content += `# Go binaries for different platforms
/bin/
/dist/
*.exe
*.exe~
*.dll
*.so
*.so.*
*.dylib

# Test binary
*.test

# Output from go coverage
*.out
*.prof

# Dependency directories
vendor/
go.sum

# IDE specific Go settings
.idea/

# vscode Go settings
.vscode/

# Go work files
go.work
go.work.sum

# Generated code
*.pb.go
`;
                break;

            case 'rust':
                content += `# Generated by Cargo
/target/
Cargo.lock
*.rlib

# IDE
.idea/
.vscode/

# Rust test outputs
*.profraw
*.profdata

# Generated docs
/target/doc
`;
                break;

            case 'java':
                content += `# Compiled class files
*.class

# Log Files
log/
logs/

# gradle files
.gradle/
build/
out/

# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties

# IntelliJ
.idea/
*.iml
*.iws
*.ipr
.classpath
.project
.settings/

# NetBeans
nbproject/private/
build/
nbbuild/
dist/
nbdist/
.nb-gradle/

# VS Code
.vscode/
`;
                break;

            case 'dotnet':
                content += `# Build Results
[Dd]ebug/
[Dd]ebugPublic/
[Rr]elease/
[Rr]eleases/
x64/
x86/
[Ww][Ii][Nn]32/
[Aa][Rr][Mm]/
[Aa][Rr][Mm]64/

# Visual Studio cache/options
.vs/
.vscode/

# Visual Studio Code cache
.vscode/

# User-specific files
*.rsuser
*.suo
*.user
*.userosscache
*.sln.docstates

# NuGet
*.nupkg
*.snupkg
packages/
.nuget/

# Test Results
TestResults/
`;
                break;

            case 'ruby':
                content += `# Gem
Gemfile.lock
*.gem
.gem/

# Rails
log/
tmp/
db/*.sqlite3
db/*.sqlite3-journal
vendor/bundle/

# IDE
.idea/
.vscode/

# RVM/rbenv
.rvmrc
.ruby-version
`;
                break;

            case 'php':
                content += `# Composer
vendor/
composer.lock

# PHP
.php_cs.cache

# IDE
.idea/
.vscode/

# Laravel
.env
.env.local
storage/
bootstrap/cache/

# Symfony
var/
public/bundles/
`;
                break;

            default:
                // Generic fallback with comprehensive patterns already included
                break;
        }

        fs.writeFileSync(gitignorePath, content, 'utf8');
        console.log(`Created comprehensive .gitignore for ${projectType} project`);
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
     * Check if remote origin exists
     */
    public async hasRemote(remoteName: string = 'origin'): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            const remotes = await this.git.getRemotes(true);
            return remotes.some(r => r.name === remoteName);
        } catch {
            return false;
        }
    }

    /**
     * Push commits to remote repository
     * @param remoteName Remote name (default: 'origin')
     * @param branchName Branch to push (default: current branch)
     * @param force Whether to force push
     * @returns Object with success status and message
     */
    public async pushToRemote(
        remoteName: string = 'origin',
        branchName?: string,
        force: boolean = false
    ): Promise<{ success: boolean; message: string }> {
        if (!this.git) {
            return { success: false, message: 'Git not initialized' };
        }

        try {
            // Check if remote exists
            const hasRemoteRepo = await this.hasRemote(remoteName);
            if (!hasRemoteRepo) {
                return { success: false, message: `Remote '${remoteName}' not found` };
            }

            // Get current branch if not specified
            const branch = branchName || await this.getCurrentBranch();
            if (!branch) {
                return { success: false, message: 'Could not determine current branch' };
            }

            // Push to remote
            const options = force ? ['--force'] : [];
            await this.git.push(remoteName, branch, options);
            
            return { 
                success: true, 
                message: `Successfully pushed to ${remoteName}/${branch}` 
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Git push failed:', errorMessage);
            return { success: false, message: `Push failed: ${errorMessage}` };
        }
    }

    /**
     * Get all remotes configured in .git/config
     * Returns an array of remote names (e.g. ['origin', 'upstream', 'backup'])
     */
    public async getAllRemotes(): Promise<string[]> {
        if (!this.git) {
            return [];
        }
        try {
            const remotes = await this.git.getRemotes(false);
            return remotes.map(r => r.name);
        } catch {
            return [];
        }
    }

    /**
     * One-click: git add . → git commit -m "<summary>" → git push <all remotes>
     * Reads .git/config to discover all configured remotes and pushes to each.
     * @param commitMessage Custom commit message. If omitted, a summary is generated from status.
     * @returns Per-step result with details of what succeeded and what failed.
     */
    public async quickPushAll(commitMessage?: string): Promise<{
        success: boolean;
        added: boolean;
        committed: boolean;
        pushResults: Array<{ remote: string; success: boolean; message: string }>;
        summary: string;
    }> {
        const result = {
            success: false,
            added: false,
            committed: false,
            pushResults: [] as Array<{ remote: string; success: boolean; message: string }>,
            summary: ''
        };

        if (!this.git) {
            result.summary = 'Git not initialized';
            return result;
        }

        try {
            // Step 1: git add .
            await this.git.add('.');
            result.added = true;

            // Step 2: build commit message from status if not provided
            const status = await this.git.status();
            const totalChanged = status.modified.length + status.created.length +
                status.deleted.length + status.renamed.length + status.not_added.length;

            if (totalChanged === 0 && status.staged.length === 0) {
                result.summary = '没有需要提交的更改';
                result.success = true; // Nothing to do is not a failure
                return result;
            }

            const message = commitMessage || this.buildQuickCommitMessage(status);

            // Step 3: git commit
            await this.git.commit(message);
            result.committed = true;

            // Step 4: discover all remotes from .git/config
            const remotes = await this.getAllRemotes();
            if (remotes.length === 0) {
                result.summary = `已提交: "${message}"，但没有配置远端仓库`;
                result.success = true;
                return result;
            }

            // Step 5: push to every remote
            const branch = await this.getCurrentBranch();
            for (const remote of remotes) {
                try {
                    await this.git.push(remote, branch || 'HEAD');
                    result.pushResults.push({ remote, success: true, message: `✓ ${remote}` });
                } catch (pushErr) {
                    const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
                    result.pushResults.push({ remote, success: false, message: `✗ ${remote}: ${msg}` });
                }
            }

            const allPushed = result.pushResults.every(r => r.success);
            result.success = allPushed;
            const pushSummary = result.pushResults.map(r => r.message).join(', ');
            result.summary = `提交: "${message}" → 推送 [${pushSummary}]`;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            result.summary = `操作失败: ${errMsg}`;
        }

        return result;
    }

    /**
     * Generate a concise commit message from git status (used by quickPushAll)
     */
    private buildQuickCommitMessage(status: import('simple-git').StatusResult): string {
        const parts: string[] = [];
        if (status.modified.length > 0) { parts.push(`修改 ${status.modified.length} 个文件`); }
        if (status.created.length + status.not_added.length > 0) {
            parts.push(`新增 ${status.created.length + status.not_added.length} 个文件`);
        }
        if (status.deleted.length > 0) { parts.push(`删除 ${status.deleted.length} 个文件`); }
        if (status.renamed.length > 0) { parts.push(`重命名 ${status.renamed.length} 个文件`); }
        return parts.length > 0 ? parts.join('，') : '代码更新';
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
     * Get detailed changed files info from Git status
     * This synchronizes with actual Git state before saving checkpoints
     * Large files are automatically filtered out
     */
    public async getDetailedChangedFiles(maxFileSize?: number): Promise<Array<{
        path: string;
        changeType: 'added' | 'modified' | 'deleted' | 'renamed';
        staged: boolean;
    }>> {
        if (!this.git) {
            return [];
        }
        try {
            const status = await this.git.status();
            const files: Array<{
                path: string;
                changeType: 'added' | 'modified' | 'deleted' | 'renamed';
                staged: boolean;
            }> = [];

            // Modified files
            for (const file of status.modified) {
                if (!this.isLargeFile(file, maxFileSize)) {
                    files.push({ path: file, changeType: 'modified', staged: false });
                }
            }

            // Staged modified files
            for (const file of status.staged) {
                if (!files.find(f => f.path === file) && !this.isLargeFile(file, maxFileSize)) {
                    files.push({ path: file, changeType: 'modified', staged: true });
                }
            }

            // Created/new files
            for (const file of status.created) {
                if (!this.isLargeFile(file, maxFileSize)) {
                    files.push({ path: file, changeType: 'added', staged: true });
                }
            }

            // Untracked files (not yet added)
            for (const file of status.not_added) {
                if (!files.find(f => f.path === file) && !this.isLargeFile(file, maxFileSize)) {
                    files.push({ path: file, changeType: 'added', staged: false });
                }
            }

            // Deleted files (no need to check size for deleted files)
            for (const file of status.deleted) {
                files.push({ path: file, changeType: 'deleted', staged: false });
            }

            // Renamed files
            for (const renamed of status.renamed) {
                if (!this.isLargeFile(renamed.to, maxFileSize)) {
                    files.push({ path: renamed.to, changeType: 'renamed', staged: true });
                }
            }

            return files;
        } catch (error) {
            console.error('Failed to get detailed changed files:', error);
            return [];
        }
    }

    /**
     * Sync check: verify file exists in Git history or working tree
     */
    public async fileExistsInGit(filePath: string, commitHash?: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            if (commitHash) {
                // Check if file exists at specific commit
                await this.git.show([`${commitHash}:${filePath}`]);
                return true;
            } else {
                // Check if file is tracked
                const result = await this.git.raw(['ls-files', filePath]);
                return result.trim().length > 0;
            }
        } catch {
            return false;
        }
    }

    /**
     * Stage all changes and create commit - returns actual changed files
     */
    public async stageAndCommitAll(message: string, maxFileSize?: number): Promise<{
        success: boolean;
        commitHash?: string;
        changedFiles: string[];
        skippedLargeFiles: string[];
    }> {
        if (!this.git) {
            return { success: false, changedFiles: [], skippedLargeFiles: [] };
        }
        try {
            // Get changed files BEFORE staging
            const changedFiles = await this.getChangedFiles();
            
            if (changedFiles.length === 0) {
                return { success: false, changedFiles: [], skippedLargeFiles: [] };
            }

            // Filter out large files
            const { kept, skipped } = this.filterLargeFiles(changedFiles, maxFileSize);
            
            if (skipped.length > 0) {
                console.log(`⏭️  Skipped ${skipped.length} large file(s) from commit: ${skipped.join(', ')}`);
            }

            if (kept.length === 0) {
                console.log('No files to commit after filtering large files');
                return { success: false, changedFiles: [], skippedLargeFiles: skipped };
            }

            // Stage only non-large files (use relative paths)
            const relativePaths = kept.map(f => {
                if (path.isAbsolute(f) && this.workspaceRoot) {
                    return path.relative(this.workspaceRoot, f);
                }
                return f;
            });
            await this.git.add(relativePaths);
            
            // Commit
            const result = await this.git.commit(message);
            
            return {
                success: true,
                commitHash: result.commit,
                changedFiles: kept,
                skippedLargeFiles: skipped
            };
        } catch (error) {
            console.error('Failed to stage and commit:', error);
            return { success: false, changedFiles: [], skippedLargeFiles: [] };
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
            // First, try to get the list of changed files between commit and HEAD
            let filesToRestore: string[] = [];
            
            try {
                // Get files that differ between the commit and current HEAD
                const diffSummary = await this.git.diffSummary([commitHash, 'HEAD']);
                filesToRestore = diffSummary.files.map(f => f.file);
            } catch (diffError) {
                console.warn('Failed to get diff summary:', diffError);
            }
            
            // If no diff found, try getting files changed since that commit
            if (filesToRestore.length === 0) {
                try {
                    // Get all files that were modified after this commit
                    const log = await this.git.log({
                        from: commitHash,
                        to: 'HEAD',
                        '--name-only': null
                    });
                    
                    const files = new Set<string>();
                    for (const commit of log.all) {
                        // Parse the diff to get file names
                        if ((commit as any).diff) {
                            const diff = (commit as any).diff;
                            if (diff.files) {
                                diff.files.forEach((f: any) => files.add(f.file));
                            }
                        }
                    }
                    filesToRestore = Array.from(files);
                } catch (logError) {
                    console.warn('Failed to get log:', logError);
                }
            }
            
            // If still no files, use git checkout to restore the entire tree
            if (filesToRestore.length === 0) {
                try {
                    // Restore all tracked files to the commit state
                    await this.git.checkout([commitHash, '--', '.']);
                    return {
                        success: true,
                        restoredFiles: ['All tracked files'],
                        errors: []
                    };
                } catch (checkoutError) {
                    errors.push(`Failed to checkout all files: ${checkoutError}`);
                }
            } else {
                // Restore each file individually
                for (const file of filesToRestore) {
                    try {
                        await this.git.checkout([commitHash, '--', file]);
                        restoredFiles.push(file);
                    } catch (fileError) {
                        errors.push(`Failed to restore ${file}: ${fileError}`);
                    }
                }
            }
            
            return {
                success: restoredFiles.length > 0 || errors.length === 0,
                restoredFiles,
                errors
            };
        } catch (error) {
            return {
                success: false,
                restoredFiles,
                errors: [`Failed to restore: ${error}`]
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
     * Check if a commit exists
     */
    public async commitExists(commitHash: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            await this.git.revparse([commitHash]);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get Vibe Guardian commits from git history
     */
    public async getVibeGuardianCommits(maxCount: number = 100): Promise<Array<{
        hash: string;
        date: string;
        message: string;
    }>> {
        if (!this.git) {
            return [];
        }
        try {
            // --fixed-strings prevents git from interpreting [Vibe Guardian] as a
            // regex character-class (which would match almost any commit message).
            const log = await this.git.log({ maxCount, '--grep': '[Vibe Guardian]', '--fixed-strings': null });
            return log.all.map(commit => ({
                hash: commit.hash,
                date: commit.date,
                message: commit.message
            }));
        } catch {
            return [];
        }
    }

    /**
     * Clean up orphaned Vibe Guardian commits (optional, use with caution)
     * This removes commits that are no longer needed
     */
    public async cleanupOrphanedCommits(): Promise<{
        success: boolean;
        message: string;
    }> {
        // This is a dangerous operation, just return info for now
        return {
            success: true,
            message: 'Git history cleanup should be done manually with git commands for safety'
        };
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

    /**
     * Check if there are uncommitted changes
     */
    public async hasUncommittedChanges(): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            const status = await this.git.status();
            return status.modified.length > 0 || 
                   status.staged.length > 0 || 
                   status.not_added.length > 0 ||
                   status.deleted.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Checkout a branch
     */
    public async checkoutBranch(branchName: string): Promise<boolean> {
        if (!this.git) {
            return false;
        }
        try {
            await this.git.checkout(branchName);
            return true;
        } catch (error) {
            console.error('Failed to checkout branch:', error);
            return false;
        }
    }

    /**
     * Get HEAD info - whether in detached state and current commit
     */
    public async getHeadInfo(): Promise<{
        isDetached: boolean;
        currentCommit: string;
        branch?: string;
    }> {
        if (!this.git) {
            return { isDetached: false, currentCommit: '' };
        }
        try {
            const status = await this.git.status();
            const commit = await this.git.revparse(['HEAD']);
            
            // If status.current is null or starts with HEAD, we're detached
            const isDetached = !status.current || status.current === 'HEAD' || status.detached;
            
            return {
                isDetached: isDetached || false,
                currentCommit: commit.trim(),
                branch: isDetached ? undefined : status.current || undefined
            };
        } catch {
            return { isDetached: false, currentCommit: '' };
        }
    }

    /**
     * Create a new branch from current HEAD
     */
    public async createBranchFromHere(branchName: string): Promise<boolean> {
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
     * Check if a file exceeds the maximum allowed size for tracking
     * @param filePath Absolute or relative path to the file
     * @param maxSize Maximum size in bytes (default from DEFAULT_SETTINGS)
     * @returns true if the file is too large to track
     */
    public isLargeFile(filePath: string, maxSize?: number): boolean {
        const limit = maxSize ?? DEFAULT_SETTINGS.maxFileSize;
        try {
            const absPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.workspaceRoot || '', filePath);
            const stat = fs.statSync(absPath);
            return stat.size > limit;
        } catch {
            // File doesn't exist or can't be read, don't treat as large
            return false;
        }
    }

    /**
     * Filter out large files from a list of file paths
     * @param files Array of file paths (absolute or relative)
     * @param maxSize Maximum file size in bytes
     * @returns Filtered array with large files removed
     */
    public filterLargeFiles(files: string[], maxSize?: number): { kept: string[]; skipped: string[] } {
        const kept: string[] = [];
        const skipped: string[] = [];
        for (const file of files) {
            if (this.isLargeFile(file, maxSize)) {
                skipped.push(file);
                console.log(`⏭️  Skipping large file: ${file}`);
            } else {
                kept.push(file);
            }
        }
        return { kept, skipped };
    }

    // ============================================
    // Git Graph Methods
    // ============================================

    /**
     * Get commits with parent info for graph visualization.
     * Uses git.raw() with custom --format to get parent hashes.
     */
    public async getGraphCommits(maxCount: number = 200, guardianOnly: boolean = false): Promise<Array<{
        hash: string;
        abbreviatedHash: string;
        parents: string[];
        authorName: string;
        authorEmail: string;
        date: string;
        message: string;
        refs: string;
    }>> {
        if (!this.git) { return []; }
        try {
            const SEP = '<<GG_SEP>>';
            const RECORD_SEP = '<<GG_REC>>';
            const formatStr = [
                '%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%D'
            ].join(SEP);

            const args = [
                'log',
                '--all',
                `--max-count=${maxCount}`,
                `--format=${formatStr}${RECORD_SEP}`,
            ];

            if (guardianOnly) {
                // Use --fixed-strings so git treats the pattern as a literal string,
                // not an ERE regex where [Vibe Guardian] would be a char-class matching
                // nearly every commit message.
                args.push('--fixed-strings', '--grep=[Vibe Guardian]');
            }

            const raw = await this.git.raw(args);
            if (!raw || !raw.trim()) { return []; }

            const records = raw.split(RECORD_SEP).filter(r => r.trim());
            return records.map(record => {
                const parts = record.trim().split(SEP);
                return {
                    hash: parts[0] || '',
                    abbreviatedHash: parts[1] || '',
                    parents: (parts[2] || '').split(' ').filter(p => p),
                    authorName: parts[3] || '',
                    authorEmail: parts[4] || '',
                    date: parts[5] || '',
                    message: parts[6] || '',
                    refs: parts[7] || ''
                };
            }).filter(c => c.hash);
        } catch {
            return [];
        }
    }

    /**
     * Get all branches (local and remote) with details
     */
    public async getAllBranches(): Promise<Array<{
        name: string;
        isCurrent: boolean;
        commitHash: string;
        isRemote: boolean;
    }>> {
        if (!this.git) { return []; }
        try {
            const summary = await this.git.branch(['-a', '-v', '--no-abbrev']);
            return summary.all.map(branchName => {
                const branch = summary.branches[branchName];
                return {
                    name: branchName,
                    isCurrent: branch?.current ?? false,
                    commitHash: branch?.commit ?? '',
                    isRemote: branchName.startsWith('remotes/')
                };
            });
        } catch {
            return [];
        }
    }

    /**
     * Get all tags with their commit hashes
     */
    public async getAllTags(): Promise<Array<{ name: string; commitHash: string }>> {
        if (!this.git) { return []; }
        try {
            const tagResult = await this.git.tags();
            const result: Array<{ name: string; commitHash: string }> = [];
            for (const tag of tagResult.all) {
                try {
                    const hash = await this.git.raw(['rev-parse', tag]);
                    result.push({ name: tag, commitHash: hash.trim() });
                } catch {
                    result.push({ name: tag, commitHash: '' });
                }
            }
            return result;
        } catch {
            return [];
        }
    }

    /**
     * Get changed files with stats for a specific commit
     */
    public async getCommitFileChanges(commitHash: string): Promise<Array<{
        path: string;
        insertions: number;
        deletions: number;
        binary: boolean;
        status: string;
    }>> {
        if (!this.git) { return []; }
        try {
            const numstat = await this.git.raw([
                'diff-tree', '--no-commit-id', '-r', '--numstat', commitHash
            ]);
            const nameStatus = await this.git.raw([
                'diff-tree', '--no-commit-id', '-r', '--name-status', commitHash
            ]);

            const statusMap = new Map<string, string>();
            for (const line of nameStatus.trim().split('\n')) {
                if (!line.trim()) { continue; }
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    statusMap.set(parts[parts.length - 1], parts[0]);
                }
            }

            return numstat.trim().split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const parts = line.split('\t');
                    const binary = parts[0] === '-';
                    const filePath = parts[2] || '';
                    const statusLetter = statusMap.get(filePath) || 'M';
                    let status = 'modified';
                    if (statusLetter === 'A') { status = 'added'; }
                    else if (statusLetter === 'D') { status = 'deleted'; }
                    else if (statusLetter.startsWith('R')) { status = 'renamed'; }
                    else if (statusLetter.startsWith('C')) { status = 'copied'; }
                    return {
                        path: filePath,
                        insertions: binary ? 0 : parseInt(parts[0] || '0', 10),
                        deletions: binary ? 0 : parseInt(parts[1] || '0', 10),
                        binary,
                        status
                    };
                }).filter(f => f.path);
        } catch {
            return [];
        }
    }

    // ============================================
    // Multi-user / Multi-branch / Advanced Git Operations
    // ============================================

    /**
     * Get all contributors (unique authors) with commit statistics
     */
    public async getContributors(): Promise<Array<{
        name: string;
        email: string;
        commitCount: number;
        firstCommitDate: string;
        lastCommitDate: string;
    }>> {
        if (!this.git) { return []; }
        try {
            // Use git log with shortlog format
            const raw = await this.git.raw([
                'log', '--all', '--format=%an\t%ae\t%aI'
            ]);
            if (!raw.trim()) { return []; }

            const authorMap = new Map<string, {
                name: string;
                email: string;
                commitCount: number;
                dates: string[];
            }>();

            for (const line of raw.trim().split('\n')) {
                if (!line.trim()) { continue; }
                const parts = line.split('\t');
                if (parts.length < 3) { continue; }
                const name = parts[0].trim();
                const email = parts[1].trim();
                const date = parts[2].trim();
                const key = email.toLowerCase();
                if (!authorMap.has(key)) {
                    authorMap.set(key, { name, email, commitCount: 0, dates: [] });
                }
                const entry = authorMap.get(key)!;
                entry.commitCount++;
                entry.dates.push(date);
            }

            return Array.from(authorMap.values()).map(a => ({
                name: a.name,
                email: a.email,
                commitCount: a.commitCount,
                firstCommitDate: a.dates[a.dates.length - 1] || '',
                lastCommitDate: a.dates[0] || ''
            })).sort((a, b) => b.commitCount - a.commitCount);
        } catch (error) {
            console.error('Failed to get contributors:', error);
            return [];
        }
    }

    /**
     * Get stash list
     */
    public async getStashList(): Promise<Array<{
        index: number;
        ref: string;
        branch: string;
        message: string;
        authorName: string;
        date: string;
    }>> {
        if (!this.git) { return []; }
        try {
            const raw = await this.git.raw([
                'stash', 'list', '--format=%gd\t%an\t%aI\t%gs'
            ]);
            if (!raw.trim()) { return []; }

            return raw.trim().split('\n').map((line, index) => {
                const parts = line.split('\t');
                const ref = parts[0] || `stash@{${index}}`;
                const authorName = parts[1] || '';
                const date = parts[2] || '';
                const gs = parts[3] || '';
                // gs format: "WIP on <branch>: <hash> <message>" or "On <branch>: <message>"
                const branchMatch = gs.match(/^(?:WIP on|On)\s+([^:]+):/);
                const branch = branchMatch ? branchMatch[1] : '';
                const message = gs;
                return { index, ref, branch, message, authorName, date };
            });
        } catch {
            return [];
        }
    }

    /**
     * Apply a stash by index
     */
    public async applyStash(index: number): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            await this.git.raw(['stash', 'apply', `stash@{${index}}`]);
            return { success: true, message: `Applied stash@{${index}}` };
        } catch (error) {
            return { success: false, message: `Apply stash failed: ${error}` };
        }
    }

    /**
     * Pop a stash by index
     */
    public async popStash(index: number): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            await this.git.raw(['stash', 'pop', `stash@{${index}}`]);
            return { success: true, message: `Popped stash@{${index}}` };
        } catch (error) {
            return { success: false, message: `Pop stash failed: ${error}` };
        }
    }

    /**
     * Drop a stash by index
     */
    public async dropStash(index: number): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            await this.git.raw(['stash', 'drop', `stash@{${index}}`]);
            return { success: true, message: `Dropped stash@{${index}}` };
        } catch (error) {
            return { success: false, message: `Drop stash failed: ${error}` };
        }
    }

    /**
     * Create a stash with optional message
     */
    public async createStash(message?: string): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            if (message) {
                await this.git.stash(['push', '-m', message]);
            } else {
                await this.git.stash(['push']);
            }
            return { success: true, message: 'Stash created' };
        } catch (error) {
            return { success: false, message: `Create stash failed: ${error}` };
        }
    }

    /**
     * Get list of remotes with URLs
     */
    public async getRemoteList(): Promise<Array<{
        name: string;
        fetchUrl: string;
        pushUrl: string;
    }>> {
        if (!this.git) { return []; }
        try {
            const remotes = await this.git.getRemotes(true);
            return remotes.map(r => ({
                name: r.name,
                fetchUrl: r.refs.fetch || '',
                pushUrl: r.refs.push || ''
            }));
        } catch {
            return [];
        }
    }

    /**
     * Fetch from a remote (or all remotes)
     */
    public async fetchRemote(remote: string = '--all'): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            if (remote === '--all') {
                await this.git.fetch(['--all', '--prune']);
            } else {
                await this.git.fetch([remote, '--prune']);
            }
            return { success: true, message: `Fetched from ${remote}` };
        } catch (error) {
            return { success: false, message: `Fetch failed: ${error}` };
        }
    }

    /**
     * Pull a branch from remote
     */
    public async pullBranch(
        remote: string = 'origin',
        branch?: string,
        rebase: boolean = false
    ): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            const options = rebase ? ['--rebase'] : [];
            if (branch) {
                await this.git.pull(remote, branch, options);
            } else {
                await this.git.pull(remote, undefined, options);
            }
            return { success: true, message: `Pulled from ${remote}${branch ? `/${branch}` : ''}` };
        } catch (error) {
            return { success: false, message: `Pull failed: ${error}` };
        }
    }

    /**
     * Merge a branch into current branch
     */
    public async mergeBranch(
        branch: string,
        strategy: 'ff' | 'no-ff' | 'squash' = 'no-ff'
    ): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            const args = ['merge'];
            if (strategy === 'no-ff') { args.push('--no-ff'); }
            if (strategy === 'squash') { args.push('--squash'); }
            args.push(branch);
            await this.git.raw(args);
            return { success: true, message: `Merged '${branch}' (${strategy})` };
        } catch (error) {
            return { success: false, message: `Merge failed: ${error}` };
        }
    }

    /**
     * Rebase current branch onto another
     */
    public async rebaseBranch(baseBranch: string): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            await this.git.rebase([baseBranch]);
            return { success: true, message: `Rebased onto '${baseBranch}'` };
        } catch (error) {
            return { success: false, message: `Rebase failed: ${error}` };
        }
    }

    /**
     * Delete a branch
     */
    public async deleteBranch(
        branch: string,
        force: boolean = false
    ): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            const args = force ? ['-D', branch] : ['-d', branch];
            await this.git.branch(args);
            return { success: true, message: `Deleted branch '${branch}'` };
        } catch (error) {
            return { success: false, message: `Delete branch failed: ${error}` };
        }
    }

    /**
     * Rename a branch
     */
    public async renameBranch(oldName: string, newName: string): Promise<{ success: boolean; message: string }> {
        if (!this.git) { return { success: false, message: 'Git not initialized' }; }
        try {
            await this.git.branch(['-m', oldName, newName]);
            return { success: true, message: `Renamed '${oldName}' to '${newName}'` };
        } catch (error) {
            return { success: false, message: `Rename branch failed: ${error}` };
        }
    }

    /**
     * Push a branch to remote
     */
    public async pushBranch(
        remote: string,
        branch: string,
        force: boolean = false
    ): Promise<{ success: boolean; message: string }> {
        const result = await this.pushToRemote(remote, branch, force);
        return result;
    }

    /**
     * Get branches with tracking info (ahead/behind counts)
     */
    public async getBranchDetails(): Promise<Array<{
        name: string;
        isCurrent: boolean;
        commitHash: string;
        isRemote: boolean;
        ahead: number;
        behind: number;
        tracking?: string;
    }>> {
        if (!this.git) { return []; }
        try {
            const raw = await this.git.raw([
                'branch', '-vv', '--all', '--no-abbrev'
            ]);
            if (!raw.trim()) { return []; }

            const results: Array<{
                name: string;
                isCurrent: boolean;
                commitHash: string;
                isRemote: boolean;
                ahead: number;
                behind: number;
                tracking?: string;
            }> = [];

            for (const line of raw.trim().split('\n')) {
                if (!line.trim()) { continue; }
                const isCurrent = line.startsWith('* ');
                const stripped = line.replace(/^\*?\s+/, '');
                // Format: name hash [tracking: ahead X, behind Y] message
                const parts = stripped.split(/\s+/);
                const name = parts[0];
                const hash = parts[1] || '';
                const isRemote = name.startsWith('remotes/');

                // Parse ahead/behind from bracket info
                const bracketMatch = line.match(/\[([^\]]+)\]/);
                let tracking: string | undefined;
                let ahead = 0;
                let behind = 0;
                if (bracketMatch) {
                    const info = bracketMatch[1];
                    const trackMatch = info.match(/^([^:]+)/);
                    if (trackMatch) { tracking = trackMatch[1].trim(); }
                    const aheadMatch = info.match(/ahead (\d+)/);
                    const behindMatch = info.match(/behind (\d+)/);
                    if (aheadMatch) { ahead = parseInt(aheadMatch[1], 10); }
                    if (behindMatch) { behind = parseInt(behindMatch[1], 10); }
                }

                results.push({ name, isCurrent, commitHash: hash, isRemote, ahead, behind, tracking });
            }

            return results;
        } catch {
            // Fall back to simple branch list
            return this.getAllBranches().then(branches => branches.map(b => ({
                ...b,
                ahead: 0,
                behind: 0,
                tracking: undefined
            })));
        }
    }

    /**
     * Get git blame information for a file.
     * Returns per-line blame data: hash, author, date, summary.
     */
    public async getBlame(filePath: string): Promise<BlameInfo[]> {
        if (!this.git) { return []; }
        try {
            // --porcelain gives machine-readable output
            const raw = await this.git.raw([
                'blame', '--porcelain', '--', filePath
            ]);
            if (!raw.trim()) { return []; }
            return this.parseBlame(raw);
        } catch {
            return [];
        }
    }

    /**
     * Parse raw `git blame --porcelain` output into BlameInfo array.
     * Each record starts with "<40-char hash> <orig> <final> <count>" line
     * followed by header key-value lines, then a tab-prefixed source line.
     */
    private parseBlame(raw: string): BlameInfo[] {
        const lines = raw.split('\n');
        const commits = new Map<string, Partial<BlameInfo>>();
        const result: BlameInfo[] = [];
        let currentHash = '';
        let currentLine = 0;

        for (const line of lines) {
            // Header line: "<hash> <origLine> <finalLine> [groupCount]"
            const headerMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
            if (headerMatch) {
                currentHash = headerMatch[1];
                currentLine = parseInt(headerMatch[2], 10);
                if (!commits.has(currentHash)) {
                    commits.set(currentHash, { hash: currentHash });
                }
                continue;
            }
            // Source line (tab prefix)
            if (line.startsWith('\t')) {
                const c = commits.get(currentHash);
                if (c) {
                    result.push({
                        lineNumber: currentLine,
                        hash: c.hash ?? currentHash,
                        shortHash: (c.hash ?? currentHash).substring(0, 7),
                        authorName: c.authorName ?? 'Unknown',
                        authorEmail: c.authorEmail ?? '',
                        date: c.date ?? '',
                        summary: c.summary ?? '',
                        isUncommitted: (c.hash ?? '').startsWith('0000000')
                    });
                }
                continue;
            }
            // Key-value lines
            const c = commits.get(currentHash);
            if (!c) { continue; }
            if (line.startsWith('author ')) {
                c.authorName = line.slice('author '.length);
            } else if (line.startsWith('author-mail ')) {
                c.authorEmail = line.slice('author-mail '.length).replace(/[<>]/g, '');
            } else if (line.startsWith('author-time ')) {
                // Unix timestamp → ISO string
                const ts = parseInt(line.slice('author-time '.length), 10);
                c.date = new Date(ts * 1000).toISOString();
            } else if (line.startsWith('summary ')) {
                c.summary = line.slice('summary '.length);
            }
        }
        return result;
    }

    /**
     * Clone a repository for verification testing
     */
    public async cloneRepository(repoUrl: string, targetDir: string): Promise<{ success: boolean; message: string }> {
        try {
            const gitInstance = simpleGit(targetDir);
            await gitInstance.clone(repoUrl);
            return { success: true, message: `Cloned ${repoUrl} to ${targetDir}` };
        } catch (error) {
            return { success: false, message: `Failed to clone: ${String(error)}` };
        }
    }

    /**
     * Get all branches with tracking information
     */
    public async getAllBranchesWithTracking(): Promise<Array<{
        name: string;
        isCurrent: boolean;
        commitHash: string;
        isRemote: boolean;
        tracking?: string;
        ahead: number;
        behind: number;
        authorEmail?: string;
    }>> {
        if (!this.git) { return []; }
        try {
            const branches = await this.git.branch(['-v']);
            const result: Array<{
                name: string;
                isCurrent: boolean;
                commitHash: string;
                isRemote: boolean;
                tracking?: string;
                ahead: number;
                behind: number;
                authorEmail?: string;
            }> = [];

            for (const branchName of Object.keys(branches.all)) {
                const branch = (branches.all as Record<string, any>)[branchName];
                const tracking = branch.tracking;

                // Get ahead/behind counts
                let ahead = 0;
                let behind = 0;
                if (tracking && tracking.indexOf('/') !== -1) {
                    try {
                        const aheadBehind = await this.git.raw(['rev-list', '--left-right', '--count', `${tracking}...HEAD`]);
                        const parts = aheadBehind.trim().split('\t');
                        if (parts.length === 2) {
                            ahead = parseInt(parts[0], 10);
                            behind = parseInt(parts[1], 10);
                        }
                    } catch {
                        // Ignore errors in ahead/behind calculation
                    }
                }

                // Get author email from latest commit
                let authorEmail = '';
                try {
                    const logOutput = await this.git.log({ from: branch.name, maxCount: 1, format: '%ae' });
                    if (logOutput && logOutput.latest) {
                        authorEmail = typeof logOutput.latest === 'string' ? logOutput.latest : '';
                    }
                } catch {
                    // Ignore errors in author lookup
                }

                result.push({
                    name: branchName,
                    isCurrent: branch.current || false,
                    commitHash: branch.commit || '',
                    isRemote: false,
                    tracking,
                    ahead,
                    behind,
                    authorEmail
                });
            }

            return result;
        } catch {
            return [];
        }
    }

    public dispose(): void {
        // Cleanup if needed
    }
}

/**
 * Represents a single line's blame information.
 */
export interface BlameInfo {
    lineNumber: number;
    hash: string;
    shortHash: string;
    authorName: string;
    authorEmail: string;
    /** ISO 8601 date string */
    date: string;
    summary: string;
    isUncommitted: boolean;
}
