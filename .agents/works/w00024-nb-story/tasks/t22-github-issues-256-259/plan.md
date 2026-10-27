# t22 计划：GitHub issue 256 到 259

## Context

四个 bug 来自开发者的 Agent 在 Windows 上用 nb-story 0.1.1 的实测。已确认：#258 默认输出上限取 OMP 的做法；#256 不读 omp 的配置文件（nb-story 与 omp 独立）。示例里的服务商与域名一律用中性占位。

## 技术选型

无新依赖。命令行解析继续用 commander（`src/cli/program.ts`）。

## 关键设计

### #258：输出上限（`src/qa/harness-model.ts`、`src/qa/config.ts`、设置页）

OMP 的做法（读自 pi-coding-agent / pi-catalog / pi-ai 的源码，不依赖任何用户配置）：目录里有的模型用目录值；自定义模型没写时取同名目录模型的值，再没有取 16384（`custom-models.ts`）；发现的 OpenAI 兼容模型取 `min(上下文窗口, 32768)`；总输出封顶 64000（`OPENAI_MAX_OUTPUT_TOKENS`）。

`modelOf` 对自定义服务商的模型：`model.maxTokens ?? suggested?.maxTokens ?? 32768`，不再是 `null`。64000 的封顶只在发 OpenAI 系请求（`api` 为 `openai-*`）时由 `modelOf` 夹，**不进 `ConfigSchema` 的校验**：磁盘格式仍是正整数，已有的更大值照常读写（设计审查第 1 条：共享 schema 加上限会让旧配置整个读不进来，还会误伤 Anthropic、Google 的自定义模型）。取 32768 而不是 OMP 配置文件那档 16384：网关把隐藏思考算进预算时，长回答在 16384 下仍易被截断。

**流结束的完整性（设计审查第 2 条，改为要做）**：预算只解决“被默认预算截断”，不解决“网关送了 `[DONE]` 却没送 `finish_reason`、半句话被记成正常结束”。pi-ai 公开了 `onSseEvent`。在 `nb-harness`（`harness.ts` 里 `baseStream` 的包装、`complete.ts`）给每次请求挂观察：见到 chat-completions 形状的块（带 `choices`）而一直没见到非空的 `finish_reason`，这次请求记 `finishMissing`；这一轮最后一条助手消息的 `stopReason` 是 `stop` 且 `finishMissing` 时，`TurnResult`/`CompleteResult` 的 `stopReason` 报 `length`（nb-story 侧记录因此是 `truncated: true`，界面已有“输出到上限，回复被截断”的提示；探针 `probeModel` 对 `length` 报 `not_finished`）。其他 API（Anthropic、Responses）没有 `choices` 块，不受影响。要守住：这是对网关的兼容判断，不改变带了 `finish_reason` 的正常结束；工具调用那一类（`toolUse`）不改。

### #257：推理档降档（`src/ingest/model.ts`）

请求被拒 400，且错误正文列出 “Supported values are: …” 时，把请求的档位夹到列出的合法档位后立即重发一次，不进延迟表。**夹法照 OMP（`pi-ai/src/providers/openai-reasoning-fallback.ts`，`@internal` 未导出，所以手写一份同规则的小函数并在注释里写明来源）**：只在“启用推理”的档位 minimal < low < medium < high < xhigh < max 里选，`none`（关闭推理）永远不选（设计审查第 3 条：把 minimal 夹成 none 会让原来要求推理的步骤静默变成不推理）；`minimal` 优先 `low`，`xhigh` 优先 `max` 再 `high`，`max` 优先 `xhigh`，其余取距离最近、平局取更高的档。列表里没有任何启用档（只剩 none）或正文列不出档位时，按原样失败，错误说明里带上网关列出的档位。夹后的档位记在进程内的 `Map<baseUrl|model, 请求档→实际档>`，同一进程里之后的请求直接用，不再先吃一个 400（Worker 是独立进程，各自吃一次，可以接受）。该 400 没有被受理，用量按已拒绝记为完整的 0（只对“档位不支持”这一情形，不扩到所有 400）。`config test --ingest` 同样走这条路径，所以测试能通过并提示实际用了哪一档。不加 `effort.*` 配置项，默认行为不变。

### #256：目录外服务商的报错（`src/cli/config.ts`）

`--model x/y` 的服务商 x 不在内置目录、又没给 `--base-url`、`--api-key-env` 时，报错改为说明“内置目录里没有服务商 x；nbstory 只认内置目录，不读 omp 的配置。自己的服务商写成 --base-url <地址> --model <模型名> --api-key-env <变量名>”，不再只说“自定义地址缺少…”。README 与 `config init` 帮助写明这一点。网页设置页的模型选择同样标明只含内置目录与自定义服务商（若已有文案则不动）。

### #259：命令行（`src/cli/program.ts`、`commands.ts`、`config.ts`）

1. `nbstory --version` 与 `-V`：输出包版本号（读 `package.json`），退出码 0；`--json` 时输出 `{"version": "…"}`。
2. `nbstory config <动作> --help` 输出该动作自己的用法与只对它有效的选项（init：`--model --base-url --api-key-env --thinking --force`；set：`<路径> <值>` 与 `--base-url --model --api-key-env`；test：`--ingest`；show、path 等无专属选项）。`config --help` 保留总览。
3. `config set ingest.model` 在不给值时接受 `--base-url`、`--model`、`--api-key-env`（缺的字段沿用已有 `ingest.model` 对应字段；没有已有值时三项必须齐），也可接 `--max-tokens` 等已有字段不在本次范围。JSON 整段写法保持不变。
4. `ingest --preview` 提示“像正文但被当成标题”：不做（需要启发式判断，#252 已修根因，#259 自己也只说“建议按 2、3 优先”）。

## Spec 与文档

`cli-skill.md`：`--version`、动作级帮助、`config set ingest.model` 三段式、目录外服务商的报错（输出条目追加）。`qa.md`：自定义模型输出上限默认与封顶。`ingest.md`：推理档降档重发与失败说明。README：只认内置目录、`--version`。

## 切片

1. #259（版本、动作帮助、三段式 `config set`）+ #256 报错；测试走真命令行进程（沿用 `cli.test.ts`、`config.test.ts` 的写法）。
2. #258 输出上限与流结束完整性；测试：自定义模型不写 `maxTokens` 时请求带 `max_completion_tokens: 32768`，写了就用写的，OpenAI 系超过 64000 夹到 64000，已有 100000 的配置照常读出；本机端点回 `[DONE]` 却没有 `finish_reason` 时记 `truncated`，带 `finish_reason` 的正常结束不变，无 `choices` 的 API 不受影响。
3. #257 降档；测试用本机端点（`testing/openai-endpoint.ts`）按请求的档位回 400 与合法档位列表。

## 验收映射

按各 Spec 新增的输出条目编号对应上面三个切片的测试；`bun run test` 在包内全绿，`docs:check` 无失败。

## 验证

不调用真实模型（降档逻辑用本机端点验证）；真实网关上的行为由开发者在 Windows 上复核 #257、#258。

## 不做与风险

- 不读 omp 配置（开发者定）；不加 `effort.*` 配置项；不做 `--preview` 的疑似标题提示。
- 风险：32768 在个别网关上超过其真实上限会得 400——错误说明里要提示“在 config 里把该模型的 maxTokens 调小”。
