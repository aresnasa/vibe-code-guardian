use serde::{Deserialize, Serialize};

/// Represents a checkpoint in the system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Unique ID for this checkpoint
    pub id: String,
    /// Human-readable name/description
    pub name: String,
    /// When the checkpoint was created
    pub timestamp: i64,
    /// Git commit hash (if available)
    pub commit_hash: Option<String>,
    /// Session ID this checkpoint belongs to
    pub session_id: String,
    /// Number of files tracked in this checkpoint
    pub file_count: usize,
}

/// Represents a coding session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Unique ID for this session
    pub id: String,
    /// Session name
    pub name: String,
    /// When the session started
    pub start_time: i64,
    /// When the session ended (if ended)
    pub end_time: Option<i64>,
}

/// Configuration for the guardian
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardianConfig {
    /// Enable automatic checkpoints
    pub auto_save_enabled: bool,
    /// Minutes between auto-saves
    pub auto_save_interval_minutes: u32,
    /// Max checkpoints per session
    pub max_checkpoints_per_session: u32,
    /// Enable checkpoint on AI changes
    pub auto_checkpoint_on_ai_changes: bool,
}

impl Default for GuardianConfig {
    fn default() -> Self {
        Self {
            auto_save_enabled: true,
            auto_save_interval_minutes: 5,
            max_checkpoints_per_session: 50,
            auto_checkpoint_on_ai_changes: true,
        }
    }
}

/// Represents a file change
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    /// File path
    pub path: String,
    /// Old content (before change)
    pub old_content: Option<String>,
    /// New content (after change)
    pub new_content: Option<String>,
    /// Change type (added, modified, deleted)
    pub change_type: ChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
}
