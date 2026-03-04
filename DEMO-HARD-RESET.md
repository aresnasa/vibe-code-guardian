# Git Hard Reset with Backup Demo

## 概述

本演示展示了 `build.sh` 中的 `--hard` 参数功能，它可以在执行硬重置前自动备份所有未提交的更改。

## 功能特性

### 自动备份
- 检测所有未提交的更改（已修改、已暂存、未跟踪）
- 使用 `git stash` 创建备份
- 备保存储在 `.backup/` 目录中
- 记录备份时间戳和 git stash 引用

### 安全确认
- 在执行硬重置前提示用户确认
- 显示将要执行的操作
- 防止意外数据丢失

### 恢复机制
- 通过 `git stash pop` 恢复备份
- 通过 `git stash list` 查看所有可用备份
- 通过 `git stash drop` 删除备份

## 使用示例

### 1. 创建未提交的更改

```bash
# 修改现有文件
echo "// Test modification" >> package.json

# 创建新文件
echo "New untracked file" > test-file.txt
```

### 2. 检查 git 状态

```bash
git status
```

输出示例：
```
Changes not staged for commit:
  modified:   package.json

Untracked files:
  test-file.txt
```

### 3. 使用 --hard 参数构建

```bash
./scripts/build.sh build --hard
```

### 4. 脚本执行流程

当使用 `--hard` 参数时，脚本会：

1. **检测更改**
   ```
   ℹ Hard reset mode requested (--hard flag)
   ```

2. **创建备份**
   ```
   ℹ Changes detected. Creating backup before hard reset...
   ℹ Stashing current changes...
   ✓ Backup created successfully!
   ✓ Backup location: .backup/20260304_180605
   ✓ Stash reference: abc123...
   ```

3. **确认提示**
   ```
   Do you want to proceed with hard reset? (y/n): _
   ```

4. **执行硬重置**（如果确认）
   ```
   ℹ Performing hard reset...
   ✓ Hard reset completed!
   ```

### 5. 查看备份

```bash
# 查看所有备份
git stash list

# 查看备份日志
cat .backup/backup.log
```

### 6. 恢复备份

```bash
# 恢复最新的备份
git stash pop

# 恢复特定的备份
git stash pop stash@{0}
```

## 技术实现

### build.sh 中的关键函数

#### `create_backup()` - 创建备份
```bash
create_backup() {
    local backup_timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_dir=".backup/${backup_timestamp}"

    mkdir -p ".backup"

    # 使用 git stash 创建备份
    git stash push -u -m "Auto-backup before hard reset" --include-untracked

    # 记录备份信息
    echo "Backup: $backup_timestamp | $stash_ref" >> ".backup/backup.log"
}
```

#### `check_hard_reset()` - 检查并执行硬重置
```bash
check_hard_reset() {
    if [ "$HARD_RESET" = "true" ]; then
        # 检测更改
        if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
            # 创建备份
            create_backup

            # 确认提示
            read -p "Proceed? (y/n): " -n 1 -r

            # 执行硬重置
            git reset --hard HEAD
            git clean -fd
        fi
    fi
}
```

## 备份文件结构

```
.backup/
├── backup.log           # 备份日志
├── 20260304_180605/   # 带时间戳的备份目录
│   ├── package.json      # 重要文件备份
│   ├── README.md
│   ├── git_head.txt     # Git HEAD 引用
│   ├── git_branch.txt   # Git 分支信息
│   └── git_commit.txt  # 最新提交信息
```

## 命令总结

| 命令 | 描述 |
|------|------|
| `./scripts/build.sh build --hard` | 构建前硬重置并备份 |
| `./scripts/build.sh package --hard` | 打包前硬重置并备份 |
| `./scripts/build.sh publish --hard` | 发布前硬重置并备份 |
| `./scripts/build.sh full minor --hard` | 完整发布（含版本提升）并硬重置 |

## 安全注意事项

1. **确认机制**：总是要求用户在执行破坏性操作前确认
2. **备份保证**：在执行硬重置前创建完整备份
3. **可恢复性**：使用标准的 git stash 机制，易于恢复
4. **日志记录**：所有备份操作都有日志记录

## 故障排除

### 问题：备份创建失败
```bash
# 检查 git 状态
git status

# 确保有更改需要备份
git diff
git ls-files --others --exclude-standard
```

### 问题：无法恢复备份
```bash
# 查看可用的备份
git stash list

# 尝试恢复特定的备份
git stash show stash@{0}

# 如果 stash 不存在，检查 .backup/ 目录
ls -la .backup/
```

### 问题：需要清除所有备份
```bash
# 清除所有 git stashes
git stash clear

# 删除备份目录
rm -rf .backup/
```

## 最佳实践

1. **开发前备份**：在重大更改前使用 `--hard` 确保清洁环境
2. **定期清理**：定期清理旧的备份以节省空间
3. **测试恢复**：定期测试备份恢复流程确保可用性
4. **文档记录**：为重要更改记录备份引用

## 总结

`--hard` 参数提供了一个安全、可控的硬重置机制：
- ✅ 自动备份未提交更改
- ✅ 用户确认提示
- ✅ 标准的 git stash 机制
- ✅ 完整的日志记录
- ✅ 简单的恢复流程

这样可以确保在进行硬重置时不会意外丢失重要的未提交更改。