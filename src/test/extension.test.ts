import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { CheckpointManager } from '../checkpointManager';
import { TimelineTreeProvider } from '../timelineTreeProvider';
import { GitManager } from '../gitManager';
import {
	CheckpointSource, CheckpointType, DEFAULT_SETTINGS, FileChangeType, MilestoneStatus,
	GitContributor, GitStash, GitRemote, GitBranchDetail,
	ExtensionToWebviewMessage, WebviewToExtensionMessage
} from '../types';

class MockWorkspaceState implements vscode.Memento {
	private readonly store = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this.store.keys()];
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		return (this.store.has(key) ? this.store.get(key) : defaultValue) as T | undefined;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.store.delete(key);
			return;
		}
		this.store.set(key, value);
	}

	setKeysForSync(_keys: readonly string[]): void {
		// Test double: no-op
	}
}

function createMockContext(): vscode.ExtensionContext {
	const workspaceState = new MockWorkspaceState();
	const globalState = new MockWorkspaceState();

	return {
		subscriptions: [],
		workspaceState,
		globalState,
		secrets: {
			get: async () => undefined,
			store: async () => undefined,
			delete: async () => undefined,
			onDidChange: () => new vscode.Disposable(() => {})
		},
		extensionUri: vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()),
		extensionPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
		environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
		storageUri: undefined,
		storagePath: undefined,
		globalStorageUri: vscode.Uri.file(os.tmpdir()),
		globalStoragePath: os.tmpdir(),
		logUri: vscode.Uri.file(os.tmpdir()),
		logPath: os.tmpdir(),
		extensionMode: vscode.ExtensionMode.Test,
		asAbsolutePath: (relativePath: string) => path.join(process.cwd(), relativePath),
		storagePath7: undefined as never,
		globalStoragePath7: undefined as never,
		logPath7: undefined as never,
		languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
		extension: {} as vscode.Extension<unknown>
	} as unknown as vscode.ExtensionContext;
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('local-only checkpoints keep snapshots and skip plugin git commits', async () => {
		const fixtureUri = vscode.Uri.file(path.join(os.tmpdir(), `.vibe-guardian-local-backup-test-${Date.now()}.txt`));
		await vscode.workspace.fs.writeFile(fixtureUri, Buffer.from('current snapshot', 'utf8'));

		let stageAndCommitAllCalls = 0;
		const fakeGitManager = {
			isGitRepository: async () => true,
			getDetailedChangedFiles: async () => [{ path: '.vibe-guardian-local-backup-test.txt', changeType: 'modified', staged: false }],
			stageAndCommitAll: async () => {
				stageAndCommitAllCalls += 1;
				return { success: false, changedFiles: [], skippedLargeFiles: [] };
			},
			getFileAtCommit: async () => 'previous snapshot',
			pushToRemote: async () => ({ success: true, message: 'ok' })
		};

		const manager = new CheckpointManager(createMockContext(), fakeGitManager as any);
		await manager.updateSettings({
			...DEFAULT_SETTINGS,
			showNotifications: false,
			trackingMode: 'local-only',
			pushStrategy: 'none'
		});

		const checkpoint = await manager.createCheckpoint(
			CheckpointType.Manual,
			CheckpointSource.User,
			[{
				path: fixtureUri.fsPath,
				changeType: FileChangeType.Modified,
				linesAdded: 1,
				linesRemoved: 0
			}]
		);

		assert.strictEqual(stageAndCommitAllCalls, 0, 'local-only mode must not create plugin git commits');
		assert.strictEqual(checkpoint.gitCommitHash, undefined, 'local-only checkpoint should not store a git commit hash');
		assert.strictEqual(checkpoint.changedFiles[0].currentContent, 'current snapshot');
		assert.strictEqual(checkpoint.changedFiles[0].previousContent, 'previous snapshot');

		await vscode.workspace.fs.delete(fixtureUri, { useTrash: false });
	});

	test('getMilestones returns empty array initially', async () => {
		const fakeGitManager = {
			isGitRepository: async () => true,
			getDetailedChangedFiles: async () => [],
			stageAndCommitAll: async () => ({ success: false, changedFiles: [], skippedLargeFiles: [] }),
			getFileAtCommit: async () => undefined,
			pushToRemote: async () => ({ success: true, message: 'ok' })
		};
		const manager = new CheckpointManager(createMockContext(), fakeGitManager as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const milestones = manager.getMilestones();
		assert.strictEqual(milestones.length, 0, 'no milestones should exist initially');
		assert.strictEqual(manager.getActiveMilestone(), undefined, 'no active milestone should exist initially');
	});

	test('startMilestone creates a milestone with correct fields', async () => {
		const fakeGitManager = {
			isGitRepository: async () => true,
			getDetailedChangedFiles: async () => [],
			stageAndCommitAll: async () => ({ success: false, changedFiles: [], skippedLargeFiles: [] }),
			getFileAtCommit: async () => undefined,
			pushToRemote: async () => ({ success: true, message: 'ok' })
		};
		const manager = new CheckpointManager(createMockContext(), fakeGitManager as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const milestone = await manager.startMilestone('Add auth', 'Users need to log in', {
			description: 'JWT-based'
		});

		assert.strictEqual(milestone.name, 'Add auth');
		assert.strictEqual(milestone.intent, 'Users need to log in');
		assert.strictEqual(milestone.description, 'JWT-based');
		assert.strictEqual(milestone.status, MilestoneStatus.Active);
		assert.strictEqual(milestone.checkpointIds.length, 0);

		const found = manager.getMilestone(milestone.id);
		assert.ok(found, 'getMilestone should find the milestone by id');
		assert.strictEqual(found?.name, 'Add auth');

		const active = manager.getActiveMilestone();
		assert.ok(active, 'getActiveMilestone should return the new milestone');
		assert.strictEqual(active?.id, milestone.id);

		const all = manager.getMilestones();
		assert.strictEqual(all.length, 1);

		const activeOnly = manager.getMilestones(MilestoneStatus.Active);
		assert.strictEqual(activeOnly.length, 1);

		const completedOnly = manager.getMilestones(MilestoneStatus.Completed);
		assert.strictEqual(completedOnly.length, 0);
	});

	test('TimelineTreeProvider placeholder item has startMilestone command when no milestones', async () => {
		const fakeGitManager = {
			isGitRepository: async () => true,
			getDetailedChangedFiles: async () => [],
			stageAndCommitAll: async () => ({ success: false, changedFiles: [], skippedLargeFiles: [] }),
			getFileAtCommit: async () => undefined,
			pushToRemote: async () => ({ success: true, message: 'ok' })
		};
		const manager = new CheckpointManager(createMockContext(), fakeGitManager as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const provider = new TimelineTreeProvider(manager);
		const rootItems = await provider.getChildren(undefined);

		assert.strictEqual(rootItems.length, 1, 'should show exactly one placeholder item');
		const placeholder = rootItems[0];
		assert.ok(placeholder.command, 'placeholder must have a command');
		assert.strictEqual(
			placeholder.command?.command,
			'vibeCodeGuardian.startMilestone',
			'placeholder command must be startMilestone'
		);
	});

	// ============================================================
	// PromptGroup Tests
	// ============================================================

	function makeFakeGit() {
		return {
			isGitRepository: async () => true,
			getDetailedChangedFiles: async () => [],
			stageAndCommitAll: async () => ({ success: false, changedFiles: [], skippedLargeFiles: [] }),
			getFileAtCommit: async () => undefined,
			pushToRemote: async () => ({ success: true, message: 'ok' })
		};
	}

	test('PromptGroup: consecutive AI checkpoints from same source within window are grouped', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		// Create two Copilot checkpoints quickly (no time gap — within 5 min window)
		const cp1 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [],
			{ name: 'Copilot Edit 1' }
		);
		const cp2 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [],
			{ name: 'Copilot Edit 2' }
		);

		assert.ok(cp1.promptGroupId, 'cp1 should have a promptGroupId');
		assert.ok(cp2.promptGroupId, 'cp2 should have a promptGroupId');
		assert.strictEqual(cp1.promptGroupId, cp2.promptGroupId,
			'both Copilot checkpoints should share the same PromptGroup');

		const group = manager.getPromptGroup(cp1.promptGroupId!);
		assert.ok(group, 'PromptGroup should exist');
		assert.strictEqual(group!.source, CheckpointSource.Copilot, 'group source should be Copilot');
		assert.strictEqual(group!.checkpointIds.length, 2, 'group should contain exactly 2 checkpoints');
	});

	test('PromptGroup: different AI sources create separate groups', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const cp1 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [],
			{ name: 'Copilot Edit' }
		);
		const cp2 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Claude, [],
			{ name: 'Claude Edit' }
		);

		assert.ok(cp1.promptGroupId, 'cp1 should have a promptGroupId');
		assert.ok(cp2.promptGroupId, 'cp2 should have a promptGroupId');
		assert.notStrictEqual(cp1.promptGroupId, cp2.promptGroupId,
			'different AI sources should produce different PromptGroups');
	});

	test('PromptGroup: user manual checkpoint closes the active AI group', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const cpAI1 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [],
			{ name: 'AI Edit 1' }
		);

		// User manually saves → should close AI group
		await manager.createCheckpoint(
			CheckpointType.Manual, CheckpointSource.User, [],
			{ name: 'Manual Save' }
		);

		// Next AI checkpoint should start a NEW group
		const cpAI2 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [],
			{ name: 'AI Edit 2' }
		);

		assert.ok(cpAI1.promptGroupId, 'first AI cp should have a group');
		assert.ok(cpAI2.promptGroupId, 'second AI cp should have a group');
		assert.notStrictEqual(cpAI1.promptGroupId, cpAI2.promptGroupId,
			'AI checkpoints across a user manual save should be in different groups');
	});

	test('PromptGroup: SessionStart checkpoints have no promptGroupId', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		// startSession internally creates a SessionStart checkpoint
		const session = await manager.startSession('Test Session');
		const allCps = manager.getCheckpoints();
		const sessionStart = allCps.find(cp => cp.type === CheckpointType.SessionStart);

		assert.ok(sessionStart, 'SessionStart checkpoint should exist');
		assert.strictEqual(sessionStart!.promptGroupId, undefined,
			'SessionStart checkpoints must not be assigned to a PromptGroup');

		// Cleanup
		await manager.endSession();
		void session;
	});

	test('PromptGroup: getPromptGroups returns all groups newest first', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		await manager.createCheckpoint(CheckpointType.AIGenerated, CheckpointSource.Copilot, [], { name: 'G1' });
		// Force a new group via user checkpoint
		await manager.createCheckpoint(CheckpointType.Manual, CheckpointSource.User, [], { name: 'User' });
		await manager.createCheckpoint(CheckpointType.AIGenerated, CheckpointSource.Claude, [], { name: 'G2' });

		const groups = manager.getPromptGroups();
		// We should have at least 2 AI groups (Copilot, then Claude)
		const aiGroups = groups.filter(g => g.source === CheckpointSource.Copilot || g.source === CheckpointSource.Claude);
		assert.ok(aiGroups.length >= 2, 'should have at least 2 AI PromptGroups');
		// Newest first — Claude group created after Copilot group
		assert.strictEqual(aiGroups[0].source, CheckpointSource.Claude);
	});

	test('PromptGroup: getPromptGroupCheckpoints returns ordered checkpoints', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const cp1 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Cline, [], { name: 'Cline #1' }
		);
		const cp2 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Cline, [], { name: 'Cline #2' }
		);
		const cp3 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Cline, [], { name: 'Cline #3' }
		);

		const groupId = cp1.promptGroupId!;
		const ordered = manager.getPromptGroupCheckpoints(groupId);

		assert.strictEqual(ordered.length, 3, 'group should have 3 checkpoints');
		assert.strictEqual(ordered[0].id, cp1.id, 'oldest checkpoint should be first');
		assert.strictEqual(ordered[2].id, cp3.id, 'newest checkpoint should be last');
		void cp2;
	});

	test('PromptGroup: getMilestonePromptGroups filters by milestone', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		// Milestone A
		const milestoneA = await manager.startMilestone('Feature A', 'Intent A');
		const cpA = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [], { name: 'In A' }
		);
		await manager.completeMilestone(milestoneA.id);

		// Milestone B
		const milestoneB = await manager.startMilestone('Feature B', 'Intent B');
		const cpB = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Claude, [], { name: 'In B' }
		);
		await manager.completeMilestone(milestoneB.id);

		const groupsA = manager.getMilestonePromptGroups(milestoneA.id);
		const groupsB = manager.getMilestonePromptGroups(milestoneB.id);

		assert.ok(groupsA.length >= 1, 'Milestone A should have at least one PromptGroup');
		assert.ok(groupsB.length >= 1, 'Milestone B should have at least one PromptGroup');

		// Groups of A should not appear in B and vice versa
		const groupIdsA = new Set(groupsA.map(g => g.id));
		const groupIdsB = new Set(groupsB.map(g => g.id));
		for (const id of groupIdsA) {
			assert.ok(!groupIdsB.has(id), 'Milestone A groups should not appear in milestone B');
		}

		void cpA; void cpB;
	});

	test('PromptGroup: changedFiles are aggregated correctly within a group', async () => {
		const fakeGit = {
			isGitRepository: async () => true,
			getDetailedChangedFiles: async () => [],
			stageAndCommitAll: async () => ({ success: false, changedFiles: [], skippedLargeFiles: [] }),
			getFileAtCommit: async () => 'old content',
			pushToRemote: async () => ({ success: true, message: 'ok' })
		};
		const tmpFile = path.join(os.tmpdir(), `vibe-pg-test-${Date.now()}.ts`);
		const fixtureUri = vscode.Uri.file(tmpFile);
		await vscode.workspace.fs.writeFile(fixtureUri, Buffer.from('v2 content', 'utf8'));

		const manager = new CheckpointManager(createMockContext(), fakeGit as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const changedFile = {
			path: tmpFile,
			changeType: FileChangeType.Modified,
			linesAdded: 3,
			linesRemoved: 1,
		};

		const cp1 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot, [changedFile], { name: 'Edit A' }
		);
		const cp2 = await manager.createCheckpoint(
			CheckpointType.AIGenerated, CheckpointSource.Copilot,
			[{ ...changedFile, linesAdded: 5, linesRemoved: 2 }],
			{ name: 'Edit B' }
		);

		const group = manager.getPromptGroup(cp1.promptGroupId!);
		assert.ok(group, 'group should exist');
		assert.ok(group!.changedFiles.length >= 1, 'group should have aggregated changed files');

		const aggregated = group!.changedFiles.find(f => f.path === tmpFile);
		assert.ok(aggregated, 'aggregated file should be present');
		// linesAdded should be cumulative: 3 + 5
		assert.strictEqual(aggregated!.linesAdded, 8, 'linesAdded should be cumulative across checkpoints');

		await vscode.workspace.fs.delete(fixtureUri, { useTrash: false });
		void cp2;
	});

	test('PromptGroup: TimelineTreeProvider shows prompt-group node for multi-checkpoint AI group', async () => {
		const manager = new CheckpointManager(createMockContext(), makeFakeGit() as any);
		await manager.updateSettings({ ...DEFAULT_SETTINGS, showNotifications: false });

		const milestone = await manager.startMilestone('UI Refactor', 'Improve timeline layout');

		// Create 2 Copilot checkpoints — they should form a PromptGroup
		await manager.createCheckpoint(CheckpointType.AIGenerated, CheckpointSource.Copilot, [], { name: 'Copilot A' });
		await manager.createCheckpoint(CheckpointType.AIGenerated, CheckpointSource.Copilot, [], { name: 'Copilot B' });

		const provider = new TimelineTreeProvider(manager);
		const rootItems = await provider.getChildren(undefined);

		// Find the milestone item
		const milestoneItem = rootItems.find(i => i.milestoneId === milestone.id);
		assert.ok(milestoneItem, 'Milestone tree item should exist');

		// Get children of the milestone
		const milestoneChildren = await provider.getChildren(milestoneItem);
		assert.ok(milestoneChildren.length > 0, 'Milestone should have children');

		// At least one child should be a prompt-group node
		const groupItem = milestoneChildren.find(i => i.contextValue === 'prompt-group');
		assert.ok(groupItem, 'A prompt-group TreeItem should appear under the milestone');
		assert.ok(groupItem!.promptGroupId, 'prompt-group item should carry a promptGroupId');

		// Expand the group to verify checkpoints are nested
		const groupChildren = await provider.getChildren(groupItem);
		assert.strictEqual(groupChildren.length, 2, 'prompt-group should expand to show 2 checkpoints');
		assert.ok(groupChildren.every(i => i.contextValue === 'checkpoint' || i.contextValue === 'checkpoint-starred'),
			'all group children should be checkpoint items');
	});
});

// ══════════════════════════════════════════════════════════════════
// Git Graph — Type shape validation
// ══════════════════════════════════════════════════════════════════
suite('Git Graph Types', () => {
	test('GitContributor has required fields', () => {
		const c: GitContributor = {
			name: 'Alice',
			email: 'alice@example.com',
			commitCount: 42,
			firstCommitDate: '2025-01-01T00:00:00Z',
			lastCommitDate: '2026-03-01T00:00:00Z',
		};
		assert.strictEqual(c.name, 'Alice');
		assert.strictEqual(c.commitCount, 42);
		assert.ok(c.firstCommitDate < c.lastCommitDate, 'firstCommitDate should be earlier');
	});

	test('GitStash has required fields', () => {
		const s: GitStash = {
			index: 0,
			ref: 'stash@{0}',
			branch: 'main',
			message: 'WIP on main: abc1234 feat: partial',
			authorName: 'Bob',
			date: '2026-03-24T10:00:00Z',
		};
		assert.strictEqual(s.index, 0);
		assert.ok(s.ref.startsWith('stash@{'), 'ref should be stash ref format');
		assert.strictEqual(s.branch, 'main');
	});

	test('GitRemote has required fields', () => {
		const r: GitRemote = {
			name: 'origin',
			fetchUrl: 'https://github.com/example/repo.git',
			pushUrl: 'https://github.com/example/repo.git',
		};
		assert.strictEqual(r.name, 'origin');
		assert.ok(r.fetchUrl.startsWith('https://'));
	});

	test('GitBranchDetail has required fields including ahead/behind', () => {
		const b: GitBranchDetail = {
			name: 'feature/new-ui',
			isCurrent: true,
			commitHash: 'abc1234567890abcdef',
			isRemote: false,
			ahead: 3,
			behind: 1,
			tracking: 'origin/feature/new-ui',
		};
		assert.strictEqual(b.ahead, 3);
		assert.strictEqual(b.behind, 1);
		assert.strictEqual(b.tracking, 'origin/feature/new-ui');
	});

	test('GitBranchDetail.tracking is optional', () => {
		const b: GitBranchDetail = {
			name: 'local-only',
			isCurrent: false,
			commitHash: 'def456',
			isRemote: false,
			ahead: 0,
			behind: 0,
		};
		assert.strictEqual(b.tracking, undefined);
	});

	test('ExtensionToWebviewMessage union covers all new types', () => {
		const msgs: ExtensionToWebviewMessage[] = [
			{ type: 'stashList', data: [] },
			{ type: 'contributors', data: [] },
			{ type: 'remotes', data: [] },
			{ type: 'branchDetails', data: [] },
			{ type: 'operationResult', success: true, message: 'ok', operation: 'createBranch' },
		];
		const knownTypes = new Set(msgs.map(m => m.type));
		assert.ok(knownTypes.has('stashList'));
		assert.ok(knownTypes.has('contributors'));
		assert.ok(knownTypes.has('remotes'));
		assert.ok(knownTypes.has('branchDetails'));
		assert.ok(knownTypes.has('operationResult'));
	});

	test('WebviewToExtensionMessage union covers all new operation types', () => {
		const msgs: WebviewToExtensionMessage[] = [
			{ type: 'requestStashes' },
			{ type: 'requestContributors' },
			{ type: 'requestRemotes' },
			{ type: 'requestBranchDetails' },
			{ type: 'createBranch', name: 'feat/x' },
			{ type: 'checkoutBranch', name: 'main' },
			{ type: 'deleteBranch', name: 'old', force: false },
			{ type: 'mergeBranch', name: 'dev', strategy: 'no-ff' },
			{ type: 'rebaseBranch', name: 'main' },
			{ type: 'applyStash', index: 0 },
			{ type: 'popStash', index: 0 },
			{ type: 'dropStash', index: 1 },
			{ type: 'createStash', message: 'wip' },
			{ type: 'fetchRemote', remote: 'origin' },
			{ type: 'pullBranch', remote: 'origin', branch: 'main', rebase: false },
			{ type: 'pushBranch', remote: 'origin', branch: 'main', force: false },
		];
		assert.strictEqual(msgs.length, 16, 'All 16 new message types should be covered');
		const types = new Set(msgs.map(m => m.type));
		assert.strictEqual(types.size, 16, 'All types should be distinct');
	});

	test('mergeBranch strategy enum values', () => {
		const strategies: Array<'ff' | 'no-ff' | 'squash'> = ['ff', 'no-ff', 'squash'];
		const msg: WebviewToExtensionMessage = { type: 'mergeBranch', name: 'dev', strategy: 'squash' };
		assert.ok(strategies.includes((msg as any).strategy), 'squash is valid strategy');
	});
});

// ══════════════════════════════════════════════════════════════════
// GitManager — new method unit tests (mock git)
// ══════════════════════════════════════════════════════════════════
suite('GitManager — multi-user / multi-branch operations', () => {

	function makeGitManager(fakeGit: object): GitManager {
		const mgr = new GitManager();
		(mgr as any).git = fakeGit;
		return mgr;
	}

	// ── getContributors ───────────────────────────────────────────
	test('getContributors: returns empty array when git is not initialized', async () => {
		const mgr = new GitManager();
		(mgr as any).git = null;
		const result = await mgr.getContributors();
		assert.deepStrictEqual(result, []);
	});

	test('getContributors: parses log output and aggregates by email', async () => {
		const fakeGit = {
			raw: async (args: string[]) => {
				assert.ok(args.includes('log'), 'should call git log');
				return [
					'Alice\talice@example.com\t2026-03-01T10:00:00Z',
					'Bob\tbob@example.com\t2026-02-15T08:00:00Z',
					'Alice\talice@example.com\t2026-01-10T09:00:00Z',
					'Alice\talice@example.com\t2025-12-01T12:00:00Z',
				].join('\n');
			}
		};
		const mgr = makeGitManager(fakeGit);
		const result = await mgr.getContributors();
		// Alice appears 3 times, Bob once — sorted by commitCount desc
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].name, 'Alice');
		assert.strictEqual(result[0].commitCount, 3);
		assert.strictEqual(result[0].email, 'alice@example.com');
		assert.strictEqual(result[1].name, 'Bob');
		assert.strictEqual(result[1].commitCount, 1);
	});

	test('getContributors: returns empty array on empty git log', async () => {
		const fakeGit = {
			raw: async () => '   '
		};
		const result = await makeGitManager(fakeGit).getContributors();
		assert.deepStrictEqual(result, []);
	});

	test('getContributors: email matching is case-insensitive', async () => {
		const fakeGit = {
			raw: async () => [
				'Alice\tAlice@Example.COM\t2026-03-01T10:00:00Z',
				'alice\talice@example.com\t2026-02-01T10:00:00Z',
			].join('\n')
		};
		const result = await makeGitManager(fakeGit).getContributors();
		assert.strictEqual(result.length, 1, 'Same email in different case should be merged');
		assert.strictEqual(result[0].commitCount, 2);
	});

	test('getContributors: returns empty array when git throws', async () => {
		const fakeGit = {
			raw: async () => { throw new Error('git error'); }
		};
		const result = await makeGitManager(fakeGit).getContributors();
		assert.deepStrictEqual(result, []);
	});

	// ── getStashList ──────────────────────────────────────────────
	test('getStashList: returns empty array when git is not initialized', async () => {
		const mgr = new GitManager();
		(mgr as any).git = null;
		assert.deepStrictEqual(await mgr.getStashList(), []);
	});

	test('getStashList: parses stash list output correctly', async () => {
		const fakeGit = {
			raw: async () =>
				'stash@{0}\tAlice\t2026-03-24T10:00:00Z\tWIP on main: abc1234 partial work\n' +
				'stash@{1}\tBob\t2026-03-23T08:00:00Z\tOn feature/ui: UI changes'
		};
		const result = await makeGitManager(fakeGit).getStashList();
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].ref, 'stash@{0}');
		assert.strictEqual(result[0].authorName, 'Alice');
		assert.strictEqual(result[0].branch, 'main');
		assert.strictEqual(result[0].index, 0);
		assert.strictEqual(result[1].ref, 'stash@{1}');
		assert.strictEqual(result[1].branch, 'feature/ui');
		assert.strictEqual(result[1].index, 1);
	});

	test('getStashList: returns empty array on empty stash', async () => {
		const fakeGit = {
			raw: async () => ''
		};
		assert.deepStrictEqual(await makeGitManager(fakeGit).getStashList(), []);
	});

	// ── applyStash / popStash / dropStash ─────────────────────────
	test('applyStash: returns success:true when git succeeds', async () => {
		const fakeGit = {
			raw: async (args: string[]) => {
				assert.deepStrictEqual(args, ['stash', 'apply', 'stash@{2}']);
				return '';
			}
		};
		const result = await makeGitManager(fakeGit).applyStash(2);
		assert.strictEqual(result.success, true);
		assert.ok(result.message.includes('2'));
	});

	test('applyStash: returns success:false when git throws', async () => {
		const fakeGit = {
			raw: async () => { throw new Error('conflict'); }
		};
		const result = await makeGitManager(fakeGit).applyStash(0);
		assert.strictEqual(result.success, false);
		assert.ok(result.message.includes('conflict') || result.message.includes('failed'));
	});

	test('popStash: calls stash pop with correct ref', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			raw: async (args: string[]) => { calledArgs = args; return ''; }
		};
		await makeGitManager(fakeGit).popStash(1);
		assert.deepStrictEqual(calledArgs, ['stash', 'pop', 'stash@{1}']);
	});

	test('dropStash: calls stash drop with correct ref', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			raw: async (args: string[]) => { calledArgs = args; return ''; }
		};
		const result = await makeGitManager(fakeGit).dropStash(3);
		assert.deepStrictEqual(calledArgs, ['stash', 'drop', 'stash@{3}']);
		assert.strictEqual(result.success, true);
	});

	test('createStash: passes message when provided', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			stash: async (args: string[]) => { calledArgs = args; return ''; }
		};
		const result = await makeGitManager(fakeGit).createStash('my wip');
		assert.ok(calledArgs.includes('push'), 'should call stash push');
		assert.ok(calledArgs.includes('-m'), 'should pass -m flag');
		assert.ok(calledArgs.includes('my wip'), 'should include the message text');
		assert.strictEqual(result.success, true);
	});

	test('createStash: omits message when not provided', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			stash: async (args: string[]) => { calledArgs = args; return ''; }
		};
		const result = await makeGitManager(fakeGit).createStash();
		assert.ok(calledArgs.includes('push'), 'should call stash push');
		assert.ok(!calledArgs.includes('-m'), 'should not include -m when no message');
		assert.strictEqual(result.success, true);
	});

	// ── getRemoteList ─────────────────────────────────────────────
	test('getRemoteList: returns empty array when git is not initialized', async () => {
		const mgr = new GitManager();
		(mgr as any).git = null;
		assert.deepStrictEqual(await mgr.getRemoteList(), []);
	});

	test('getRemoteList: maps simpleGit remotes to GitRemote shape', async () => {
		const fakeGit = {
			getRemotes: async (verbose: boolean) => {
				assert.strictEqual(verbose, true, 'should call getRemotes(true) for URL info');
				return [
					{ name: 'origin', refs: { fetch: 'https://github.com/foo/bar.git', push: 'https://github.com/foo/bar.git' } },
					{ name: 'upstream', refs: { fetch: 'https://github.com/upstream/bar.git', push: '' } },
				];
			}
		};
		const result = await makeGitManager(fakeGit).getRemoteList();
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].name, 'origin');
		assert.strictEqual(result[0].fetchUrl, 'https://github.com/foo/bar.git');
		assert.strictEqual(result[1].name, 'upstream');
	});

	// ── fetchRemote ───────────────────────────────────────────────
	test('fetchRemote: calls fetch --all --prune when remote is --all', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			fetch: async (args: string[]) => { calledArgs = args; return {}; }
		};
		const result = await makeGitManager(fakeGit).fetchRemote('--all');
		assert.ok(calledArgs.includes('--all'));
		assert.ok(calledArgs.includes('--prune'));
		assert.strictEqual(result.success, true);
	});

	test('fetchRemote: calls fetch with specific remote name', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			fetch: async (args: string[]) => { calledArgs = args; return {}; }
		};
		await makeGitManager(fakeGit).fetchRemote('upstream');
		assert.ok(calledArgs.includes('upstream'));
	});

	test('fetchRemote: returns success:false on error', async () => {
		const fakeGit = {
			fetch: async () => { throw new Error('network error'); }
		};
		const result = await makeGitManager(fakeGit).fetchRemote('origin');
		assert.strictEqual(result.success, false);
	});

	// ── mergeBranch ───────────────────────────────────────────────
	test('mergeBranch: uses --no-ff flag for no-ff strategy', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			raw: async (args: string[]) => { calledArgs = args; return ''; }
		};
		const result = await makeGitManager(fakeGit).mergeBranch('feature/x', 'no-ff');
		assert.ok(calledArgs.includes('--no-ff'));
		assert.ok(calledArgs.includes('feature/x'));
		assert.strictEqual(result.success, true);
		assert.ok(result.message.includes('no-ff'));
	});

	test('mergeBranch: uses --squash flag for squash strategy', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			raw: async (args: string[]) => { calledArgs = args; return ''; }
		};
		await makeGitManager(fakeGit).mergeBranch('dev', 'squash');
		assert.ok(calledArgs.includes('--squash'));
		assert.ok(!calledArgs.includes('--no-ff'), 'squash should not include --no-ff');
	});

	test('mergeBranch: ff strategy has no extra flags', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			raw: async (args: string[]) => { calledArgs = args; return ''; }
		};
		await makeGitManager(fakeGit).mergeBranch('main', 'ff');
		assert.ok(!calledArgs.includes('--no-ff'));
		assert.ok(!calledArgs.includes('--squash'));
		assert.ok(calledArgs.includes('main'));
	});

	test('mergeBranch: returns success:false when merge fails', async () => {
		const fakeGit = {
			raw: async () => { throw new Error('conflict'); }
		};
		const result = await makeGitManager(fakeGit).mergeBranch('conflicting-branch', 'no-ff');
		assert.strictEqual(result.success, false);
	});

	// ── rebaseBranch ──────────────────────────────────────────────
	test('rebaseBranch: calls git rebase <base>', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			rebase: async (args: string[]) => { calledArgs = args; return ''; }
		};
		const result = await makeGitManager(fakeGit).rebaseBranch('main');
		assert.ok(calledArgs.includes('main'));
		assert.strictEqual(result.success, true);
		assert.ok(result.message.includes('main'));
	});

	test('rebaseBranch: returns success:false when rebase fails', async () => {
		const fakeGit = {
			rebase: async () => { throw new Error('conflict during rebase'); }
		};
		const result = await makeGitManager(fakeGit).rebaseBranch('main');
		assert.strictEqual(result.success, false);
	});

	// ── deleteBranch ──────────────────────────────────────────────
	test('deleteBranch: uses -d for non-force delete', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			branch: async (args: string[]) => { calledArgs = args; return {}; }
		};
		const result = await makeGitManager(fakeGit).deleteBranch('old-feature', false);
		assert.ok(calledArgs.includes('-d'));
		assert.ok(calledArgs.includes('old-feature'));
		assert.ok(!calledArgs.includes('-D'));
		assert.strictEqual(result.success, true);
	});

	test('deleteBranch: uses -D for force delete', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			branch: async (args: string[]) => { calledArgs = args; return {}; }
		};
		await makeGitManager(fakeGit).deleteBranch('stale-branch', true);
		assert.ok(calledArgs.includes('-D'));
		assert.ok(!calledArgs.includes('-d'));
	});

	test('deleteBranch: returns success:false when branch does not exist', async () => {
		const fakeGit = {
			branch: async () => { throw new Error('branch not found'); }
		};
		const result = await makeGitManager(fakeGit).deleteBranch('nonexistent', false);
		assert.strictEqual(result.success, false);
	});

	// ── renameBranch ─────────────────────────────────────────────
	test('renameBranch: calls git branch -m <old> <new>', async () => {
		let calledArgs: string[] = [];
		const fakeGit = {
			branch: async (args: string[]) => { calledArgs = args; return {}; }
		};
		const result = await makeGitManager(fakeGit).renameBranch('old-name', 'new-name');
		assert.deepStrictEqual(calledArgs, ['-m', 'old-name', 'new-name']);
		assert.strictEqual(result.success, true);
	});

	// ── getBranchDetails ──────────────────────────────────────────
	test('getBranchDetails: returns empty array when git is not initialized', async () => {
		const mgr = new GitManager();
		(mgr as any).git = null;
		assert.deepStrictEqual(await mgr.getBranchDetails(), []);
	});

	test('getBranchDetails: parses current branch with asterisk', async () => {
		const fakeGit = {
			raw: async (args: string[]) => {
				assert.ok(args.includes('-vv') && args.includes('--all'));
				return '* main                 abc1234567 [origin/main] Latest commit\n  feature/ui          def5678901 [origin/feature/ui: ahead 2, behind 1] UI work\n  remotes/origin/main  abc1234567 Latest commit';
			}
		};
		const result = await makeGitManager(fakeGit).getBranchDetails();
		const main = result.find(b => b.name === 'main');
		assert.ok(main, 'main branch should be found');
		assert.strictEqual(main!.isCurrent, true, 'main should be current');
		assert.strictEqual(main!.tracking, 'origin/main');
	});

	test('getBranchDetails: parses ahead/behind correctly', async () => {
		const fakeGit = {
			raw: async () =>
				'  feature/new-ui  abc123 [origin/feature/new-ui: ahead 3, behind 2] Some commit\n'
		};
		const result = await makeGitManager(fakeGit).getBranchDetails();
		const br = result.find(b => b.name === 'feature/new-ui');
		assert.ok(br);
		assert.strictEqual(br!.ahead, 3);
		assert.strictEqual(br!.behind, 2);
	});

	test('getBranchDetails: marks remote branches correctly', async () => {
		const fakeGit = {
			raw: async () =>
				'  remotes/origin/main  abc1234 HEAD commit\n  remotes/origin/dev  def5678 dev commit\n'
		};
		const result = await makeGitManager(fakeGit).getBranchDetails();
		assert.ok(result.every(b => b.isRemote), 'all branches should be remote');
		assert.ok(result.every(b => b.isCurrent === false), 'remotes are not current');
	});

	test('getBranchDetails: branch with no tracking has ahead/behind as 0', async () => {
		const fakeGit = {
			raw: async () =>
				'  local-only  abc123 Local only commit\n'
		};
		const result = await makeGitManager(fakeGit).getBranchDetails();
		const br = result[0];
		assert.strictEqual(br.ahead, 0);
		assert.strictEqual(br.behind, 0);
		assert.strictEqual(br.tracking, undefined);
	});

	// ── pullBranch ────────────────────────────────────────────────
	test('pullBranch: passes --rebase flag when rebase is true', async () => {
		let calledOpts: any;
		const fakeGit = {
			pull: async (remote: string, branch: string, opts: any) => { calledOpts = opts; return {}; }
		};
		const result = await makeGitManager(fakeGit).pullBranch('origin', 'main', true);
		assert.ok(calledOpts.includes('--rebase'), 'should pass --rebase option');
		assert.strictEqual(result.success, true);
	});

	test('pullBranch: no --rebase flag when rebase is false', async () => {
		let calledOpts: any;
		const fakeGit = {
			pull: async (remote: string, branch: string, opts: any) => { calledOpts = opts; return {}; }
		};
		await makeGitManager(fakeGit).pullBranch('origin', 'main', false);
		assert.ok(!calledOpts.includes('--rebase'));
	});
});

// ══════════════════════════════════════════════════════════════════
// GitManager — getGraphCommits unit tests
// ══════════════════════════════════════════════════════════════════
suite('GitManager — getGraphCommits', () => {
	const SEP = '<<GG_SEP>>';
	const REC = '<<GG_REC>>';

	function makeGitManager(fakeGit: object): GitManager {
		const mgr = new GitManager();
		(mgr as any).git = fakeGit;
		return mgr;
	}

	test('getGraphCommits: returns empty array when git is not initialized', async () => {
		const mgr = new GitManager();
		(mgr as any).git = null;
		assert.deepStrictEqual(await mgr.getGraphCommits(), []);
	});

	test('getGraphCommits: returns empty array when git returns empty output', async () => {
		const fakeGit = { raw: async () => '   ' };
		assert.deepStrictEqual(await makeGitManager(fakeGit).getGraphCommits(), []);
	});

	test('getGraphCommits: returns empty array when git throws', async () => {
		const fakeGit = { raw: async () => { throw new Error('git error'); } };
		assert.deepStrictEqual(await makeGitManager(fakeGit).getGraphCommits(), []);
	});

	test('getGraphCommits: full mode does NOT include --grep or --fixed-strings', async () => {
		let capturedArgs: string[] = [];
		const fakeGit = { raw: async (args: string[]) => { capturedArgs = args; return ''; } };
		await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.ok(
			!capturedArgs.some(a => a.startsWith('--grep')),
			'full mode must not include --grep'
		);
		assert.ok(
			!capturedArgs.includes('--fixed-strings'),
			'full mode must not include --fixed-strings'
		);
	});

	test('getGraphCommits: guardian mode uses --fixed-strings and --grep=[Vibe Guardian]', async () => {
		let capturedArgs: string[] = [];
		const fakeGit = { raw: async (args: string[]) => { capturedArgs = args; return ''; } };
		await makeGitManager(fakeGit).getGraphCommits(10, true);
		assert.ok(
			capturedArgs.includes('--fixed-strings'),
			'guardian mode must include --fixed-strings to avoid regex character-class interpretation'
		);
		const grepArg = capturedArgs.find(a => a.startsWith('--grep='));
		assert.ok(grepArg, 'guardian mode must include --grep');
		assert.strictEqual(
			grepArg, '--grep=[Vibe Guardian]',
			'grep pattern must match literal "[Vibe Guardian]" commit messages'
		);
	});

	test('getGraphCommits: parses single commit correctly', async () => {
		const line = [
			'abc1234567890abcdef',
			'abc1234',
			'def5678901234',
			'Alice',
			'alice@example.com',
			'2026-03-24T10:00:00Z',
			'feat: add login [Vibe Guardian]',
			'HEAD -> main, origin/main'
		].join(SEP) + REC;
		const fakeGit = { raw: async () => line };
		const result = await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].hash, 'abc1234567890abcdef');
		assert.strictEqual(result[0].abbreviatedHash, 'abc1234');
		assert.deepStrictEqual(result[0].parents, ['def5678901234']);
		assert.strictEqual(result[0].authorName, 'Alice');
		assert.strictEqual(result[0].authorEmail, 'alice@example.com');
		assert.strictEqual(result[0].message, 'feat: add login [Vibe Guardian]');
		assert.strictEqual(result[0].refs, 'HEAD -> main, origin/main');
	});

	test('getGraphCommits: parses root commit (no parents) correctly', async () => {
		const line = [
			'aaa111',
			'aaa111',
			'',   // no parents
			'Bob',
			'bob@example.com',
			'2026-01-01T00:00:00Z',
			'initial commit',
			''
		].join(SEP) + REC;
		const fakeGit = { raw: async () => line };
		const result = await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.strictEqual(result.length, 1);
		assert.deepStrictEqual(result[0].parents, [], 'root commit should have empty parents array');
	});

	test('getGraphCommits: parses merge commit (multiple parents) correctly', async () => {
		const line = [
			'merge111',
			'merge11',
			'parent1 parent2',  // merge commit has 2 parents
			'Alice',
			'alice@example.com',
			'2026-03-24T12:00:00Z',
			'Merge branch feature into main',
			'HEAD -> main'
		].join(SEP) + REC;
		const fakeGit = { raw: async () => line };
		const result = await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.strictEqual(result.length, 1);
		assert.deepStrictEqual(result[0].parents, ['parent1', 'parent2'], 'merge commit should have two parents');
	});

	test('getGraphCommits: parses multiple commits in order', async () => {
		const commits = [
			['hash1', 'h1', 'hash2', 'Alice', 'a@b.com', '2026-03-24', 'second commit', 'HEAD -> main'].join(SEP) + REC,
			['hash2', 'h2', '',      'Bob',   'b@b.com', '2026-03-01', 'first commit',  ''].join(SEP) + REC,
		].join('\n');
		const fakeGit = { raw: async () => commits };
		const result = await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.strictEqual(result.length, 2, 'should parse two commits');
		assert.strictEqual(result[0].hash, 'hash1');
		assert.strictEqual(result[1].hash, 'hash2');
	});

	test('getGraphCommits: filters out records with empty hash', async () => {
		const commits = [
			['hash1', 'h1', '', 'Alice', 'a@b.com', '2026-03-24', 'valid commit', ''].join(SEP) + REC,
			'   ' + REC,  // empty/whitespace record
		].join('\n');
		const fakeGit = { raw: async () => commits };
		const result = await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.strictEqual(result.length, 1, 'empty records should be filtered out');
		assert.strictEqual(result[0].hash, 'hash1');
	});

	test('getGraphCommits: passes --max-count to git', async () => {
		let capturedArgs: string[] = [];
		const fakeGit = { raw: async (args: string[]) => { capturedArgs = args; return ''; } };
		await makeGitManager(fakeGit).getGraphCommits(42, false);
		assert.ok(
			capturedArgs.some(a => a.includes('42')),
			'should pass max-count to git'
		);
	});

	test('getGraphCommits: includes --all flag to show all branches', async () => {
		let capturedArgs: string[] = [];
		const fakeGit = { raw: async (args: string[]) => { capturedArgs = args; return ''; } };
		await makeGitManager(fakeGit).getGraphCommits(10, false);
		assert.ok(capturedArgs.includes('--all'), 'must include --all to show all branches');
	});
});

// ══════════════════════════════════════════════════════════════════
// GitManager — getBlame unit tests
// ══════════════════════════════════════════════════════════════════
suite('GitManager — getBlame', () => {
	function makeGitManager(fakeGit: object): GitManager {
		const mgr = new GitManager();
		(mgr as any).git = fakeGit;
		return mgr;
	}

	/** Build a minimal git blame --porcelain record */
	function makePorcelain(
		hash: string, finalLine: number, opts: {
			author?: string; authorMail?: string; authorTime?: number; summary?: string;
		} = {}
	): string {
		const author = opts.author ?? 'Alice';
		const authorMail = opts.authorMail ?? '<alice@example.com>';
		const authorTime = opts.authorTime ?? 1711267200; // 2024-03-24T00:00:00Z
		const summary = opts.summary ?? 'feat: add login';
		return [
			`${hash} 1 ${finalLine} 1`,
			`author ${author}`,
			`author-mail ${authorMail}`,
			`author-time ${authorTime}`,
			`author-tz +0000`,
			`committer ${author}`,
			`committer-mail ${authorMail}`,
			`committer-time ${authorTime}`,
			`committer-tz +0000`,
			`summary ${summary}`,
			`filename src/foo.ts`,
			`\tconst x = 1;`,
		].join('\n');
	}

	test('getBlame: returns empty array when git is not initialized', async () => {
		const mgr = new GitManager();
		(mgr as any).git = null;
		assert.deepStrictEqual(await mgr.getBlame('/any/file.ts'), []);
	});

	test('getBlame: returns empty array when git returns empty output', async () => {
		const fakeGit = { raw: async () => '' };
		assert.deepStrictEqual(await makeGitManager(fakeGit).getBlame('/file.ts'), []);
	});

	test('getBlame: returns empty array when git throws', async () => {
		const fakeGit = { raw: async () => { throw new Error('not a git repo'); } };
		assert.deepStrictEqual(await makeGitManager(fakeGit).getBlame('/file.ts'), []);
	});

	test('getBlame: calls git blame --porcelain with the file path', async () => {
		let capturedArgs: string[] = [];
		const fakeGit = {
			raw: async (args: string[]) => { capturedArgs = args; return ''; }
		};
		await makeGitManager(fakeGit).getBlame('/workspace/src/app.ts');
		assert.ok(capturedArgs.includes('blame'), 'must call git blame');
		assert.ok(capturedArgs.includes('--porcelain'), 'must use --porcelain');
		assert.ok(capturedArgs.includes('/workspace/src/app.ts'), 'must pass file path');
	});

	test('getBlame: parses a single blame line correctly', async () => {
		const hash = 'a'.repeat(40);
		const fakeGit = {
			raw: async () => makePorcelain(hash, 1, {
				author: 'Alice', authorMail: '<alice@example.com>',
				authorTime: 1711267200, summary: 'feat: add login'
			})
		};
		const result = await makeGitManager(fakeGit).getBlame('/file.ts');
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].lineNumber, 1);
		assert.strictEqual(result[0].hash, hash);
		assert.strictEqual(result[0].shortHash, hash.substring(0, 7));
		assert.strictEqual(result[0].authorName, 'Alice');
		assert.strictEqual(result[0].authorEmail, 'alice@example.com');
		assert.strictEqual(result[0].summary, 'feat: add login');
		assert.strictEqual(result[0].isUncommitted, false);
		assert.ok(result[0].date.startsWith('2024'), 'date should be ISO 2024');
	});

	test('getBlame: strips angle brackets from author-mail', async () => {
		const hash = 'b'.repeat(40);
		const fakeGit = { raw: async () => makePorcelain(hash, 1, { authorMail: '<bob@work.com>' }) };
		const result = await makeGitManager(fakeGit).getBlame('/file.ts');
		assert.strictEqual(result[0].authorEmail, 'bob@work.com');
	});

	test('getBlame: isUncommitted is true for zero-hash lines', async () => {
		const uncommittedHash = '0'.repeat(40);
		const fakeGit = { raw: async () => makePorcelain(uncommittedHash, 1) };
		const result = await makeGitManager(fakeGit).getBlame('/file.ts');
		assert.strictEqual(result[0].isUncommitted, true);
	});

	test('getBlame: parses multiple lines with shared commit metadata', async () => {
		// Two lines from the same commit (git blame reuses commit header)
		const hash = 'c'.repeat(40);
		const raw = [
			`${hash} 1 1 2`,
			`author Carol`,
			`author-mail <carol@ex.com>`,
			`author-time 1711267200`,
			`author-tz +0000`,
			`committer Carol`,
			`committer-mail <carol@ex.com>`,
			`committer-time 1711267200`,
			`committer-tz +0000`,
			`summary fix: update config`,
			`filename config.ts`,
			`\tconst a = 1;`,
			`${hash} 2 2`,  // same commit, line 2 (no repeated headers)
			`\tconst b = 2;`,
		].join('\n');
		const fakeGit = { raw: async () => raw };
		const result = await makeGitManager(fakeGit).getBlame('/config.ts');
		// We should get at least 1 line (the one with full header)
		assert.ok(result.length >= 1, 'should parse at least 1 blame line');
		assert.strictEqual(result[0].authorName, 'Carol');
		assert.strictEqual(result[0].summary, 'fix: update config');
	});

	test('getBlame: lineNumber is 1-based matching git output', async () => {
		const hash = 'd'.repeat(40);
		const fakeGit = { raw: async () => makePorcelain(hash, 5) };
		const result = await makeGitManager(fakeGit).getBlame('/file.ts');
		assert.strictEqual(result[0].lineNumber, 5, 'line number should be 1-based');
	});

	test('getBlame: date is valid ISO string from unix timestamp', async () => {
		const hash = 'e'.repeat(40);
		// 2026-03-24T00:00:00Z = 1774310400
		const fakeGit = { raw: async () => makePorcelain(hash, 1, { authorTime: 1774310400 }) };
		const result = await makeGitManager(fakeGit).getBlame('/file.ts');
		const date = new Date(result[0].date);
		assert.ok(!isNaN(date.getTime()), 'date should be valid');
		assert.strictEqual(date.getUTCFullYear(), 2026);
		assert.strictEqual(date.getUTCMonth(), 2); // March = 2 (0-indexed)
	});
});
