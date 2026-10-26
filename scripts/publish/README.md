# 工作空间正文发布

把每个工作空间 `manuscript/` 下的正文按工作空间名同步到一个独立的 Git 仓库。发布物只读：
脚本从工作空间读文件，写进受管理的缓存 clone，再提交、推送；不修改作品目录。

## 前置

- 本机有 `git`。
- 目标仓库可以不存在提交（空仓库也行），但仓库本身要在 GitHub 上先建好；脚本不调用 API 建仓库。
- 推送凭据用 GitHub PAT，对目标仓库有 `contents: write` 权限。

## 用法

```bash
NB_PUBLISH_REPO=https://github.com/<you>/<novels>.git \
NB_PUBLISH_TOKEN=<pat> \
bun run publish:workspaces
```

先看会发什么，不碰 Git 仓库：

```bash
bun scripts/publish/workspaces.ts --dry-run
```

### 选项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `--repo <url>` | 环境变量 `NB_PUBLISH_REPO` | 目标仓库地址 |
| `--branch <name>` | `main`（或 `NB_PUBLISH_BRANCH`） | 目标分支 |
| `--workspaces <dir>` | `packages/neuro-book-legacy/data/workspace` | 工作空间根目录 |
| `--cache <dir>` | `.local/publish/workspaces` | 受管理的本地 clone |
| `--dry-run` | 关 | 只按真实路径解析并输出清单，跳过全部 Git 副作用 |
| `--help` | 关 | 打印用法 |

### 环境变量

| 变量 | 用途 |
|---|---|
| `NB_PUBLISH_REPO` | 目标仓库地址 |
| `NB_PUBLISH_TOKEN` | PAT；只通过 `GIT_CONFIG_*` 注入 HTTP 头，不写进 argv |
| `NB_PUBLISH_BRANCH` | 目标分支 |

## 目标仓库布局

```text
<工作空间名>/
  manuscript/
    001-volume/001-chapter/index.md
```

工作空间名就是 `data/workspace/` 下的目录名；`reference/`、`lorebook/`、`upload/`、
`agents/`、`world-engine/`、`.nbook/`、`.agent/` 都不会进目标仓库。`manuscript/` 里只收
`.md`，`manuscript/_backup/` 作为编辑备份跳过。

## 同步语义

- 缓存 clone 归脚本所有：每次先对齐远端分支（含空仓库的首次提交），再清空工作区重写。
  因此源里删掉的章节也会在目标仓库删掉，目标仓库是正文的镜像，不是增量追加。
- 没有变化时不产生提交，也不推送。
- 提交身份固定为 `NeuroBook <neurobook@users.noreply.github.com>`。
- 发布前后都能从输出的 JSON 报告判断边界：`files` 是这次写进去的正文数，`commit` 是新提交
  哈希，`changed` 为 `false` 表示无变化。

## 安全边界

- `--cache` 不能是仓库根目录或它的祖先，否则拒绝执行，避免清空工作区时删到源码。
- 目标仓库里的其它内容会被清掉：它是正文镜像仓库，不要往里放别的东西。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功，或无变化 |
| 2 | 参数错误（含真实发布缺 `--repo`） |
| 3 | Git 操作失败（clone、fetch、commit、push） |
| 4 | 没有工作空间，或工作空间里没有正文 |

## 输出

stdout 是稳定的 JSON 报告，`schema` 为 `nbook.publish-workspaces/v1`；进度与错误走 stderr。

## 测试

```bash
bunx vitest run --config scripts/vitest.config.ts publish
```
