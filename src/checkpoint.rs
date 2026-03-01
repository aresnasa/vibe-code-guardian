use crate::types::{Checkpoint, Session};
use anyhow::{Context, Result};
use chrono::Utc;
use serde_json;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Manages checkpoints and sessions
pub struct CheckpointManager {
    /// Path to the storage directory
    storage_path: PathBuf,
    /// Current checkpoints
    checkpoints: Vec<Checkpoint>,
    /// Current sessions
    sessions: Vec<Session>,
    /// Current session ID
    current_session_id: Option<String>,
}

impl CheckpointManager {
    /// Create a new checkpoint manager
    pub fn new(storage_path: &Path) -> Result<Self> {
        fs::create_dir_all(storage_path)?;
        let mut manager = Self {
            storage_path: storage_path.to_path_buf(),
            checkpoints: Vec::new(),
            sessions: Vec::new(),
            current_session_id: None,
        };
        manager.load_from_disk()?;
        Ok(manager)
    }

    /// Load checkpoints and sessions from disk
    fn load_from_disk(&mut self) -> Result<()> {
        let checkpoints_file = self.storage_path.join("checkpoints.json");
        let sessions_file = self.storage_path.join("sessions.json");

        if checkpoints_file.exists() {
            let content = fs::read_to_string(&checkpoints_file)?;
            self.checkpoints = serde_json::from_str(&content)?;
        }

        if sessions_file.exists() {
            let content = fs::read_to_string(&sessions_file)?;
            self.sessions = serde_json::from_str(&content)?;
        }

        Ok(())
    }

    /// Save checkpoints and sessions to disk
    fn save_to_disk(&self) -> Result<()> {
        let checkpoints_file = self.storage_path.join("checkpoints.json");
        let sessions_file = self.storage_path.join("sessions.json");

        let checkpoints_json = serde_json::to_string_pretty(&self.checkpoints, Default::default())?;
        let sessions_json = serde_json::to_string_pretty(&self.sessions, Default::default())?;

        fs::write(&checkpoints_file, checkpoints_json)?;
        fs::write(&sessions_file, sessions_json)?;

        Ok(())
    }

    /// Start a new session
    pub fn start_session(&mut self, name: Option<String>) -> Result<Session> {
        let session_id = Self::generate_id();
        let timestamp = Utc::now().timestamp_millis();

        let session = Session {
            id: session_id.clone(),
            name: name.unwrap_or_else(|| format!("Session {}", self.sessions.len() + 1)),
            start_time: timestamp,
            end_time: None,
        };

        self.current_session_id = Some(session_id.clone());
        self.sessions.push(session.clone());
        self.save_to_disk()?;

        log::info!("Started session: {}", session.id);
        Ok(session)
    }

    /// End the current session
    pub fn end_session(&mut self) -> Result<()> {
        if let Some(ref session_id) = self.current_session_id {
            if let Some(session) = self.sessions.iter_mut().find(|s| s.id == *session_id) {
                session.end_time = Some(Utc::now().timestamp_millis());
                self.save_to_disk()?;
                log::info!("Ended session: {}", session_id);
            }
        }
        self.current_session_id = None;
        Ok(())
    }

    /// Create a checkpoint
    pub fn create_checkpoint(
        &mut self,
        name: String,
        worktree_path: &Path,
    ) -> Result<Checkpoint> {
        let session_id = self.current_session_id
            .clone()
            .unwrap_or_else(|| Self::generate_id());

        let timestamp = Utc::now().timestamp_millis();
        let id = Self::generate_id();

        // Track files
        let file_count = self.track_files(worktree_path)?;

        // Try to get git commit hash
        let commit_hash = self.get_git_commit(worktree_path)?;

        let checkpoint = Checkpoint {
            id: id.clone(),
            name,
            timestamp,
            commit_hash,
            session_id,
            file_count,
        };

        self.checkpoints.push(checkpoint.clone());
        self.save_to_disk()?;

        log::info!("Created checkpoint: {} with {} files", id, file_count);
        Ok(checkpoint)
    }

    /// Quick save (checkpoint with auto name)
    pub fn quick_save(&mut self, worktree_path: &Path) -> Result<Checkpoint> {
        let name = format!("Quick Save {}", self.checkpoints.len() + 1);
        self.create_checkpoint(name, worktree_path)
    }

    /// Rollback to a checkpoint
    pub fn rollback(&self, checkpoint_id: &str, worktree_path: &Path) -> Result<()> {
        let checkpoint = self.checkpoints
            .iter()
            .find(|c| c.id == checkpoint_id)
            .ok_or_else(|| anyhow::anyhow!("Checkpoint not found: {}", checkpoint_id))?;

        log::info!("Rolling back to checkpoint: {}", checkpoint_id);

        // TODO: Implement actual rollback logic
        // This would restore files from the checkpoint

        Ok(())
    }

    /// Delete a checkpoint
    pub fn delete_checkpoint(&mut self, checkpoint_id: &str) -> Result<()> {
        let index = self.checkpoints
            .iter()
            .position(|c| c.id == checkpoint_id)
            .ok_or_else(|| anyhow::anyhow!("Checkpoint not found: {}", checkpoint_id))?;

        self.checkpoints.remove(index);
        self.save_to_disk()?;

        log::info!("Deleted checkpoint: {}", checkpoint_id);
        Ok(())
    }

    /// List all checkpoints
    pub fn list_checkpoints(&self, session_id: Option<&str>) -> Vec<&Checkpoint> {
        if let Some(id) = session_id {
            self.checkpoints.iter().filter(|c| c.session_id == id).collect()
        } else {
            self.checkpoints.iter().collect()
        }
    }

    /// List all sessions
    pub fn list_sessions(&self) -> &[Session] {
        &self.sessions
    }

    /// Track files in the worktree
    fn track_files(&self, worktree_path: &Path) -> Result<usize> {
        let mut file_count = 0;
        if let Ok(entries) = fs::read_dir(worktree_path) {
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    file_count += 1;
                }
            }
        }
        Ok(file_count)
    }

    /// Get current git commit hash
    fn get_git_commit(&self, worktree_path: &Path) -> Result<Option<String>> {
        let git_dir = worktree_path.join(".git");
        if !git_dir.exists() {
            return Ok(None);
        }

        // Use git to get the current commit
        let output = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(worktree_path)
            .output()?;

        if output.status.success() {
            let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(Some(hash))
        } else {
            Ok(None)
        }
    }

    /// Generate a unique ID
    fn generate_id() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let duration = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        format!("cp_{}", duration.as_millis())
    }
}
