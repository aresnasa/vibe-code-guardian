mod checkpoint;
mod types;

use checkpoint::CheckpointManager;
use types::Checkpoint;
use zed_extension_api::{
    self as zed,
    Command, Context, SlashCommand, SlashCommandArgumentCompletion, SlashCommandOutput,
    SlashCommandOutputSection, Worktree,
};
use std::sync::Mutex;

struct VibeGuardianExtension {
    checkpoint_manager: Mutex<Option<CheckpointManager>>,
}

impl VibeGuardianExtension {
    fn new() -> Self {
        Self {
            checkpoint_manager: Mutex::new(None),
        }
    }

    /// Get or create the checkpoint manager for a worktree
    fn get_manager(&self, worktree: &Worktree) -> anyhow::Result<&mut CheckpointManager> {
        let mut guard = self.checkpoint_manager.lock().unwrap();
        if guard.is_none() {
            let path = worktree.path();
            *guard = Some(CheckpointManager::new(&path)?);
        }
        Ok(guard.as_mut().unwrap())
    }
}

impl zed::Extension for VibeGuardianExtension {
    fn new() -> Self {
        Self::new()
    }

    /// Complete slash command arguments
    fn complete_slash_command_argument(
        &self,
        _command: SlashCommand,
        _args: Vec<String>,
    ) -> Result<Vec<zed_extension_api::SlashCommandArgumentCompletion>, String> {
        Ok(vec![])
    }

    /// Run a slash command
    fn run_slash_command(
        &self,
        command: SlashCommand,
        args: Vec<String>,
        worktree: Option<&Worktree>,
    ) -> Result<SlashCommandOutput, String> {
        let worktree = worktree.ok_or("No active worktree")?;

        let manager = self.get_manager(worktree)?;

        match command.name.as_str() {
            "create-checkpoint" => {
                let name = args.first()
                    .map(|s| s.as_str())
                    .unwrap_or("Unnamed Checkpoint");
                match manager.create_checkpoint(name.to_string(), worktree.path()) {
                    Ok(checkpoint) => Ok(SlashCommandOutput {
                        sections: vec![],
                        text: format!("Created checkpoint: {} ({})", checkpoint.name, checkpoint.id),
                    }),
                    Err(e) => Err(format!("Failed to create checkpoint: {}", e)),
                }
            }
            "quick-save" => {
                match manager.quick_save(worktree.path()) {
                    Ok(checkpoint) => Ok(SlashCommandOutput {
                        sections: vec![],
                        text: format!("Quick saved: {} ({})", checkpoint.name, checkpoint.id),
                    }),
                    Err(e) => Err(format!("Failed to quick save: {}", e)),
                }
            }
            "rollback" => {
                let checkpoint_id = args.first()
                    .ok_or("Please specify a checkpoint ID")?;
                match manager.rollback(checkpoint_id, worktree.path()) {
                    Ok(_) => Ok(SlashCommandOutput {
                        sections: vec![],
                        text: format!("Rolled back to: {}", checkpoint_id),
                    }),
                    Err(e) => Err(format!("Failed to rollback: {}", e)),
                }
            }
            "view-diff" => {
                let checkpoint_id = args.first()
                    .ok_or("Please specify a checkpoint ID")?;
                Ok(SlashCommandOutput {
                    sections: vec![],
                    text: format!("Diff view for: {}", checkpoint_id),
                })
            }
            "list-checkpoints" => {
                let session_id = args.first().map(|s| s.as_str());
                let checkpoints = manager.list_checkpoints(session_id);
                if checkpoints.is_empty() {
                    Ok(SlashCommandOutput {
                        sections: vec![],
                        text: "No checkpoints found".to_string(),
                    })
                } else {
                    let mut text = format!("Checkpoints ({}):\n", checkpoints.len());
                    for (i, cp) in checkpoints.iter().enumerate() {
                        text.push_str(&format!(
                            "  {}. {} - {} ({})\n",
                            i + 1,
                            cp.name,
                            cp.id
                        ));
                    }
                    Ok(SlashCommandOutput {
                        sections: vec![],
                        text,
                    })
                }
            }
            "delete-checkpoint" => {
                let checkpoint_id = args.first()
                    .ok_or("Please specify a checkpoint ID")?;
                match manager.delete_checkpoint(checkpoint_id) {
                    Ok(_) => Ok(SlashCommandOutput {
                        sections: vec![],
                        text: format!("Deleted checkpoint: {}", checkpoint_id),
                    }),
                    Err(e) => Err(format!("Failed to delete checkpoint: {}", e)),
                }
            }
            _ => Err(format!("Unknown command: {}", command.name)),
        }
    }
}

zed::register_extension!(VibeGuardianExtension);
