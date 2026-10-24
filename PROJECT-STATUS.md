# 仓库现状

截至 2026-10-03（分支 `refactor/w00017-runtime-foundation`）。本文只记录仓库级现状；具体 TODO 以 GitHub Issue 为准，实现过程与证据以对应 Work/Task 为准。旧应用时期的现状记录见 [`docs/archived/project-status-2026-08-17.md`](docs/archived/project-status-2026-08-17.md)。

## 当前方向

本分支按 [NeuroBook v2：并排重建应用](docs/proposals/neuro-book-v2-rebuild.md)（2026-10-03 `accepted`）从零重建应用，技术选型见 [ADR 0023](docs/adr/0023-v2-frontend-backend-stack.md)：去掉 Nuxt，前端 Vue + Vite，后端 Bun + Hono，校验统一 TypeBox。分支是长期分支，暂不合入 master；master 上的现有版本不受影响。

| 位置 | 状态 |
|---|---|
| `packages/neuro-book` | 新应用，当前只有包描述与目录约定；先建运行时底座与 workbench 底座，Files 竖切在这个壳子上验证 |
| `packages/nb-runtime` | 内核，自旧应用 `runtime/` 迁出（[t45](.agents/works/w00017-application-runtime-architecture/tasks/t45-nb-runtime-package/README.md)）；零运行时依赖，前后端宿主共用 |
| `packages/neuro-book-legacy` | 旧应用（Nuxt），只作代码与行为参照；含 w00017 阶段 1 的内核、三类宿主与内置插件实现（内核已复制到 `nb-runtime`，旧副本不再维护） |
| `docs/archived/` | 旧应用时期的 Spec、代码规范、人工评测与用户文档站 |
| 交付链 | Manager、桌面版、打包、发布、安装与部署脚本已在本分支删除；新应用的交付另行设计 |
| npm 包 | nb-story 与它依赖的 8 个工作区包以源码发布到 npm 的 `@notnotype` 下，只用 Bun（[ADR 0029](docs/adr/0029-workspace-packages-publish-source-to-npm.md)）；发布步骤见 [`repository-workflow.md`](docs/standards/repository-workflow.md#npm-包) |

## 推进顺序

当前 Work 为 [w00017](.agents/works/w00017-application-runtime-architecture/README.md)，推进顺序见其[整体实施路径](.agents/works/w00017-application-runtime-architecture/implementation-plan.md#2026-10-03-暂停改为并排新建应用)：

1. 仓库整理（[t43](.agents/works/w00017-application-runtime-architecture/tasks/t43-repository-reorganization/README.md)）；
2. 内核抽成 `nb-runtime` 包（[t45](.agents/works/w00017-application-runtime-architecture/tasks/t45-nb-runtime-package/README.md)）；
3. 应用骨架：后端宿主、`nbook.http`、`nbook.diagnostics`、开发监督进程、Vite 前端与浏览器宿主；
4. workbench 底座与 Lab 插件；
5. Files 竖切：资源层、文件资源管理器视图、编辑器打开与切换。

## 已知问题

- Storage 多窗口 `STORAGE_CONTEXT_INVALID`：[#246](https://github.com/notnotype/neuro-book/issues/246)，Storage 将重新设计；新应用在此之前不使用服务端 Storage。
- 仓库体积（2026-10-24 查）：`.git` 257 MB，打包后的历史 224 MB，其中图片约 135 MB。大头是官网插画 PNG（`docs/public` 与 `docs/archived` 各一份，约 50 MB）、nb-ui playground 壁纸（约 28 MB，已删，仍在历史里）与 w00017 的评审截图（当前 354 张、33 MB，早于“单张约 300 KB、每 Task 约 5 MB”的规则）；`docs/archived/vitepress` 的 4 张插画（约 30 MB）在 md、vue、ts、html 里没有找到引用。暂不改写历史（会让 Task 记录里的提交号失效）；要瘦身时再定是删当前副本还是用 filter-repo。
- `neuro-agent-harness` 已冻结，只服务 `llmlint`，待由 `nb-harness` 取代后退役。
