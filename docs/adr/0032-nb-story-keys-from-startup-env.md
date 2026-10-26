---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-25
superseded-by: null
---

# ADR 0032：nb-story 的密钥只认进程启动时的环境

- 日期：2026-10-25
- 决策者：开发者（2026-10-25 确认按推荐方案；“不读任何 .env”改为下面的口径，原因见背景，记入待确认清单等追认）
- 关联工作：[w00024 t20](../../.agents/works/w00024-nb-story/tasks/t20-ingest-pipeline-fixes/README.md)

## 背景

2026-10-24 用 `nbstory ingest` 抽《西游记》时，同一份配置下 `config show` 与 `ask` 报密钥已设置，`ingest` 报“密钥环境变量没有设置”。查明有三层来源，各命令看到的不一样：

1. shell 导出的变量，所有命令都看得到。
2. Bun 在运行任何用户代码之前加载当前目录的 `.env`。所有命令都看得到，调整导入顺序挡不住（设计审查实测）。
3. OMP 一被导入，就把家目录、OMP 配置目录、agent 目录里的 `.env` 并进 `process.env`。`config`、`ask`、`serve` 导入了 OMP，看得到；`ingest` 与它的抽取线程不导入，看不到。

开发者最初定的是“nb-story 不读任何 `.env`”。第 2 层是 Bun 的行为，给 npm 的 bin 加 `--no-env-file` 在 Windows 的 shim 上不成立，所以这条做不到。

## 决策

1. 密钥只认进程**启动时**的环境：第 1、2 层算，第 3 层不算。`platform/startup-env.ts` 在 `cli/main.ts` 的第一条导入里拷一份快照，`config show`、`config test`、`ingest`、`ask`、`serve` 与网页配置页都按它判断“有没有值”。
2. 自定义服务商的模型，取值也只读快照。目录里的模型取值仍交给 OMP（它认的变量与优先级不止目录登记的）：只在快照里一个登记的变量都没有时拒绝。
3. 不改 nb-harness，不改 OMP。

## 后果

- 密钥只在家目录 `.env` 里的用户，现在 `ask` 也会和 `ingest` 一样报“没有设置”，要 `export` 变量，或写进当前目录的 `.env`（Bun 加载）。README 与错误信息里写明。
- 已知限制：目录模型在快照里有一个登记的变量、`.env` 里还有优先级更高的另一个（例如 `ANTHROPIC_OAUTH_TOKEN`）时，OMP 会选后者。要消除它得让 nb-harness 的目录模型也按快照取值，这次不做。
- 抽取线程的 `process.env` 本来就是启动环境（Bun 的 Worker 不继承主线程运行中被 OMP 改过的变量，设计审查实测 Bun 1.4.2），所以抽取不用改取值，只在缺密钥时的错误信息里写出变量名与这条口径。
