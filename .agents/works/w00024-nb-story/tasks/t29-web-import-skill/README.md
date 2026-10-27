---
schema: nbook.task/v2
taskId: t29-web-import-skill
status: done
updated: 2026-10-27
---

# 命令行功能的网页版：导入记忆图、删书、装 Skill

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 4 的第二条“大部分命令行功能都能在网页上用”，开发者 2026-10-27 批准按推荐做。行为合同：[`story.viewer`](../../../../docs/specs/story/viewer.md) 输出 54。

逐条核对命令行与网页（2026-10-27，对照 `cli/commands.ts` 与网页调用的服务方法）：书架（books）、概览与统计（info、stats、chapter）、人物与关系（find、card、knowledge、statements、appearances、ties、between、relations）、秘密（knows）、数值（ledger、track）、悬念、时间线、情节与主线（episodes、arcs）、原文（read、para）、问答（ask、qa）、抽取（ingest）、配置（config）网页里都有对应的页面；**缺口三个**：

1. `nbstory import`（导入 V9 记忆图文件）：已做，导入页第二块；
2. `nbstory remove`（删书）：已做，书架每本书的删除按钮（页面里原来写着“去终端里 remove”）；
3. `nbstory skill install`：已做，设置页一节，只认 Claude Code 与 Codex 两个固定位置，网页不收任意目录；
4. 还剩：`config test --ingest`（测抽取模型的连接）网页设置页只有“测试连接”测问答模型，没有测抽取模型；`serve`、`--json` 本来就不适用网页。第 4 项没做，记入后续。

权限模型（我的决定，记入待确认清单）：网页已经用一次性登录链接登录（本机服务，不对外），这三件事的权限等同于网页已有的“抽取、删对话、改配置”；Skill 安装写用户目录，所以只给两个固定位置、不收目录、内容不同时要用户点“换成随包的内容”才替换。

## 当前状态

2026-10-27 完成并合入 master，分支 `feat/w00024-t29-web-import-skill`。

- 服务：`INGEST_METHODS` 加 `book.importGraph`（base64、gzip 自动解、临时文件导入后删、书名缺省取文件里的）与 `skill.install`；`skill_*` 错误码进 HTTP 状态表；`server/tools.test.ts` 用真实 serve 进程测（家目录指到临时目录，不碰真实用户目录）。
- 网页：`shell/GraphImport.vue`、`shell/SkillInstall.vue`（各带同名 .md）、书架的删除按钮与确认窗口。
- 验证：nb-story 测试、e2e 新增 3 个（导入记忆图、删书、装 Skill）全过；Skill 的 e2e 用自己的书库与临时家目录，确认没有写进真实的 `~/.claude/skills`。
- 实现审查待做（与 t30 等一起）。
