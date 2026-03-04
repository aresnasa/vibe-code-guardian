# 发布状态摘要

## 当前状态

⚠️ **VS Code Marketplace API 连接问题**

- **当前版本**: 0.5.0
- **包文件**: vibe-code-guardian-0.5.0.vsix (170 KB)
- **发布者**: vibe-coder
- **API 状态**: 连接超时 / 404 错误

## 已完成的准备工作

✅ **VS Code Extension**
- [x] package.json 版本已更新到 0.5.0
- [x] .vsix 包已构建（170 KB）
- [x] .vscodeignore 已优化
- [x] 包大小已优化（从 98MB 降至 170KB）
- [x] 测试文件已排除
- [x] 内部文档已排除
- [x] 构建产物已排除

✅ **Zed Extension**
- [x] extension.toml 版本已同步
- [x] Cargo.toml 版本已同步
- [x] zed 目录结构正确
- [x] 构建脚本已更新

✅ **发布脚本**
- [x] build.sh 支持双平台发布
- [x] 认证机制已实现
- [x] --hard 备份功能已添加
- [x] 错误处理已改进
- [x] 重试机制已实现

## 发布选项

### 选项 1: 手动上传（推荐）

由于 API 连接问题，**强烈推荐使用手动上传**：

1. 访问: https://marketplace.visualstudio.com/manage/publishers/vibe-coder
2. 登录 Microsoft 账户
3. 找到 "Vibe Code Guardian" 扩展
4. 点击 "Publish" 或 "Update"
5. 上传文件: `vibe-code-guardian-0.5.0.vsix`
6. 填写版本信息并发布

### 选项 2: 重试脚本

使用自动重试脚本：
```bash
./retry-publish.sh
```

### 选项 3: 等待 API 恢复

稍后重试自动发布：
```bash
./scripts/build.sh publish
```

## 文件位置

```bash
# 当前目录
/Users/aresnasa/MyProjects/go/src/github.com/aresnasa/vibe-code-guardian

# 包文件
vibe-code-guardian-0.5.0.vsix

# 文件大小
170 KB
```

## 包内容验证

✅ **核心文件**
- package.json (16.11 KB)
- dist/extension.js (181.37 KB)
- README.md (1.8 KB)
- CHANGELOG.md (1.43 KB)

✅ **Zed 文件**
- zed/extension.toml (0.72 KB)
- zed/Cargo.toml (0.4 KB)
- zed/src/lib.rs (0.3 KB)

✅ **资源文件**
- images/icon-*.png (91 KB)
- images/icon.svg (1.11 KB)

❌ **已排除文件**
- 测试文件 (test-*.sh, test-*.txt)
- 演示文档 (DEMO-*.md, HARD-RESET-*.md)
- 内部文档 (CLAUDE.md, DUAL_PUBLISHING.md 等)
- 构建产物 (zed/target/**, node_modules/**)

## 发布后验证清单

### VS Code Marketplace
- [ ] 扩展页面显示版本 0.5.0
- [ ] 可以从 VS Code 安装
- [ ] 扩展功能正常工作
- [ ] 发布说明正确显示

### Zed (crates.io)
- [ ] crate 页面显示版本 0.5.0
- [ ] 可以从 Zed 安装
- [ ] 扩展功能正常工作

### Git
- [ ] Git 标签 v0.5.0 已创建
- [ ] 标签已推送到 GitHub
- [ ] 发布提交已推送到主分支

## 技术问题

### API 连接问题

**错误信息**:
```
ERROR  Request timeout: /_apis/gallery
```

**可能原因**:
1. VS Code Marketplace API 暂时不可用
2. 网络连接问题
3. 防火墙限制
4. API 端点变更

**解决方案**:
1. 使用手动上传（选项 1）
2. 使用重试脚本（选项 2）
3. 联系 VS Code Marketplace 支持
4. 等待 API 恢复后重试

## 文档资源

以下文档已创建帮助发布过程：

- **MANUAL-PUBLISH.md** - 详细的手动发布指南
- **PUBLISH-GUIDE.md** - 完整的发布流程指南
- **PUBLISHING-READY.md** - 发布准备状态
- **retry-publish.sh** - 自动重试发布脚本

## 快速参考

```bash
# 查看包文件
ls -lh vibe-code-guardian-0.5.0.vsix

# 运行重试脚本
./retry-publish.sh

# 只发布到 Zed
./scripts/build.sh publish --skip-zed

# 检查版本
jq -r '.version' package.json

# 查看 API 状态
curl -I https://marketplace.visualstudio.com/_apis/gallery
```

## 支持链接

- VS Code Marketplace: https://marketplace.visualstudio.com/manage/publishers/vibe-coder
- VS Code 扩展页面: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian
- crates.io: https://crates.io/crates/vibe-code-guardian
- Zed Extensions: https://zed.dev/extensions

## 下一步行动

### 立即行动
1. ✅ 使用手动上传到 VS Code Marketplace（推荐）
2. ✅ 发布到 crates.io (Zed)

### 后续行动
1. ✅ 验证两个平台的发布
2. ✅ 测试安装和功能
3. ✅ 更新 README 和 CHANGELOG
4. ✅ 推送 git 标签到 GitHub

---

**总结**: 所有准备工作已完成，包已构建并优化。由于 VS Code Marketplace API 连接问题，推荐使用手动上传方法发布 0.5.0 版本。