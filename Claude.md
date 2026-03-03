1. 添加项目历史存档变化文件跳转的功能能够支持直接在 vscode 打开 git 追踪到的变化文件。
2. 集成 git graph 到本项目，支持git 代码变化的图展示，包括上下文和依赖等功能。
3. 可以参考https://github.com/abhigyanpatwari/GitNexus中的核心概念
4. Cannot show diff: no git commit associated.检查 diff 函数问题
5. 回归测试本项目的所有功能
6. 现在调整 git 追踪 zed 需要一并提交到 github，同时调整 scripts/build.sh
7. 改造本项目需要推送到 vscode-market 还需要推送到 zed.dev
8. 改进下 build.sh 的 tag 号替换函数这里不是没构建一次就新增一个 tag 号的而是有发布参数比如 release 才需要更新 tag 号
9. 改进本项目 vscode 右下角通知的频率，这里不用太频繁的通知，同时要能支持关闭多个子窗口