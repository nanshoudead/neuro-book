# @notnotype/nb-story

剧情图谱：把一部小说抽成按阅读位置可查的记忆图（人物、称呼与身份、谁知道什么、关系、数值与任务、悬念、时间线、情节、原文），用命令行 `nbstory`、本机网页查看器与内置问答来读它，并给 Claude Code、Codex 等外部 Agent 一份 Skill。所有查询都能只给到“读到哪里”为止的内容，不剧透。

行为合同见 [`story.cli`](../../docs/specs/story/cli-skill.md)、[`story.queries`](../../docs/specs/story/queries.md)、[`story.viewer`](../../docs/specs/story/viewer.md)、[`story.qa`](../../docs/specs/story/qa.md)、[`story.ingest`](../../docs/specs/story/ingest.md)。

## 安装

要先装 [Bun](https://bun.sh)（1.3.14 以上）。只支持 Linux 与 macOS。

```bash
bun add -g @notnotype/nb-story
nbstory --help
```

## 用起来

```bash
# 1. 配置问答模型（交互）：OMP 目录里的服务商，或自己的 OpenAI 兼容地址。配置文件默认在 ~/.config/nbstory/config.json
nbstory config init
nbstory config test

#    抽取只用 OpenAI Chat 接口。问答用的是这种自定义地址时直接沿用；用了目录里的模型时，另写一个抽取模型：
nbstory config set ingest.model '{"baseUrl": "https://api.example.com/v1", "id": "模型名", "apiKeyEnv": "EXAMPLE_API_KEY"}'
nbstory config test --ingest

# 2. 导入 TXT 原文并逐章抽取（调用模型；先加 --preview 看切章结果）
nbstory ingest 小说.txt --title 书名 --preview
nbstory ingest 小说.txt --title 书名
nbstory ingest --status

# 3. 查：按阅读位置（--at 章 或 章.段）
nbstory books
nbstory find 苏天晴 --at 38
nbstory knows --at 38

# 4. 网页查看器与问答页：打印登录链接，--open 用浏览器打开
nbstory serve --open

# 5. 内置问答
nbstory ask "苏天晴知道白灵的身份吗？" --at 38

# 6. 把 Skill 装给外部 Agent：缺省 Claude Code（~/.claude/skills），--agent codex 装进 ~/.agents/skills
nbstory skill install
```

- 书库默认在 `$XDG_DATA_HOME/nbstory`（没设时 `~/.local/share/nbstory`），换位置加 `--library <目录>`。
- 配置里只写存密钥的环境变量名，密钥本身不进配置、书库、日志与网页；模型可以选 OMP 目录里的服务商，也可以写自己的 OpenAI 兼容地址。
- 要结构化结果时所有命令都加 `--json`，标准输出只有一份 `{"ok": …}`。
- 全部命令与选项见 `nbstory --help` 与 `nbstory <命令> --help`。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。
