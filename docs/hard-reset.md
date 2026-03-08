# Hard Reset with Backup

The `--hard` flag on `build.sh` resets your working directory to a clean state **before** building. It automatically backs up all uncommitted changes so nothing is lost.

---

## Usage

```bash
# Append --hard to any build mode
./scripts/build.sh build   --hard
./scripts/build.sh package --hard
./scripts/build.sh publish --hard
./scripts/build.sh full minor --hard
```

---

## What Happens

1. **Detect changes** — checks for modified, staged, and untracked files
2. **Create backup** — `git stash push -u` + snapshot in `.backup/{timestamp}/`
3. **Confirm** — prompts you before doing anything destructive
4. **Reset** — `git reset --hard HEAD && git clean -fd`
5. **Continue** — proceeds with the normal build/package/publish flow

```
$ ./scripts/build.sh build --hard

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ⚠  Hard Reset Mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ Creating backup → .backup/20260304_180605
✓ Backup saved to .backup/20260304_180605
Proceed with hard reset? (y/n): y
✓ Hard reset completed
```

---

## Backup Structure

```
.backup/
├── backup.log                    # One-line-per-backup history
├── 20260304_180605/
│   ├── package.json              # Snapshot of key files
│   ├── git_head.txt              # HEAD commit SHA
│   ├── git_branch.txt            # Branch name
│   └── git_commit.txt            # One-line commit message
└── 20260305_093012/
    └── ...
```

All backups are also stored as git stashes for easy restoration.

---

## Restoring a Backup

### From git stash (recommended)

```bash
# List all backups
git stash list

# Restore the most recent backup
git stash pop

# Restore a specific backup
git stash pop stash@{1}

# Preview what's in a stash
git stash show stash@{0} -p
```

### From backup directory

```bash
# See the backup log
cat .backup/backup.log

# Check which commit was backed up
cat .backup/20260304_180605/git_head.txt

# Hard reset to that commit
git reset --hard $(cat .backup/20260304_180605/git_head.txt)
```

---

## Cleanup

```bash
# Remove all git stashes
git stash clear

# Remove backup directory
rm -rf .backup/

# Or remove a single stash
git stash drop stash@{0}
```

---

## Safety Guarantees

| Feature | Detail |
|---------|--------|
| **Auto-backup** | Changes are always stashed before any destructive action |
| **Confirmation** | Interactive `y/n` prompt — you can always cancel |
| **Standard tooling** | Uses `git stash`, not a custom format |
| **Logged** | `.backup/backup.log` records every backup with timestamp |
| **Idempotent** | If the working tree is already clean, no backup is created |

> **Note:** `.backup/` is listed in `.gitignore` — backups stay local and are never committed.