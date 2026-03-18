import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { CheckpointManager } from '../checkpointManager';
import { CheckpointSource, CheckpointType, DEFAULT_SETTINGS, FileChangeType } from '../types';

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
});
