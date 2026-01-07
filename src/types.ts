/**
 * Vibe Code Guardian - Type Definitions
 * Game-like checkpoint system for AI-assisted coding
 */

export interface Checkpoint {
    /** Unique identifier for the checkpoint */
    id: string;
    /** Display name (like game save slot name) */
    name: string;
    /** Optional description */
    description?: string;
    /** Timestamp when checkpoint was created */
    timestamp: number;
    /** Git commit hash if available */
    gitCommitHash?: string;
    /** Type of checkpoint */
    type: CheckpointType;
    /** Source that triggered the checkpoint */
    source: CheckpointSource;
    /** Files that were changed */
    changedFiles: ChangedFile[];
    /** Session ID this checkpoint belongs to */
    sessionId: string;
    /** Parent checkpoint ID (for tree structure) */
    parentId?: string;
    /** Tags for organization */
    tags: string[];
    /** Whether this checkpoint is starred/favorited */
    starred: boolean;
    /** Branch name if session-based branching is enabled */
    branchName?: string;
}

export enum CheckpointType {
    /** Automatically created checkpoint */
    Auto = 'auto',
    /** Manually created by user */
    Manual = 'manual',
    /** Created when AI tool makes changes */
    AIGenerated = 'ai-generated',
    /** Session start checkpoint */
    SessionStart = 'session-start',
    /** Periodic auto-save */
    AutoSave = 'auto-save'
}

export enum CheckpointSource {
    /** User manually created */
    User = 'user',
    /** GitHub Copilot */
    Copilot = 'copilot',
    /** Anthropic Claude */
    Claude = 'claude',
    /** Cline extension */
    Cline = 'cline',
    /** Other AI assistant */
    OtherAI = 'other-ai',
    /** Auto-save timer */
    AutoSave = 'auto-save',
    /** File watcher */
    FileWatcher = 'file-watcher',
    /** Unknown source */
    Unknown = 'unknown'
}

export interface ChangedFile {
    /** Relative path to the file */
    path: string;
    /** Type of change */
    changeType: FileChangeType;
    /** Lines added */
    linesAdded: number;
    /** Lines removed */
    linesRemoved: number;
    /** Snapshot of file content before change (for non-git rollback) */
    previousContent?: string;
    /** Snapshot of file content after change */
    currentContent?: string;
}

export enum FileChangeType {
    Added = 'added',
    Modified = 'modified',
    Deleted = 'deleted',
    Renamed = 'renamed'
}

/** Commit message language */
export type CommitLanguage = 'en' | 'zh' | 'auto';

export interface CodingSession {
    /** Unique session identifier */
    id: string;
    /** Session name */
    name: string;
    /** When session started */
    startTime: number;
    /** When session ended (if ended) */
    endTime?: number;
    /** Whether session is currently active */
    isActive: boolean;
    /** Git branch created for this session */
    branchName?: string;
    /** Checkpoints in this session */
    checkpointIds: string[];
    /** Total files changed in session */
    totalFilesChanged: number;
    /** AI tools used in this session */
    aiToolsUsed: CheckpointSource[];
}

export interface CheckpointStorageData {
    /** Version for migration */
    version: number;
    /** All checkpoints */
    checkpoints: Checkpoint[];
    /** All sessions */
    sessions: CodingSession[];
    /** Current active session ID */
    activeSessionId?: string;
    /** Settings */
    settings: GuardianSettings;
}

export interface GuardianSettings {
    /** Enable auto-checkpoint on AI edits */
    autoCheckpointOnAI: boolean;
    /** Enable auto-checkpoint on user edits (file save) */
    autoCheckpointOnUserSave: boolean;
    /** Minimum lines changed to trigger user checkpoint */
    minLinesForUserCheckpoint: number;
    /** Auto-save interval in seconds (0 = disabled) */
    autoSaveInterval: number;
    /** Maximum checkpoints to keep */
    maxCheckpoints: number;
    /** Enable Git integration */
    enableGit: boolean;
    /** Create branch for each session */
    createSessionBranch: boolean;
    /** Show notifications on checkpoint */
    showNotifications: boolean;
    /** Checkpoint naming pattern */
    namingPattern: string;
    /** Files/patterns to ignore */
    ignorePatterns: string[];
    /** Commit message language: 'en', 'zh', or 'auto' (detect from VS Code) */
    commitLanguage: CommitLanguage;
}

export interface RollbackResult {
    success: boolean;
    message: string;
    filesRestored: string[];
    filesNotRestored: string[];
    errors: string[];
}

export interface DiffInfo {
    filePath: string;
    hunks: DiffHunk[];
    linesAdded: number;
    linesRemoved: number;
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
}

export const DEFAULT_SETTINGS: GuardianSettings = {
    autoCheckpointOnAI: true,
    autoCheckpointOnUserSave: true,
    minLinesForUserCheckpoint: 5,
    autoSaveInterval: 300, // 5 minutes
    maxCheckpoints: 100,
    enableGit: true,
    createSessionBranch: false,
    showNotifications: true,
    namingPattern: '{type}-{timestamp}',
    ignorePatterns: [
        'node_modules/**',
        '.git/**',
        '*.log',
        '.vscode-test/**',
        'out/**',
        'dist/**'
    ]
};
