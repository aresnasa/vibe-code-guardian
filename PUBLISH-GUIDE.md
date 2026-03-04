# 发布指南 - VS Code Marketplace & Zed.dev

## 当前状态

- **当前版本**: 0.4.0
- **包文件**: vibe-code-guardian-0.4.0.vsix (已构建)
- **发布者**: vibe-coder

## VS Code Marketplace 发布

### 步骤 1: 获取 Personal Access Token (PAT)

1. 访问 [VS Code Marketplace 发布管理](https://marketplace.visualstudio.com/manage/publishers/vibe-coder)
2. 登录到你的 Microsoft 账户
3. 点击 "Create new Personal Access Token"
4. 设置以下权限：
   - **Access**: All accessible accounts
   - **Organization**: 你的组织（如果适用）
   - **Expiration**: 选择合适的过期时间
   - **Scopes**: 勾选 "Marketplace → Manage"

### 步骤 2: 设置认证

有三种方式设置 PAT：

#### 方式 1: 环境变量（推荐用于 CI/CD）
```bash
export VSCE_PAT='your_token_here'
```

#### 方式 2: 直接登录（交互式）
```bash
vsce login vibe-coder
# 然后粘贴你的 PAT
```

#### 方式 3: 使用 build.sh 脚本（推荐）
```bash
./scripts/build.sh publish
# 脚本会提示你输入 PAT
```

### 步骤 3: 发布扩展

#### 方式 1: 使用 build.sh（推荐）
```bash
# 发布当前版本（0.4.0）
./scripts/build.sh publish

# 跳过 zed 发布（只发布到 VS Code）
./scripts/build.sh publish --skip-zed

# 带版本提升发布
./scripts/build.sh full patch
./scripts/build.sh full minor
```

#### 方式 2: 使用 vsce 直接发布
```bash
# 如果已认证
npx @vscode/vsce publish

# 发布特定版本
npx @vscode/vsce publish 0.4.0
```

### 步骤 4: 验证发布

1. 访问 [扩展页面](https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian)
2. 检查版本号是否为 0.4.0
3. 在 VS Code 中测试安装：
   ```bash
   code --install-extension vibe-coder.vibe-code-guardian
   ```

## Zed.dev 发布

### 步骤 1: 准备 Zed 扩展

Zed 扩展已经包含在项目中（`zed/` 目录）。build.sh 脚本会自动处理：

```bash
# 发布到 crates.io
./scripts/build.sh publish

# build.sh 会自动：
# 1. 更新 zed/extension.toml 版本
# 2. 更新 zed/Cargo.toml 版本
# 3. 构建 zed 扩展
# 4. 发布到 crates.io
```

### 步骤 2: 设置 Cargo 认证

如果你还没有设置 crates.io 认证：

```bash
# 登录 crates.io
cargo login

# 输入你的 crates.io token
# Token 可以从 https://crates.io/me 获取
```

### 步骤 3: 手动发布到 crates.io（可选）

如果自动发布失败，可以手动发布：

```bash
cd zed
cargo publish
```

### 步骤 4: 在 Zed 中安装测试

1. 打开 Zed
2. 进入设置 (Cmd+,)
3. 在 extensions 部分添加：
   ```json
   "extensions": {
     "vibe-code-guardian": {
       "version": "0.4.0"
     }
   }
   ```
4. 或者使用命令：
   ```bash
   zed extensions install vibe-code-guardian
   ```

## 双平台发布流程

### 推荐的完整发布流程

```bash
# 1. 设置认证（可选，脚本会提示）
export VSCE_PAT='your_vsce_pat'

# 2. 执行完整发布（包含版本提升）
./scripts/build.sh full patch

# 这个命令会：
# - 版本号从 0.4.0 提升到 0.4.1
# - 构建 VS Code 扩展
# - 打包 .vsix 文件
# - 发布到 VS Code Marketplace
# - 构建 zed 扩展
# - 发布到 crates.io
# - 创建 git 标签
# - 推送到 GitHub
```

## 排除文件的配置

为了确保发布的包不包含测试文件和内部文档，`.vscodeignore` 已经配置为排除：

```gitignore
# 测试文件
test-*.sh
test-*.txt
verify-*.sh

# 演示文档
DEMO-*.md
HARD-RESET-*.md

# 内部文档
CLAUDE.md
DUAL_PUBLISHING.md
NOTIFICATION_IMPROVEMENTS.md
test-plan/
```

## 发布检查清单

### 发布前检查
- [ ] package.json 版本号已更新
- [ ] README.md 更新了新功能说明
- [ ] CHANGELOG.md 添加了版本变更
- [ ] 所有测试通过
- [ ] .vsix 包文件已构建
- [ ] .vsix 包内容检查无误

### 发布中检查
- [ ] VS Code Marketplace 认证成功
- [ ] crates.io 认证成功
- [ ] 发布过程无错误

### 发布后验证
- [ ] VS Code Marketplace 页面显示新版本
- [ ] crates.io 页面显示新版本
- [ ] 在 VS Code 中测试安装
- [ ] 在 Zed 中测试安装
- [ ] git 标签已创建和推送

## 错误处理

### VS Code Marketplace 发布失败

**错误: Authentication required**
```
解决方案: 获取有效的 PAT 并设置
export VSCE_PAT='your_token'
```

**错误: Version already exists**
```
解决方案: 提升版本号
./scripts/build.sh full patch
```

**错误: Publisher not found**
```
解决方案: 检查发布者名称是否正确
当前发布者: vibe-coder
```

### Zed 发布失败

**错误: cargo login not configured**
```
解决方案: 登录 crates.io
cargo login
```

**错误: Version already published**
```
解决方案: 检查 crates.io 上的现有版本
cargo search vibe-code-guardian
```

## 当前包信息

### VS Code Extension
- **名称**: vibe-code-guardian
- **显示名称**: Vibe Code Guardian
- **发布者**: vibe-coder
- **市场 ID**: vibe-coder.vibe-code-guardian
- **市场链接**: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian
- **版本**: 0.4.0

### Zed Extension
- **包名**: vibe-code-guardian
- **发布者**: vibe-coder
- **crates.io 链接**: https://crates.io/crates/vibe-code-guardian
- **版本**: 0.4.0

## 快速发布命令

```bash
# 最简单的发布方式（脚本会提示所有必要信息）
./scripts/build.sh publish

# 发布并跳过 zed
./scripts/build.sh publish --skip-zed

# 带版本提升的发布
./scripts/build.sh full patch   # 0.4.0 -> 0.4.1
./scripts/build.sh full minor   # 0.4.0 -> 0.5.0
./scripts/build.sh full major   # 0.4.0 -> 1.0.0
```

## 注意事项

1. **PAT 安全性**: 不要将 PAT 提交到 git 仓库
2. **版本管理**: 发布前确认版本号符合语义化版本
3. **测试验证**: 发布后在两个平台都进行测试安装
4. **文档更新**: 及时更新 README 和 CHANGELOG
5. **备份保护**: 使用 `--hard` 参数时，脚本会自动备份

需要帮助？参考 [VS Code Publishing API](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) 和 [Zed Extensions](https://zed.dev/extensions)。