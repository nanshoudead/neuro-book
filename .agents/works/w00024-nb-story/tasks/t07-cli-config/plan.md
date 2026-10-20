# t07 计划：命令行换 commander，加 nbstory config

## Context

- 现状：`packages/nb-story/src/cli/main.ts` 的 `parse()` 手写解析，`commands.ts` 是命令表（每个位置参数、选项带解码器）。问答配置只能手编 `~/.config/nbstory/config.json`（`src/qa/config.ts` 只读不写）。
- 起因：开发者 2026-10-16 问为什么不用 commander、配置为什么要手编，并定了做法（见 [README](README.md) 的决定）。
- 依据：[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)、[`story/qa.md`](../../../../../docs/specs/story/qa.md) 的“配置”。
- 约束：现有行为合同不变——命令名、参数名、`--json` 形状、退出码（0、1、2、3、4、130）、用法错误时输出含“用法：nbstory”。现有 `cli.test.ts`、`ask.test.ts` 是换解析器的安全网，不改断言。

## 技术选型

开发者 2026-10-16 指出：开始实施前要先做技术选型，有稳定的第三方库就用，不像最初的 nbstory 那样手写命令行解析。本节在实施中补写，记录这次的选型。

| 通用问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 命令行切词、子命令、按命令帮助 | `commander` ^14 | 仓库根已依赖、llmlint 在用；只取切词和分派，值的解码、中文错误与退出码仍由命令表负责，现有合同不变 | `yargs`、`citty`（仓库里没有，要新增依赖）；继续手写（正是要改掉的） |
| 交互式提问（`config init`） | `@clack/prompts` | 仓库根已声明；Nuxt、Vite 命令行同款；`input`、`output` 可注入，测试能用真实库喂按键 | `inquirer`、`prompts`（仓库里没有，要新增依赖） |
| 配置校验 | 现有 TypeBox `ConfigSchema` | 读与写用同一份 schema，不另引校验库 | `zod`（会出现两份 schema） |
| 原子写文件 | 手写临时文件加 `rename` | 只有几行，同目录 rename 在 POSIX 上原子；`write-file-atomic` 多一个依赖而收益只有这几行 | `write-file-atomic` |
| `config test` 发请求 | nb-harness 的 `createHarness` | `complete()` 不带推理档；问答引擎本来就经 nb-harness 发请求，测的才是同一条路径 | 直接 `fetch`（测不到真正的请求组装） |

## 关键设计

### packages/nb-story/src/cli/main.ts、commands.ts（commander）

- `commands.ts` 的 `COMMANDS` 仍是唯一来源。新增 `buildProgram(io)`：按命令表生成 commander 的 `Command`——每条命令 `.command(name)`、`.summary()`，位置参数 `.argument("<名>")` 或 `[名]`，选项 `.option("--x <值>")`，开关（`json`、`help`、`open`）不带值。commander 只负责切词和按命令的帮助；位置参数与选项的“文字 → 值”仍走 `decodeArguments`，解码器不动。
- 不让 commander 退出进程：`exitOverride()` 加 `configureOutput({writeOut, writeErr})` 指向 `CliIo`；commander 的错误（未知命令、未知选项、缺参数）统一转成 `UsageError`，退出码 2，输出里带“用法：nbstory”。`--help` 退出码 0；不给命令仍是用法加退出码 2。
- `ask`、`serve`、`qa` 的懒加载分派不变；`config` 同样动态导入。
- 新增依赖：`commander`（版本同根 `^14.0.2`）。保留 `FLAGS` 的含义，由命令表声明哪些选项是开关。

### packages/nb-story/src/qa/config.ts（读写同一份 schema）

- 复用 `ConfigSchema`，新增：
  - `saveQaConfig(path, config)`：先按 schema 校验，写临时文件再 rename（原子替换）；目录不存在时创建。
  - `setConfigField(config, field, text)` 与 `unsetConfigField`：`field` 是点路径，限定为 schema 里的叶子字段（`model.baseUrl`、`model.id`、`model.apiKeyEnv`、`model.contextWindow`、`model.maxTokens`、`model.thinking`、`model.price.input|output|cacheRead|currency`、`qa.maxChapters`、`qa.fullReadMaxChars`）；文字按字段类型解码（整数、数字、枚举），改完整份重新校验，不合格不写盘。`unset` 只允许可选字段；`model.price` 的叶子要么整组都在要么整组没有，由 schema 校验把关。
  - `describeConfig(config, env)`：给 `show` 用，返回各字段与 `apiKeyEnv` 对应环境变量的状态（已设置/未设置），不含密钥值。
- 密钥永远只写环境变量名，任何命令不接收、不打印、不写入密钥值。

### packages/nb-story/src/cli/config.ts（新，动态导入）

| 命令 | 行为 |
|---|---|
| `nbstory config show [--config <文件>] [--json]` | 显示配置文件路径与各字段、环境变量是否已设置；文件不存在退出码 1（`qa_unconfigured`），下一步写“用 nbstory config init” |
| `nbstory config init [--config] [--base-url] [--model] [--api-key-env] [--thinking] [--force]` | 三个必填项都在选项里给齐就直接写；缺的在终端里交互问（`@clack/prompts`），已有配置的值作默认；文件已存在时交互确认覆盖，非交互需 `--force`；非终端又缺必填项：用法错误，退出码 2，不挂起；交互中取消：退出码 130，不写盘 |
| `nbstory config set <字段> <值>` | 改一个字段，校验后原子写；配置文件不存在时退出码 1 |
| `nbstory config unset <字段>` | 去掉一个可选字段（例如 `model.thinking`、`model.price`） |
| `nbstory config test [--config]` | 读配置，经 nb-harness 发一个最小请求（不带工具的 profile；`complete()` 不带推理档，实施中改用 `createHarness`）；成功输出模型名、推理档、耗时、用量；失败按 `ask` 的错误归类（`auth`、`network`、`provider` 等）退出码 4 |

- 所有 `config` 子命令都接受 `--config <文件>`（默认位置同 `ask`）与 `--json`。
- `init` 的交互用 `@clack/prompts`，只在交互路径里动态导入；可注入 `input`/`output` 流（clack 本身支持），测试用真实库喂按键，不替身。
- `test` 的价值：确认地址、模型名、密钥环境变量、推理档能用。一个小请求不能证明服务端真的按推理档算，所以 `test` 只报告“配置写的推理档”，不声称已验证；“推理档确实发到了请求里”由测试里的本机端点验证（`testing/openai-endpoint.ts` 的 `bodies`）。
- `ask` 的 `qa_unconfigured` 失败加下一步：“用 nbstory config init”。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/story/cli-skill.md` | 命令列表加 `config` 五个子命令；退出码段落说明 `config` 的退出码；边界一节把“除 `ask` 外不读密钥、不发网络请求”改为“除 `ask`、`config test` 外”；`--help` 的输出行为 |
| `docs/specs/story/qa.md` | “配置”一节：配置文件由 `nbstory config` 维护，仍可手编；新增输出条目（接在输出 17 之后）：config 命令的写入规则（校验后原子写、密钥不落地）、`test` 的行为；新增验收场景；F1 的“调用方怎么办”改为“用 nbstory config init” |
| `packages/nb-story/skill`（若有 `ask` 配置说明） | 同步一行 |
| `packages/nb-story/README` 或模块头注释 | 命令行用 commander，命令表是唯一来源 |

## 切片

1. **S1 commander**：`buildProgram`、`UsageError` 转换、按命令帮助、依赖。验证：`bun test` 里 `cli.test.ts`、`ask.test.ts` 不改断言通过；新增按命令 `--help` 的用例。
2. **S2 配置读写**：`saveQaConfig`、`setConfigField`、`unsetConfigField`、`describeConfig` 与单元测试（校验失败不写盘、原子替换、密钥值不出现）。
3. **S3 config 命令（非交互）**：`show`、`set`、`unset`、`init` 带齐选项、`test`。用本机端点测 `test`，并断言请求带推理档。
4. **S4 init 交互**：`@clack/prompts`，真实库加注入流的测试：喂按键写出配置、取消不写盘、非终端缺项退出码 2。
5. **S5 Spec 与文档**：见上表，`bun run docs:check`。

每片自跑 `bun test`（nb-story）、`tsc --noEmit`；提交边界按片。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 命令、参数、`--json`、退出码不变 | 现有 `cli.test.ts` 全部通过且不改断言 |
| 按命令 `--help` 退出码 0 | S1 新增用例 |
| 未知命令、选项、缺参数退出码 2 且含“用法：nbstory” | 现有用法错误用例 |
| config 写入校验失败不写盘、原子替换、无密钥值 | S2 测试 |
| `init` 非终端缺项退出码 2；取消退出码 130 不写盘 | S4 测试 |
| `test` 成功/失败的输出与退出码；推理档进请求 | S3 测试（本机端点） |
| Spec 新增条目编号 | S5，写入 qa.md 输出 18 起，具体编号写 Spec 时定 |

## 验证

- `bun test`（nb-story）、`tsc --noEmit` 全套、`bun run docs:check`。
- 手动 smoke：在临时 `XDG_CONFIG_HOME` 下跑一遍 `config init`（真实终端）、`show`、`set`、`unset`、`test`（指向本机端点）；`test` 对真实 luna 渠道跑一次，确认端到端可用（密钥来自环境变量，不打印）。
- 留下的未验证边界：交互在各终端（Windows 终端、非 UTF-8 locale）的显示；`test` 不能证明服务端按推理档算。

## 不做与风险

- 不做：配置里存密钥值；多模型配置与按名切换；`config` 的网页设置页（随网页问答页做）；彩色输出。
- 风险：commander 对选项值以 `-` 开头、重复选项、`--x=y` 的处理与手写版有差异——靠现有用例和 S1 新增的边界用例兜住，发现差异按现有行为对齐，不改合同。
- `@clack/prompts` 仓库里目前只是根依赖声明（旧应用时期），nb-story 自己声明依赖，不依赖根的提升。
