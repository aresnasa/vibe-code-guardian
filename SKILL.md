---
name: git-commit
description: "Automatically commit and push code changes to Git. Use when: user asks to commit, save changes, push code, auto-commit, git commit, submit changes, or sync code to remote. Handles staging, generating commit messages, committing, and pushing."
argument-hint: "Optional: commit message or description of changes"
---

# Git Auto-Commit Skill

Automatically stage, commit, and optionally push code changes with meaningful commit messages.

## When to Use

- User asks to "commit", "save changes", "push code", "auto commit"
- After completing a coding task when user wants to persist changes
- User says "提交代码", "推送代码", "保存更改", "自动提交"

## Procedure

### 1. Check Repository Status

Run `git status` to understand the current state:
- Which files are modified, added, or deleted
- Which files are staged vs unstaged
- Current branch name

### 2. Review Changes

Use `get_changed_files` tool or `git diff` to review what changed:
- For unstaged changes: `git diff`
- For staged changes: `git diff --cached`
- Summarize the changes for the user

### 3. Stage Changes

Stage the appropriate files:
- If user specifies files, stage only those: `git add <files>`
- If no specific files mentioned, stage all changes: `git add -A`
- Never force-add files that are in `.gitignore`

### 4. Generate Commit Message

Generate a meaningful commit message following **Conventional Commits** format:

```
<type>(<scope>): <subject>

<body>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `docs`: Documentation changes
- `style`: Formatting, missing semicolons, etc.
- `test`: Adding or updating tests
- `chore`: Build process, dependencies, tooling
- `ci`: CI/CD configuration changes
- `perf`: Performance improvements

Rules:
- Subject line: max 72 characters, imperative mood, no period at end
- Body: wrap at 72 characters, explain what and why (not how)
- If user provides a commit message, use it directly
- If user provides a description, generate a proper conventional commit message from it

### 5. Commit

Execute the commit:
```bash
git commit -m "<message>"
```

### 6. Push (if requested)

Only push if the user explicitly asks or confirms:
```bash
git push origin <current-branch>
```

If the remote branch doesn't exist yet:
```bash
git push -u origin <current-branch>
```

## Safety Rules

1. **Always show the user what will be committed** before committing
2. **Never force push** (`git push --force`) without explicit user confirmation
3. **Never commit secrets**, credentials, or sensitive data — warn the user if detected
4. **Never amend published commits** without user confirmation
5. **Check for merge conflicts** before committing
6. **Respect .gitignore** — don't stage ignored files
7. **Show the commit result** after committing (hash, message, files changed)

## Commit Message Language

- Default: English for commit messages
- If user writes in Chinese, generate bilingual or English commit message unless user explicitly requests Chinese

## Example Workflow

```
User: 提交代码

1. git status                          → See what changed
2. get_changed_files                   → Review diffs
3. Show summary to user                → "Modified 3 files: ..."
4. git add -A                          → Stage all changes
5. git commit -m "feat(admin): ..."    → Commit with generated message
6. Report success                      → "Committed abc1234: feat(admin): ..."
```
