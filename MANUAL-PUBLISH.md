# 手动发布指南

由于 VS Code Marketplace API 连接超时，这里提供手动发布方法。

## 当前状态

- **版本**: 0.5.0
- **包文件**: vibe-code-guardian-0.5.0.vsix (170 KB)
- **发布者**: vibe-coder

## 方法 1: 手动上传到 VS Code Marketplace

### 步骤

1. 访问 [VS Code 发布者管理](https://marketplace.visualstudio.com/manage/publishers/vibe-coder)

2. 登录到你的 Microsoft 账户

3. 找到 "Vibe Code Guardian" 扩展

4. 点击 "Publish" 或 "Update" 按钮

5. 选择或拖拽文件 `vibe-code-guardian-0.5.0.vsix`

6. 填写版本信息：
   - **Version**: 0.5.0
   - **Release notes**: 添加更新说明

7. 点击 "Publish" 上传

### 文件位置

```bash
# 当前目录
pwd
# 输出: /Users/aresnasa/MyProjects/go/src/github.com/aresnasa/vibe-code-guardian

# 包文件
ls -lh vibe-code-guardian-0.5.0.vsix
```

## 方法 2: 使用重试脚本

### 运行重试脚本

```bash
# 使用重试脚本发布
./retry-publish.sh

# 这个脚本会：
# - 尝试最多 3 次发布
# - 每次失败后等待 10 秒
# - 支持输入 PAT
```

### 设置 PAT

```bash
# 设置 PAT 环境变量
export VSCE_PAT='your_pat_here'

# 然后运行重试脚本
./retry-publish.sh
```

## 方法 3: 等待并重试

### 网络问题解决

1. 检查网络连接
   ```bash
   ping marketplace.visualstudio.com
   curl -I https://marketplace.visualstudio.com/_apis/gallery
   ```

2. 检查防火墙设置
   - 确保可以访问 VS Code Marketplace API
   - 检查是否有代理设置

3. 稍后重试
   ```bash
   # 等待几分钟后重试
   ./scripts/build.sh publish
   ```

## Zed 发布

### 直接发布到 crates.io

```bash
# 进入 zed 目录
cd zed

# 检查版本
grep -o 'version = "[^"]*"' extension.toml

# 发布
cargo publish
```

### 发布前验证

```bash
# 检查 cargo 登录状态
cargo login

# 检查现有版本
cargo search vibe-code-guardian
```

## 发布验证

### VS Code Marketplace

1. 访问 [扩展页面](https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian)

2. 检查版本号：0.5.0

3. 测试安装：
   ```bash
   code --install-extension vibe-coder.vibe-code-guardian
   ```

### Zed (crates.io)

1. 访问 [crate 页面](https://crates.io/crates/vibe-code-guardian)

2. 检查版本号：0.5.0

3. 测试安装：
   ```bash
   zed extensions install vibe-code-guardian
   ```

## 发布说明示例

### VS Code Marketplace

```markdown
## Version 0.5.0

### New Features
- Improved .vscodeignore configuration
- Package size optimized from 98MB to 170KB
- Enhanced hard reset functionality with automatic backup
- Better error handling and retry mechanisms
- Improved Zed integration

### Bug Fixes
- Fixed JSON parsing issues in package.json
- Resolved timeout issues in publish process
- Better handling of authentication errors

### Improvements
- Added comprehensive documentation
- Improved backup and restore workflows
- Enhanced test coverage
```

## 故障排除

### 发布失败 - Request timeout

**可能原因**:
- 网络连接问题
- VS Code Marketplace API 暂时不可用
- 防火墙阻止了连接

**解决方案**:
1. 使用手动上传（方法 1）
2. 使用重试脚本（方法 2）
3. 检查网络连接
4. 稍后重试

### 发布失败 - Authentication failed

**可能原因**:
- PAT 无效
- PAT 权限不足
- PAT 已过期

**解决方案**:
1. 访问发布者页面重新创建 PAT
2. 确保权限包含 "Marketplace → Manage"
3. 更新环境变量

### 发布失败 - Version already exists

**可能原因**:
- 版本号已发布
- 需要提升版本号

**解决方案**:
```bash
# 提升版本号
./scripts/build.sh full patch   # 0.5.0 -> 0.5.1
./scripts/build.sh full minor   # 0.5.0 -> 0.6.0
```

## 快速命令

```bash
# 查看包信息
ls -lh vibe-code-guardian-*.vsix

# 运行重试脚本
./retry-publish.sh

# 只发布到 Zed
./scripts/build.sh publish --skip-zed

# 检查发布状态
vsce show vibe-coder.vibe-code-guardian

# 查看版本
jq -r '.version' package.json
```

## 支持链接

- VS Code Marketplace: https://marketplace.visualstudio.com/manage/publishers/vibe-coder
- VS Code Extensions API: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Zed Extensions: https://zed.dev/extensions
- crates.io: https://crates.io/

## 下一步

1. ✅ 选择发布方法（手动上传或重试脚本）
2. ✅ 准备发布说明
3. ✅ 执行发布
4. ✅ 验证发布结果
5. ✅ 测试安装
6. ✅ 更新文档和 CHANGELOG

---

**推荐**: 先尝试手动上传到 VS Code Marketplace，这通常是 API 超时时最快的解决方案。