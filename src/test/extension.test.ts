import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { CheckpointManager } from '../checkpointManager';
import { TimelineTreeProvider } from '../timelineTreeProvider';
import { CheckpointSource, CheckpointType, DEFAULT_SETTINGS, FileChangeType, MilestoneStatus } from '../types';

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
