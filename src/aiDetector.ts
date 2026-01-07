/**
 * Vibe Code Guardian - AI Edit Detector
 * Detect changes from AI assistants (Copilot, Claude, Cline, etc.)
 */

import * as vscode from 'vscode';
import { CheckpointSource, ChangedFile, FileChangeType } from './types';

interface PendingChange {
    document: vscode.TextDocument;
    changes: vscode.TextDocumentContentChangeEvent[];
    timestamp: number;
    source: CheckpointSource;
}

export class AIDetector {
    private disposables: vscode.Disposable[] = [];
    private pendingChanges: Map<string, PendingChange> = new Map();
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly debounceDelay = 2000; // 2 seconds
    
    private _onAIEditDetected: vscode.EventEmitter<{
        source: CheckpointSource;
        changedFiles: ChangedFile[];
    }> = new vscode.EventEmitter();
    
    public readonly onAIEditDetected = this._onAIEditDetected.event;

    // Event for ANY file change (including user changes)
    private _onFileChanged: vscode.EventEmitter<{
        source: CheckpointSource;
        changedFiles: ChangedFile[];
        isNewFile?: boolean;
    }> = new vscode.EventEmitter();
    
    public readonly onFileChanged = this._onFileChanged.event;

    // Track which extensions are making changes
    private activeExtensions: Set<string> = new Set();
    
    // Known AI assistant extension IDs
    private readonly AI_EXTENSIONS: Record<string, CheckpointSource> = {
        'github.copilot': CheckpointSource.Copilot,
        'github.copilot-chat': CheckpointSource.Copilot,
        'anthropic.claude-code': CheckpointSource.Claude,
        'saoudrizwan.claude-dev': CheckpointSource.Cline,
        'continue.continue': CheckpointSource.OtherAI,
        'codeium.codeium': CheckpointSource.OtherAI,
        'tabnine.tabnine-vscode': CheckpointSource.OtherAI,
        'blackboxapp.blackbox': CheckpointSource.OtherAI,
        'rooveterinaryinc.roo-cline': CheckpointSource.Cline,
        'openai.chatgpt': CheckpointSource.OtherAI
    };

    // File content snapshots for tracking changes
    private fileSnapshots: Map<string, string> = new Map();

    constructor() {
        this.setupListeners();
    }

    /**
     * Setup event listeners
     */
    private setupListeners(): void {
        // Listen for text document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this))
        );

        // Listen for document open to create snapshots
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(this.onDocumentOpen.bind(this))
        );

        // Listen for document save
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(this.onDocumentSave.bind(this))
        );

        // Listen for file creation
        this.disposables.push(
            vscode.workspace.onDidCreateFiles(this.onFilesCreated.bind(this))
        );

        // Listen for file deletion
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles(this.onFilesDeleted.bind(this))
        );

        // Listen for file rename
        this.disposables.push(
            vscode.workspace.onDidRenameFiles(this.onFilesRenamed.bind(this))
        );

        // Track extension activation
        this.disposables.push(
            vscode.extensions.onDidChange(this.onExtensionChange.bind(this))
        );

        // Create initial snapshots for open documents
        vscode.workspace.textDocuments.forEach(doc => {
            this.createSnapshot(doc);
        });
    }

    /**
     * Create a content snapshot for a document
     */
    private createSnapshot(document: vscode.TextDocument): void {
        if (this.shouldIgnoreDocument(document)) {
            return;
        }
        this.fileSnapshots.set(document.uri.toString(), document.getText());
    }

    /**
     * Check if document should be ignored
     */
    private shouldIgnoreDocument(document: vscode.TextDocument): boolean {
        // Ignore untitled documents
        if (document.isUntitled) {
            return true;
        }

        // Ignore non-file schemes
        if (document.uri.scheme !== 'file') {
            return true;
        }

        // Ignore output channels and other non-code documents
        const ignoredPatterns = [
            'node_modules',
            '.git',
            '.vscode-test',
            'out',
            'dist',
            '.vscodeignore'
        ];

        return ignoredPatterns.some(pattern => 
            document.uri.fsPath.includes(pattern)
        );
    }

    /**
     * Handle document open
     */
    private onDocumentOpen(document: vscode.TextDocument): void {
        this.createSnapshot(document);
    }

    /**
     * Handle document change
     */
    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (this.shouldIgnoreDocument(event.document)) {
            return;
        }

        if (event.contentChanges.length === 0) {
            return;
        }

        // Detect source of change
        const source = this.detectChangeSource(event);
        
        const uri = event.document.uri.toString();
        const existing = this.pendingChanges.get(uri);
        
        if (existing) {
            existing.changes.push(...event.contentChanges);
            existing.timestamp = Date.now();
            // If we detect AI source, upgrade the pending change
            if (source !== CheckpointSource.User && existing.source === CheckpointSource.User) {
                existing.source = source;
            }
        } else {
            this.pendingChanges.set(uri, {
                document: event.document,
                changes: [...event.contentChanges],
                timestamp: Date.now(),
                source
            });
        }

        // Reset debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.processPendingChanges();
        }, this.debounceDelay);
    }

    /**
     * Detect the source of a change
     */
    private detectChangeSource(event: vscode.TextDocumentChangeEvent): CheckpointSource {
        // Check for active AI extensions
        for (const [extensionId, source] of Object.entries(this.AI_EXTENSIONS)) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (extension?.isActive) {
                // Check for typical AI edit patterns
                if (this.hasAIEditPattern(event)) {
                    return source;
                }
            }
        }

        // Check for large batch changes (typical of AI completions)
        const totalChangedChars = event.contentChanges.reduce(
            (sum, change) => sum + change.text.length,
            0
        );
        
        // Large insertions might be from AI
        if (totalChangedChars > 100) {
            // Check which AI extensions are active
            for (const [extensionId, source] of Object.entries(this.AI_EXTENSIONS)) {
                const extension = vscode.extensions.getExtension(extensionId);
                if (extension?.isActive) {
                    return source;
                }
            }
            return CheckpointSource.OtherAI;
        }

        return CheckpointSource.User;
    }

    /**
     * Check for AI edit patterns
     */
    private hasAIEditPattern(event: vscode.TextDocumentChangeEvent): boolean {
        // AI tends to make larger, structured changes
        for (const change of event.contentChanges) {
            // Multiple lines inserted at once
            const newLines = change.text.split('\n').length;
            if (newLines > 3) {
                return true;
            }

            // Complete function/method insertion
            if (change.text.includes('function ') || 
                change.text.includes('const ') ||
                change.text.includes('class ') ||
                change.text.includes('def ') ||
                change.text.includes('async ')) {
                return true;
            }

            // Import statements
            if (change.text.includes('import ') || change.text.includes('from ')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Process pending changes and emit event if needed
     */
    private processPendingChanges(): void {
        if (this.pendingChanges.size === 0) {
            return;
        }

        // Group changes by source
        const changesBySource: Map<CheckpointSource, ChangedFile[]> = new Map();

        for (const [uri, pending] of this.pendingChanges) {
            const previousContent = this.fileSnapshots.get(uri) || '';
            const currentContent = pending.document.getText();
            
            // Calculate diff
            const linesAdded = this.countLines(currentContent) - this.countLines(previousContent);
            const changedFile: ChangedFile = {
                path: pending.document.uri.fsPath,
                changeType: FileChangeType.Modified,
                linesAdded: Math.max(0, linesAdded),
                linesRemoved: Math.max(0, -linesAdded),
                previousContent,
                currentContent
            };

            const source = pending.source;
            if (!changesBySource.has(source)) {
                changesBySource.set(source, []);
            }
            changesBySource.get(source)!.push(changedFile);

            // Update snapshot
            this.fileSnapshots.set(uri, currentContent);
        }

        // Emit events for all changes
        for (const [source, changedFiles] of changesBySource) {
            // Always emit file changed event for any change
            this._onFileChanged.fire({ source, changedFiles });
            
            // Also emit AI-specific event for AI changes
            if (source !== CheckpointSource.User) {
                this._onAIEditDetected.fire({ source, changedFiles });
            }
        }

        // Clear pending changes
        this.pendingChanges.clear();
    }

    /**
     * Count lines in text
     */
    private countLines(text: string): number {
        return text.split('\n').length;
    }

    /**
     * Handle document save
     */
    private onDocumentSave(document: vscode.TextDocument): void {
        // Update snapshot on save
        this.createSnapshot(document);
    }

    /**
     * Handle files created
     */
    private onFilesCreated(event: vscode.FileCreateEvent): void {
        const changedFiles: ChangedFile[] = [];
        
        for (const uri of event.files) {
            // Skip ignored paths
            if (this.shouldIgnorePath(uri.fsPath)) {
                continue;
            }
            
            changedFiles.push({
                path: uri.fsPath,
                changeType: FileChangeType.Added,
                linesAdded: 0,
                linesRemoved: 0
            });
        }

        if (changedFiles.length > 0) {
            const source = this.detectActiveAISource();
            this._onFileChanged.fire({ source, changedFiles, isNewFile: true });
            
            if (source !== CheckpointSource.User) {
                this._onAIEditDetected.fire({ source, changedFiles });
            }
        }
    }

    /**
     * Handle files deleted
     */
    private onFilesDeleted(event: vscode.FileDeleteEvent): void {
        const changedFiles: ChangedFile[] = [];
        
        for (const uri of event.files) {
            if (this.shouldIgnorePath(uri.fsPath)) {
                continue;
            }
            
            // Remove from snapshots
            this.fileSnapshots.delete(uri.toString());
            
            changedFiles.push({
                path: uri.fsPath,
                changeType: FileChangeType.Deleted,
                linesAdded: 0,
                linesRemoved: 0
            });
        }

        if (changedFiles.length > 0) {
            const source = this.detectActiveAISource();
            this._onFileChanged.fire({ source, changedFiles });
            
            if (source !== CheckpointSource.User) {
                this._onAIEditDetected.fire({ source, changedFiles });
            }
        }
    }

    /**
     * Handle files renamed
     */
    private onFilesRenamed(event: vscode.FileRenameEvent): void {
        const changedFiles: ChangedFile[] = [];
        
        for (const { oldUri, newUri } of event.files) {
            if (this.shouldIgnorePath(newUri.fsPath)) {
                continue;
            }
            
            // Update snapshots
            const oldContent = this.fileSnapshots.get(oldUri.toString());
            if (oldContent) {
                this.fileSnapshots.delete(oldUri.toString());
                this.fileSnapshots.set(newUri.toString(), oldContent);
            }
            
            changedFiles.push({
                path: newUri.fsPath,
                changeType: FileChangeType.Renamed,
                linesAdded: 0,
                linesRemoved: 0
            });
        }

        if (changedFiles.length > 0) {
            const source = this.detectActiveAISource();
            this._onFileChanged.fire({ source, changedFiles });
            
            if (source !== CheckpointSource.User) {
                this._onAIEditDetected.fire({ source, changedFiles });
            }
        }
    }

    /**
     * Check if a file path should be ignored
     */
    private shouldIgnorePath(fsPath: string): boolean {
        const ignoredPatterns = [
            'node_modules',
            '.git',
            '.vscode-test',
            'out',
            'dist',
            '.vscodeignore'
        ];
        return ignoredPatterns.some(pattern => fsPath.includes(pattern));
    }

    /**
     * Detect if any AI extension is currently active
     */
    private detectActiveAISource(): CheckpointSource {
        for (const [extensionId, source] of Object.entries(this.AI_EXTENSIONS)) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (extension?.isActive) {
                return source;
            }
        }
        return CheckpointSource.User;
    }

    /**
     * Handle extension change
     */
    private onExtensionChange(): void {
        // Update active extensions tracking
        this.activeExtensions.clear();
        for (const extensionId of Object.keys(this.AI_EXTENSIONS)) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (extension?.isActive) {
                this.activeExtensions.add(extensionId);
            }
        }
    }

    /**
     * Manually trigger checkpoint from external source
     */
    public triggerManualCheckpoint(source: CheckpointSource, files?: string[]): void {
        const changedFiles: ChangedFile[] = [];
        
        if (files && files.length > 0) {
            for (const filePath of files) {
                const doc = vscode.workspace.textDocuments.find(
                    d => d.uri.fsPath === filePath
                );
                if (doc) {
                    const previousContent = this.fileSnapshots.get(doc.uri.toString()) || '';
                    const currentContent = doc.getText();
                    
                    changedFiles.push({
                        path: filePath,
                        changeType: FileChangeType.Modified,
                        linesAdded: 0,
                        linesRemoved: 0,
                        previousContent,
                        currentContent
                    });
                }
            }
        }

        this._onAIEditDetected.fire({ source, changedFiles });
    }

    /**
     * Get current file snapshot
     */
    public getFileSnapshot(uri: string): string | undefined {
        return this.fileSnapshots.get(uri);
    }

    /**
     * Check if an AI extension is active
     */
    public isAIExtensionActive(): boolean {
        for (const extensionId of Object.keys(this.AI_EXTENSIONS)) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (extension?.isActive) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get active AI extensions
     */
    public getActiveAIExtensions(): string[] {
        const active: string[] = [];
        for (const extensionId of Object.keys(this.AI_EXTENSIONS)) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (extension?.isActive) {
                active.push(extensionId);
            }
        }
        return active;
    }

    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.disposables.forEach(d => d.dispose());
        this._onAIEditDetected.dispose();
        this._onFileChanged.dispose();
    }
}
