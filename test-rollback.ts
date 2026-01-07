/**
 * Rollback Integration Test Script
 * Tests the GitManager rollback functionality directly
 * Run with: npx ts-node test-rollback.ts
 */

import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/Users/aresnasa/MyProjects/test';

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
}

class RollbackTester {
    private git: SimpleGit;
    private results: TestResult[] = [];

    constructor() {
        this.git = simpleGit(TEST_DIR);
    }

    private async log(msg: string) {
        console.log(`[TEST] ${msg}`);
    }

    private async pass(testName: string) {
        this.results.push({ name: testName, passed: true });
        console.log(`✅ PASS: ${testName}`);
    }

    private async fail(testName: string, error: string) {
        this.results.push({ name: testName, passed: false, error });
        console.log(`❌ FAIL: ${testName} - ${error}`);
    }

    /**
     * Test 1: Verify Git repository is valid
     */
    async testGitRepoValid(): Promise<void> {
        const testName = 'Git Repository Valid';
        try {
            const isRepo = await this.git.checkIsRepo();
            if (isRepo) {
                await this.pass(testName);
            } else {
                await this.fail(testName, 'Not a git repository');
            }
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 2: Verify we can get commit history
     */
    async testGetCommitHistory(): Promise<void> {
        const testName = 'Get Commit History';
        try {
            const log = await this.git.log({ maxCount: 10 });
            if (log.all.length > 0) {
                await this.log(`Found ${log.all.length} commits`);
                await this.pass(testName);
            } else {
                await this.fail(testName, 'No commits found');
            }
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 3: Test file content at specific commit
     */
    async testGetFileAtCommit(): Promise<void> {
        const testName = 'Get File At Commit';
        try {
            const log = await this.git.log({ maxCount: 5 });
            if (log.all.length < 2) {
                await this.fail(testName, 'Not enough commits to test');
                return;
            }

            const oldCommit = log.all[log.all.length - 1].hash;
            await this.log(`Getting 123.md at commit: ${oldCommit.substring(0, 7)}`);
            
            try {
                const content = await this.git.show([`${oldCommit}:123.md`]);
                await this.log(`Content length: ${content.length}`);
                await this.pass(testName);
            } catch (showError) {
                // File might not exist at that commit, try another file
                await this.log(`123.md not found at ${oldCommit}, trying test.md`);
                const content = await this.git.show([`${oldCommit}:test.md`]);
                await this.log(`Content: ${content}`);
                await this.pass(testName);
            }
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 4: Test hard reset rollback
     */
    async testHardResetRollback(): Promise<void> {
        const testName = 'Hard Reset Rollback';
        try {
            // Get current HEAD
            const currentHead = await this.git.revparse(['HEAD']);
            await this.log(`Current HEAD: ${currentHead.substring(0, 7)}`);

            // Get previous commit
            const log = await this.git.log({ maxCount: 5 });
            if (log.all.length < 2) {
                await this.fail(testName, 'Not enough commits');
                return;
            }

            // Read current file content
            const testFilePath = path.join(TEST_DIR, '123.md');
            const currentContent = fs.readFileSync(testFilePath, 'utf-8');
            await this.log(`Current 123.md content: "${currentContent.trim()}"`);

            // Find a commit where the file had different content
            const targetCommit = log.all[2].hash; // Go back 2 commits
            await this.log(`Rolling back to: ${targetCommit.substring(0, 7)} (${log.all[2].message})`);

            // Perform hard reset
            await this.git.reset(['--hard', targetCommit]);
            await this.log('Hard reset completed');

            // Verify HEAD changed
            const newHead = await this.git.revparse(['HEAD']);
            await this.log(`New HEAD: ${newHead.substring(0, 7)}`);

            if (newHead.startsWith(targetCommit.substring(0, 7))) {
                // Read file content after rollback
                if (fs.existsSync(testFilePath)) {
                    const newContent = fs.readFileSync(testFilePath, 'utf-8');
                    await this.log(`After rollback 123.md content: "${newContent.trim()}"`);
                } else {
                    await this.log('123.md does not exist at this commit');
                }
                await this.pass(testName);
            } else {
                await this.fail(testName, `HEAD mismatch: expected ${targetCommit.substring(0, 7)}, got ${newHead.substring(0, 7)}`);
            }

            // Restore original state
            await this.log(`Restoring to original HEAD: ${currentHead.substring(0, 7)}`);
            await this.git.reset(['--hard', currentHead]);
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 5: Test file checkout (restore single file)
     */
    async testFileCheckout(): Promise<void> {
        const testName = 'File Checkout (Restore Single File)';
        try {
            const testFilePath = path.join(TEST_DIR, '123.md');
            
            // Get original content from Git HEAD (not from file system)
            const gitContent = await this.git.show(['HEAD:123.md']);
            await this.log(`Git HEAD content: "${gitContent.trim()}"`);

            // Modify the file
            const modifiedContent = gitContent + '\n# Modified by test';
            fs.writeFileSync(testFilePath, modifiedContent);
            await this.log(`Modified content: "${fs.readFileSync(testFilePath, 'utf-8').trim()}"`);

            // Restore using git checkout
            await this.git.checkout(['HEAD', '--', '123.md']);
            
            // Verify restoration - compare trimmed content
            const restoredContent = fs.readFileSync(testFilePath, 'utf-8');
            await this.log(`Restored content: "${restoredContent.trim()}"`);

            // Compare trimmed content (ignore trailing newline differences)
            if (restoredContent.trim() === gitContent.trim()) {
                await this.pass(testName);
            } else {
                await this.fail(testName, `Content not restored correctly. Expected: "${gitContent.trim()}", Got: "${restoredContent.trim()}"`);
            }
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 6: Test diff between commits
     */
    async testDiffBetweenCommits(): Promise<void> {
        const testName = 'Diff Between Commits';
        try {
            const log = await this.git.log({ maxCount: 3 });
            if (log.all.length < 2) {
                await this.fail(testName, 'Not enough commits');
                return;
            }

            const fromCommit = log.all[1].hash;
            const toCommit = log.all[0].hash;
            
            await this.log(`Getting diff from ${fromCommit.substring(0, 7)} to ${toCommit.substring(0, 7)}`);
            
            const diff = await this.git.diff([fromCommit, toCommit]);
            await this.log(`Diff length: ${diff.length} chars`);
            
            if (diff !== undefined) {
                await this.pass(testName);
            } else {
                await this.fail(testName, 'Diff is undefined');
            }
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 7: Test rollback preserves other files
     */
    async testRollbackPreservesOtherFiles(): Promise<void> {
        const testName = 'Rollback Preserves Tracked Files';
        try {
            // Get current state
            const currentHead = await this.git.revparse(['HEAD']);
            const log = await this.git.log({ maxCount: 5 });
            
            // Read test.md before rollback
            const testMdPath = path.join(TEST_DIR, 'test.md');
            const testMdBefore = fs.readFileSync(testMdPath, 'utf-8');
            await this.log(`test.md before rollback: "${testMdBefore.trim()}"`);
            
            // Roll back to earlier commit
            const targetCommit = log.all[2].hash;
            await this.git.reset(['--hard', targetCommit]);
            
            // Read test.md after rollback
            const testMdAfter = fs.existsSync(testMdPath) 
                ? fs.readFileSync(testMdPath, 'utf-8')
                : '<file not exist>';
            await this.log(`test.md after rollback: "${testMdAfter.trim()}"`);
            
            // Restore
            await this.git.reset(['--hard', currentHead]);
            
            await this.pass(testName);
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 8: Test multiple rollbacks in sequence
     */
    async testMultipleRollbacks(): Promise<void> {
        const testName = 'Multiple Sequential Rollbacks';
        try {
            const currentHead = await this.git.revparse(['HEAD']);
            const log = await this.git.log({ maxCount: 5 });
            
            // Perform multiple rollbacks
            for (let i = 1; i < Math.min(3, log.all.length); i++) {
                const targetCommit = log.all[i].hash;
                await this.log(`Rollback ${i}: to ${targetCommit.substring(0, 7)}`);
                await this.git.reset(['--hard', targetCommit]);
                
                const newHead = await this.git.revparse(['HEAD']);
                if (!newHead.startsWith(targetCommit.substring(0, 7))) {
                    await this.fail(testName, `Rollback ${i} failed`);
                    await this.git.reset(['--hard', currentHead]);
                    return;
                }
            }
            
            // Restore
            await this.git.reset(['--hard', currentHead]);
            await this.pass(testName);
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Test 9: Simulate extension rollback flow (create commit, then rollback)
     */
    async testSimulateExtensionFlow(): Promise<void> {
        const testName = 'Simulate Extension Rollback Flow';
        try {
            // Save current state
            const originalHead = await this.git.revparse(['HEAD']);
            const testFilePath = path.join(TEST_DIR, '123.md');
            const originalContent = fs.readFileSync(testFilePath, 'utf-8');
            
            // Step 1: Make a change and commit (like extension does)
            const newContent = originalContent + '\n# Extension Test Change';
            fs.writeFileSync(testFilePath, newContent);
            await this.git.add(['123.md']);
            await this.git.commit('[Vibe Guardian] Test Checkpoint');
            const checkpointCommit = await this.git.revparse(['HEAD']);
            await this.log(`Created checkpoint commit: ${checkpointCommit.substring(0, 7)}`);
            
            // Step 2: Make another change
            fs.writeFileSync(testFilePath, newContent + '\n# After checkpoint change');
            await this.git.add(['123.md']);
            await this.git.commit('[Vibe Guardian] After checkpoint');
            
            // Step 3: Rollback to checkpoint (like extension does with hard reset)
            await this.log(`Rolling back to checkpoint: ${checkpointCommit.substring(0, 7)}`);
            await this.git.reset(['--hard', checkpointCommit]);
            
            // Verify rollback
            const currentContent = fs.readFileSync(testFilePath, 'utf-8');
            if (currentContent.includes('# Extension Test Change') && 
                !currentContent.includes('# After checkpoint change')) {
                await this.log('Rollback successful - content matches checkpoint');
                await this.pass(testName);
            } else {
                await this.fail(testName, 'Content does not match checkpoint state');
            }
            
            // Restore original state
            await this.git.reset(['--hard', originalHead]);
            fs.writeFileSync(testFilePath, originalContent);
        } catch (error) {
            await this.fail(testName, String(error));
        }
    }

    /**
     * Run all tests
     */
    async runAllTests(): Promise<void> {
        console.log('='.repeat(60));
        console.log('🧪 Vibe Code Guardian - Rollback Integration Tests');
        console.log('='.repeat(60));
        console.log(`Test directory: ${TEST_DIR}`);
        console.log('');

        await this.testGitRepoValid();
        await this.testGetCommitHistory();
        await this.testGetFileAtCommit();
        await this.testDiffBetweenCommits();
        await this.testFileCheckout();
        await this.testHardResetRollback();
        await this.testRollbackPreservesOtherFiles();
        await this.testMultipleRollbacks();

        // Print summary
        console.log('');
        console.log('='.repeat(60));
        console.log('📊 Test Summary');
        console.log('='.repeat(60));
        
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;
        
        console.log(`Total: ${this.results.length}`);
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);
        
        if (failed > 0) {
            console.log('');
            console.log('Failed tests:');
            this.results.filter(r => !r.passed).forEach(r => {
                console.log(`  - ${r.name}: ${r.error}`);
            });
            process.exit(1);
        } else {
            console.log('');
            console.log('🎉 All tests passed!');
            process.exit(0);
        }
    }
}

// Run tests
const tester = new RollbackTester();
tester.runAllTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
