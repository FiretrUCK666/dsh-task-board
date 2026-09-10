# 贡献指南

这个项目接受 Issue 与 Pull Request。开始之前说明几件必要的事，能省掉来回。

## 报告问题

到 [Issues](https://github.com/FiretrUCK666/dsh-task-board/issues) 提交。**插件无法加载**是最常见的一类，请附上：

- 你的 DeepSeek Harness 版本（`dsh --version`）；
- 本插件版本（设置 → 已安装插件列表里看）；
- 界面上那段报错原文，或终端启动时的报错。

这三样基本能直接定位。DeepSeek Harness 的内部接口会随版本变化，插件需要跟着改；报错原文能直接指出是哪个接口变了。

## 开发环境

```sh
git clone https://github.com/FiretrUCK666/dsh-task-board.git
cd dsh-task-board
pnpm install
pnpm build       # 产出 lib/index.js 与 lib/client.js
pnpm typecheck
pnpm test        # 单元与契约测试
pnpm verify      # 静态门禁 + 客户端 bundle 冒烟
```

本地调试挂载：

```sh
dsh plugin --profile web add .
```

改完 host 半区（`src/index.ts`、`src/host/`）要重启 `dsh web`；改 client 半区刷新页面即可——两种都要先 `pnpm build`。

## 提交 PR 前

CI 会检查以下几条，本地跑一遍能省一轮：

```sh
pnpm build && pnpm typecheck && pnpm test && pnpm verify
```

- **`lib/` 必须与源码一起提交**。它是发布产物，但仓库里的安装来源不执行构建（见 README 的说明）。CI 会在 Linux 上重新构建并与提交比对，不一致就失败——所以本地改完源码后一定要 `pnpm build` 再提交。
- **新增或修改行为要带测试**。测试按模块组织：一个 src 模块一个 spec，新增逻辑归入对应域的现有 spec。
- **遵守项目的硬性规范**（见下）。

## 硬性规范

这些不是风格偏好，是项目已成型时定下的约束，改它们需要先讨论：

- **不引入新依赖**（运行时尤其）。需要时先在 Issue 里说明理由。
- **只使用官方 `@deepseek-ai/*` SDK**；不修改 DeepSeek Harness 源码；`tsconfig` 不得指向外部目录。
- **文档与代码、文案一律不用 emoji**。
- **命名不得偏离既有约定**（包名、插件 id、路由、存储单元名、localStorage 键）。这些标识与已装用户的数据绑定，改名会造成数据错位。
- **任何界面改动都要同时给出桌面与窄屏两档的处理**，且不能靠藏掉标签、藏掉控件或缩小字号来省空间。

## 关于 AGENTS.md

仓库根目录的 `AGENTS.md` 是项目的约定文档，也是 AI 助手在这个仓库里工作时的依据。改动项目行为（尤其架构、发布流程、硬性规范）时，请一并检查它是否需要同步——它描述的是「项目要求什么」，不是某个人的笔记，所以对任何接手者都成立。

## 提交信息

简短说明这次改了什么。中文或英文都可以，不用 emoji。一个逻辑变更一个提交，便于回退。

## 发布

发版由维护者执行：更新版本号 → 构建 → 提交 → 推 tag。推 tag 会触发 GitHub Actions 完成构建、测试与发布，不需要手动操作 npm。
