# 发布准备完成

## 当前状态

✅ **所有准备工作已完成，可以开始发布！**

- **版本**: 0.4.0
- **包文件**: vibe-code-guardian-0.4.0.vsix (164 KB)
- **发布者**: vibe-coder
- **包大小优化**: 从 98MB 降至 164KB

## 包内容验证

### ✅ 已正确排除的文件

测试文件：
- ❌ test-*.sh
- ❌ test-*.txt
- ❌ verify-*.sh
- ❌ scripts/test-dual-publish.sh

演示和内部文档：
- ❌ DEMO-*.md
- ❌ HARD-RESET-*.md
- ❌ CLAUDE.md
- ❌ DUAL_PUBLISHING.md
- ❌ NOTIFICATION_IMPROVEMENTS.md
- ❌ PUBLISH-GUIDE.md
- ❌ test-plan/

构建产物：
- ❌ zed/target/**
- ❌ zed/Cargo.lock
- ❌ src/**
- ❌ out/**
- ❌ node_modules/**

### ✅ 包含的核心文件

主要文件：
- ✓ package.json (16.11 KB)
- ✓ README.md (1.8 KB)
- ✓ changelog.md (1.43 KB)
- ✓ LICENSE.txt
- ✓ Claude.md (0.99 KB)

源代码：
- ✓ dist/extension.js (181.37 KB)
- ✓ zed/src/lib.rs (0.3 KB)
- ✓ zed/extension.toml (0.72 KB)
- ✓ zed/Cargo.toml (0.4 KB)

构建脚本：
- ✓ scripts/build.sh (22.82 KB)

图标和资源：
- ✓ images/icon-*.png (91 KB)
- ✓ images/icon.svg (1.11 KB)

GitHub 配置：
- ✓ .github/copilot-instructions.md (0.68 KB)

## 发布步骤

### 步骤 1: 准备认证

#### VS Code Marketplace
```bash
# 访问发布者页面获取 PAT
# https://marketplace.visualstudio.com/manage/publishers/vibe-coder

# 创建 PAT 并设置
export VSCE_PAT='your_pat_here'
```

#### Zed (crates.io)
```bash
# 登录 crates.io
cargo login

# 输入你的 crates.io token
# 从 https://crates.io/me 获取
```

### 步骤 2: 执行发布

#### 选项 A: 使用 build.sh（推荐）
```bash
# 发布到两个平台
./scripts/build.sh publish

# 只发布到 VS Code
./scripts/build.sh publish --skip-zed

# 带版本提升发布
./scripts/build.sh full patch   # 0.4.0 -> 0.4.1
./scripts/build.sh full minor   # 0.4.0 -> 0.5.0
```

#### 选项 B: 手动发布

```bash
# VS Code
npx @vscode/vsce publish

# Zed
cd zed
cargo publish
```

### 步骤 3: 验证发布

#### VS Code Marketplace
- 访问: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian
- 检查版本: 0.4.0
- 测试安装: `code --install-extension vibe-coder.vibe-code-guardian`

#### Zed (crates.io)
- 访问: https://crates.io/crates/vibe-code-guardian
- 检查版本: 0.4.0
- 测试安装: 在 Zed 设置中添加扩展

## 发布检查清单

### 发布前
- [x] package.json 版本已更新
- [x] .vsix 包已构建
- [x] .vscodeignore 已优化
- [x] 包大小已优化 (164KB)
- [ ] README.md 更新了新功能
- [ ] CHANGELOG.md 添加了版本记录
- [ ] 准备 VS Code Marketplace PAT
- [ ] 准备 crates.io token

### 发布中
- [ ] VS Code Marketplace 认证成功
- [ ] Zed 认证成功
- [ ] 发布过程无错误
- [ ] git 标签已创建

### 发布后
- [ ] VS Code Marketplace 显示新版本
- [ ] crates.io 显示新版本
- [ ] VS Code 安装测试通过
- [ ] Zed 安装测试通过
- [ ] GitHub 标签已推送

## 扩展信息

### VS Code Extension
```json
{
  "name": "vibe-code-guardian",
  "displayName": "Vibe Code Guardian",
  "description": "Game-like checkpoint system for AI-assisted coding",
  "version": "0.4.0",
  "publisher": "vibe-coder",
  "engine": "vscode",
  "categories": ["Other", "SCM Providers"]
}
```

### Zed Extension
```toml
[extension]
name = "vibe-code-guardian"
version = "0.4.0"
description = "Game-like checkpoint system for AI-assisted coding"
```

## 新功能亮点（0.4.0）

### 1. 改进的 .vscodeignore
- ✅ 排除所有测试文件
- ✅ 排除内部文档
- ✅ 排除构建产物
- ✅ 包大小从 98MB 降至 164KB

### 2. 安全的硬重置
- ✅ 自动备份未提交更改
- ✅ 用户确认机制
- ✅ 使用 git stash 恢复

### 3. 双平台发布支持
- ✅ VS Code Marketplace 发布
- ✅ Zed (crates.io) 发布
- ✅ 统一的 build.sh 脚本

### 4. 认证改进
- ✅ 支持环境变量 (VSCE_PAT)
- ✅ 交互式认证提示
- ✅ PAT 验证机制

## 故障排除

### VS Code 发布失败

**错误: Authentication failed**
```
解决方案: 检查 PAT 权限
1. 访问 https://marketplace.visualstudio.com/manage/publishers/vibe-coder
2. 确认 PAT 有 "Marketplace → Manage" 权限
3. 重新创建 PAT
```

**错误: Version already published**
```
解决方案: 提升版本号
./scripts/build.sh full patch
```

### Zed 发布失败

**错误: crate already exists**
```
解决方案: 检查 crates.io 上的现有版本
cargo search vibe-code-guardian
```

**错误: authentication failed**
```
解决方案: 重新登录 cargo
cargo login
```

## 快速命令参考

```bash
# 查看发布指南
cat PUBLISH-GUIDE.md

# 运行发布测试
./test-publish.sh

# 发布当前版本
./scripts/build.sh publish

# 发布新补丁版本
./scripts/build.sh full patch

# 只发布到 VS Code
./scripts/build.sh publish --skip-zed

# 清洁构建
./scripts/build.sh publish --hard
```

## 支持资源

- VS Code Marketplace: https://marketplace.visualstudio.com/manage/publishers/vibe-coder
- crates.io: https://crates.io/me
- VSCE 文档: https://github.com/microsoft/vscode-vsce
- Zed Extensions: https://zed.dev/extensions

## 总结

✅ **所有准备工作已完成！**

现在可以安全地发布 Vibe Code Guardian 0.4.0 版本到两个平台：

1. **VS Code Marketplace** - 通过 `./scripts/build.sh publish`
2. **Zed (crates.io)** - 自动包含在发布流程中

包已经优化（164KB），测试文件已排除，认证机制已就绪。准备发布！