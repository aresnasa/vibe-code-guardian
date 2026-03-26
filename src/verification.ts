/**
 * Vibe Code Guardian - Verification Utilities
 * Functions for cloning and testing projects to verify correct functionality
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitManager } from './gitManager';

export interface VerificationResult {
    success: boolean;
    message: string;
    details?: string;
    data?: any;
}

export class ProjectVerifier {
    private gitManager: GitManager;

    constructor(gitManager: GitManager) {
        this.gitManager = gitManager;
    }

    /**
     * Clone a repository for verification testing
     */
    public async cloneForVerification(repoUrl: string, targetDir: string): Promise<VerificationResult> {
        try {
            const outputPath = path.join(targetDir, `test-${Date.now()}`);

            // Check if directory exists and is empty
            try {
                await fs.access(outputPath);
                return {
                    success: false,
                    message: 'Directory already exists',
                    details: `Target directory ${outputPath} already exists`
                };
            } catch {
                // Directory doesn't exist, which is fine
            }

            // Clone the repository
            await this.gitManager.cloneRepository(repoUrl, outputPath);

            return {
                success: true,
                message: 'Repository cloned successfully',
                details: `Cloned ${repoUrl} to ${outputPath}`,
                data: { repoUrl, outputPath }
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to clone repository',
                details: String(error)
            };
        }
    }

    /**
     * Verify git repository structure
     */
    public async verifyGitStructure(repoPath: string): Promise<VerificationResult> {
        try {
            const checks: { name: string; passed: boolean; message: string }[] = [];

            // Check if .git directory exists
            try {
                await fs.access(path.join(repoPath, '.git'));
                checks.push({ name: '.git directory', passed: true, message: 'Found .git directory' });
            } catch {
                checks.push({ name: '.git directory', passed: false, message: '.git directory not found' });
            }

            // Check if HEAD exists
            try {
                await fs.access(path.join(repoPath, '.git', 'HEAD'));
                checks.push({ name: 'HEAD file', passed: true, message: 'HEAD file exists' });
            } catch {
                checks.push({ name: 'HEAD file', passed: false, message: 'HEAD file not found' });
            }

            // Check git configuration
            const configPath = path.join(repoPath, '.git', 'config');
            try {
                await fs.access(configPath);
                checks.push({ name: 'Git config', passed: true, message: 'Git config exists' });
            } catch {
                checks.push({ name: 'Git config', passed: false, message: 'Git config not found' });
            }

            const allPassed = checks.every(check => check.passed);
            return {
                success: allPassed,
                message: allPassed ? 'Git structure verified successfully' : 'Git structure verification failed',
                details: checks.map(c => `${c.passed ? '✅' : '❌'} ${c.name}: ${c.message}`).join('\n'),
                data: { checks, allPassed }
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to verify git structure',
                details: String(error)
            };
        }
    }

    /**
     * Verify checkpoint functionality
     */
    public async verifyCheckpointFunctionality(repoPath: string): Promise<VerificationResult> {
        try {
            const checks: { name: string; passed: boolean; message: string }[] = [];

            // Check for Guardian-specific patterns in commits
            try {
                const commits = await this.gitManager.getGraphCommits(10, true);
                const guardianCommits = commits.filter(c => c.message.includes('[Vibe Guardian]'));

                if (guardianCommits.length > 0) {
                    checks.push({
                        name: 'Guardian commits',
                        passed: true,
                        message: `Found ${guardianCommits.length} Guardian commits`
                    });
                } else {
                    checks.push({
                        name: 'Guardian commits',
                        passed: false,
                        message: 'No Guardian commits found'
                    });
                }
            } catch (error) {
                checks.push({
                    name: 'Guardian commits',
                    passed: false,
                    message: `Failed to check commits: ${String(error)}`
                });
            }

            const allPassed = checks.every(check => check.passed);
            return {
                success: allPassed,
                message: allPassed ? 'Checkpoint functionality verified' : 'Checkpoint functionality verification failed',
                details: checks.map(c => `${c.passed ? '✅' : '❌'} ${c.name}: ${c.message}`).join('\n'),
                data: { checks, allPassed }
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to verify checkpoint functionality',
                details: String(error)
            };
        }
    }

    /**
     * Verify multi-user/multi-branch display functionality
     */
    public async verifyMultiUserSupport(repoPath: string): Promise<VerificationResult> {
        try {
            const checks: { name: string; passed: boolean; message: string }[] = [];

            // Check contributors functionality
            try {
                const contributors = await this.gitManager.getContributors();
                if (contributors.length > 0) {
                    checks.push({
                        name: 'Contributors',
                        passed: true,
                        message: `Found ${contributors.length} contributors`
                    });
                } else {
                    checks.push({
                        name: 'Contributors',
                        passed: false,
                        message: 'No contributors found'
                    });
                }
            } catch (error) {
                checks.push({
                    name: 'Contributors',
                    passed: false,
                    message: `Failed to get contributors: ${String(error)}`
                });
            }

            // Check branches functionality
            try {
                const branches = await this.gitManager.getAllBranches();
                if (branches.length > 0) {
                    checks.push({
                        name: 'Branches',
                        passed: true,
                        message: `Found ${branches.length} branches`
                    });
                } else {
                    checks.push({
                        name: 'Branches',
                        passed: false,
                        message: 'No branches found'
                    });
                }
            } catch (error) {
                checks.push({
                    name: 'Branches',
                    passed: false,
                    message: `Failed to get branches: ${String(error)}`
                });
            }

            // Check remotes functionality
            try {
                const remotes = await this.gitManager.getRemoteList();
                if (remotes.length > 0) {
                    checks.push({
                        name: 'Remotes',
                        passed: true,
                        message: `Found ${remotes.length} remotes`
                    });
                } else {
                    checks.push({
                        name: 'Remotes',
                        passed: false,
                        message: 'No remotes found'
                    });
                }
            } catch (error) {
                checks.push({
                    name: 'Remotes',
                    passed: false,
                    message: `Failed to get remotes: ${String(error)}`
                });
            }

            const allPassed = checks.every(check => check.passed);
            return {
                success: allPassed,
                message: allPassed ? 'Multi-user support verified' : 'Multi-user support verification failed',
                details: checks.map(c => `${c.passed ? '✅' : '❌'} ${c.name}: ${c.message}`).join('\n'),
                data: { checks, allPassed }
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to verify multi-user support',
                details: String(error)
            };
        }
    }

    /**
     * Run comprehensive verification test
     */
    public async runComprehensiveVerification(repoUrl?: string, repoPath?: string): Promise<{
        structure: VerificationResult;
        checkpoints: VerificationResult;
        multiUser: VerificationResult;
        clone?: VerificationResult | undefined;
    }> {
        const currentPath = repoPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        const structureResult = await this.verifyGitStructure(currentPath);
        const checkpointResult = await this.verifyCheckpointFunctionality(currentPath);
        const multiUserResult = await this.verifyMultiUserSupport(currentPath);

        let cloneResult: VerificationResult | undefined = undefined;
        if (repoUrl && vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) {
            const targetDir = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.verification');
            cloneResult = await this.cloneForVerification(repoUrl, targetDir);
        }

        return {
            structure: structureResult,
            checkpoints: checkpointResult,
            multiUser: multiUserResult,
            clone: cloneResult
        };
    }

    /**
     * Display verification results in a formatted way
     */
    public static displayResults(verificationResults: {
        structure: VerificationResult;
        checkpoints: VerificationResult;
        multiUser: VerificationResult;
        clone?: VerificationResult | undefined;
    }): void {
        const displayResults: { category: string; result: VerificationResult }[] = [
            ...(verificationResults.clone ? [{ category: 'Clone Verification', result: verificationResults.clone }] : []),
            { category: 'Git Structure', result: verificationResults.structure },
            { category: 'Checkpoint Functionality', result: verificationResults.checkpoints },
            { category: 'Multi-User Support', result: verificationResults.multiUser }
        ];

        const allPassed = displayResults.every(r => r.result.success);

        let message = `🛡️ Guardian Verification Results\n\n`;
        message += `Overall Status: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n\n`;

        for (const { category, result } of displayResults) {
            if (!result) continue;
            message += `\n📋 ${category}\n`;
            message += `Status: ${result.success ? '✅ PASS' : '❌ FAIL'}\n`;
            message += `Message: ${result.message}\n`;
            if (result.details) {
                message += `Details:\n${result.details}\n`;
            }
        }

        vscode.window.showInformationMessage(message);
    }
}
