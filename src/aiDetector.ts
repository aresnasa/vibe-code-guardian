/**
 * Vibe Code Guardian - AI Edit Detector
 * Detect changes from AI assistants (Copilot, Claude, Cline, etc.)
 * Uses semantic significance scoring to avoid noisy tracking.
 */

import * as vscode from 'vscode';
import { CheckpointSource, ChangedFile, FileChangeType } from './types';

// ------------------------------------------------------------------
// Change Significance Analyzer
// Scores code changes by semantic importance instead of raw line count.
// ------------------------------------------------------------------

export interface SignificanceResult {
    score: number;           // 0–100 composite score
    reasons: string[];       // human-readable explanations
    isStructural: boolean;   // new function/class/interface/export
    isConfigChange: boolean; // package.json, tsconfig, etc.
}

export class ChangeSignificanceAnalyzer {
    /** Structural keywords per language family */
    private static readonly STRUCTURAL_PATTERNS: RegExp[] = [
        // JS / TS
        /^[\s]*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+\w+/m,
        // Python
        /^[\s]*(?:def|class|async\s+def)\s+\w+/m,
        // Rust
        /^[\s]*(?:pub\s+)?(?:fn|struct|enum|trait|impl|mod|type)\s+\w+/m,
        // Go
        /^[\s]*(?:func|type|var|const)\s+\w+/m,
    ];

    /** Config / manifest files that are always significant */
    private static readonly CONFIG_FILES = [
        'package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'go.sum',
        'pyproject.toml', 'setup.py', 'Makefile', 'Dockerfile',
        '.env', '.eslintrc', 'eslint.config', 'jest.config',
        'extension.toml', 'webpack.config', 'vite.config',
    ];

    /** API surface keywords that indicate semantically important changes */
    private static readonly API_KEYWORDS = /\b(export|public|module\.exports|router\.|app\.|api\.|endpoint|handler|middleware|hook|provider|context|dispatch|emit|subscribe)\b/;

    /**
     * Compute a diff between previousContent and currentContent and return
     * only the *added* lines (lines present in current but not in previous).
     */
    private static addedLines(prev: string, cur: string): string[] {
        const prevSet = new Set(prev.split('\n').map(l => l.trim()));
        return cur.split('\n').filter(l => !prevSet.has(l.trim()) && l.trim().length > 0);
    }

    public static analyze(changedFiles: ChangedFile[]): SignificanceResult {
        let score = 0;
        const reasons: string[] = [];
        let isStructural = false;
        let isConfigChange = false;

        for (const file of changedFiles) {
            const fileName = file.path.split('/').pop() || '';

            // --- Config file bonus ---
            if (this.CONFIG_FILES.some(cf => fileName.includes(cf))) {
                score += 25;
                isConfigChange = true;
                reasons.push(`config: ${fileName}`);
            }

            // --- Deleted / renamed files are always significant ---
            if (file.changeType === FileChangeType.Deleted || file.changeType === FileChangeType.Renamed) {
                score += 20;
                reasons.push(`${file.changeType}: ${fileName}`);
                continue;
            }

            // --- New file ---
            if (file.changeType === FileChangeType.Added) {
                score += 30;
                isStructural = true;
                reasons.push(`new file: ${fileName}`);
                continue;
            }

            // --- Analyze actual content diff ---
            const prev = file.previousContent ?? '';
            const cur = file.currentContent ?? '';
            const added = this.addedLines(prev, cur);

            if (added.length === 0) { continue; }

            // Structural keyword detection on added lines
            const addedBlock = added.join('\n');
            for (const pat of this.STRUCTURAL_PATTERNS) {
                if (pat.test(addedBlock)) {
                    score += 15;
                    isStructural = true;
                    reasons.push(`structural change in ${fileName}`);
                    break; // count once per file
                }
            }

            // API surface change
            if (this.API_KEYWORDS.test(addedBlock)) {
                score += 10;
                reasons.push(`API surface change in ${fileName}`);
            }

            // Scaled line-count contribution (diminishing returns)
            const lineScore = Math.min(20, Math.floor(Math.sqrt(added.length) * 3));
            score += lineScore;
        }

        return { score: Math.min(100, score), reasons, isStructural, isConfigChange };
    }
}

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
    private readonly debounceDelay = 8000; // 8 seconds — longer batch window to reduce noise

    // Dynamic cooldown: after firing an event, impose an adaptive cooldown
    private lastEventTime = 0;
    private readonly baseCooldownMs = 30_000;   // 30 s minimum between events
    private consecutiveSkips = 0;                // exponential back-off counter
    
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
        
        // Large insertions might be from AI (raise threshold to avoid false positives)
        if (totalChangedChars > 200) {
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
     * Effective cooldown — grows when events are skipped consecutively.
     */
    private get effectiveCooldownMs(): number {
        const multiplier = Math.min(Math.pow(2, this.consecutiveSkips), 8);
        return this.baseCooldownMs * multiplier;
    }

    /**
     * Process pending changes and emit event if needed.
     * Uses ChangeSignificanceAnalyzer to decide whether the batch is worth tracking.
     */
    private processPendingChanges(): void {
        if (this.pendingChanges.size === 0) {
            return;
        }

        // --- Cooldown gate ---
        const now = Date.now();
        if (now - this.lastEventTime < this.effectiveCooldownMs) {
            this.consecutiveSkips++;
            console.log(`🔇 AIDetector: cooldown active (${this.effectiveCooldownMs}ms), skipping batch`);
            this.pendingChanges.clear();
            return;
        }

        // Group changes by source
        const changesBySource: Map<CheckpointSource, ChangedFile[]> = new Map();

        for (const [uri, pending] of this.pendingChanges) {
            const previousContent = this.fileSnapshots.get(uri) || '';
            const currentContent = pending.document.getText();
            
            const prevLineCount = this.countLines(previousContent);
            const curLineCount = this.countLines(currentContent);
            const linesAdded = Math.max(0, curLineCount - prevLineCount);
            const linesRemoved = Math.max(0, prevLineCount - curLineCount);

            const changedFile: ChangedFile = {
                path: pending.document.uri.fsPath,
                changeType: FileChangeType.Modified,
                linesAdded,
                linesRemoved,
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

        // --- Significance gate ---
        const allFiles = Array.from(changesBySource.values()).flat();
        const significance = ChangeSignificanceAnalyzer.analyze(allFiles);

        // Threshold: score >= 15 means the change is worth tracking
        if (significance.score < 15) {
            this.consecutiveSkips++;
            console.log(`🔇 AIDetector: low significance (${significance.score}), skipping`);
            this.pendingChanges.clear();
            return;
        }

        console.log(`📊 AIDetector: significance=${significance.score} [${significance.reasons.join('; ')}]`);

        // Emit events for all changes
        for (const [source, changedFiles] of changesBySource) {
            this._onFileChanged.fire({ source, changedFiles });
            
            if (source !== CheckpointSource.User) {
                this._onAIEditDetected.fire({ source, changedFiles });
            }
        }

        // Reset cooldown state on successful emission
        this.lastEventTime = now;
        this.consecutiveSkips = 0;
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
            '.vscodeignore',
            '.vsix',
            '.pkl',
            '.pickle',
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            '.serena/cache'
        ];
        if (ignoredPatterns.some(pattern => fsPath.includes(pattern))) {
            return true;
        }

        // Skip large files
        try {
            const fs = require('fs');
            const stat = fs.statSync(fsPath);
            const maxFileSize = 512 * 1024; // 512KB
            if (stat.size > maxFileSize) {
                console.log(`⏭️  AI Detector: Skipping large file (${(stat.size / 1024).toFixed(0)}KB): ${fsPath}`);
                return true;
            }
        } catch {
            // File might not exist
        }

        return false;
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
