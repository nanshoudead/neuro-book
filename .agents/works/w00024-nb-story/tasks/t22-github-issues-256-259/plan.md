# t22 计划：GitHub issue 256 到 259

## Context

四个 bug 来自开发者的 Agent 在 Windows 上用 nb-story 0.1.1 的实测。已确认：#258 默认输出上限取 OMP 的做法；#256 不读 omp 的配置文件（nb-story 与 omp 独立）。示例里的服务商与域名一律用中性占位。

## 技术选型

无新依赖。命令行解析继续用 commander（`src/cli/program.ts`）。

## 关键设计

### #258：输出上限（`src/qa/harness-model.ts`、`src/qa/config.ts`、设置页）

OMP 的做法（读自 pi-coding-agent / pi-catalog / pi-ai 的源码，不依赖任何用户配置）：目录里有的模型用目录值；自定义模型没写时取同名目录模型的值，再没有取 16384（`custom-models.ts`）；发现的 OpenAI 兼容模型取 `min(上下文窗口, 32768)`；总输出封顶 64000（`OPENAI_MAX_OUTPUT_TOKENS`）。

`modelOf` 对自定义服务商的模型：`model.maxTokens ?? suggested?.maxTokens ?? 32768`，并且不超过 64000，不再是 `null`。`config` 里写了 `maxTokens` 照用（校验上限 64000 以内；已有配置里更大的值不改，只在发请求时夹到 64000）。取 32768 而不是 OMP 配置文件那档 16384：网关把隐藏思考算进预算时，长回答在 16384 下仍易被截断。

不做 #258 的第 3 条（流结束没有 finish_reason 就标截断）：pi-ai 已在“没有 finish_reason 也没有 `[DONE]`”时报 incomplete-stream；#258 里网关送了 `[DONE]` 却没送 finish_reason，nb-story 经 harness 拿不到这个区别，改它要动 OMP 库。真正的原因是没发上限，由上面一条解决。抽取一侧（`ingest/model.ts`）早已把“没有结束原因”按渠道失败重发，不变。

### #257：推理档降档（`src/ingest/model.ts`）

请求被拒 400，且错误正文列出 “Supported values are: …” 时，把请求的档位夹到列出的最近合法档位（顺序 none < minimal < low < medium < high < xhigh < max；向低夹，没有更低的向高夹）后立即重发一次，不进延迟表；夹后的档位记在进程内的 `Map<baseUrl|model, 请求档→实际档>`，同一进程里之后的请求直接用，不再先吃一个 400。夹不出（正文没列档位、列表里没有任何认识的档位）按原样失败，错误说明里带上网关列出的档位（#257 的第 3 条）。该 400 没有被受理，用量按已拒绝记为完整的 0（把 400 且是“档位不支持”的情形加入 `REJECTED_UNPROCESSED` 的判定，不扩到所有 400）。`config test --ingest` 同样走这条路径，所以测试能通过并提示实际用了哪一档。不加 `effort.*` 配置项（#257 的第 2 条），默认行为不变，先不扩配置面。

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
2. #258 输出上限；测试：自定义模型不写 `maxTokens` 时请求带 `max_completion_tokens: 32768`，写了就用写的，超过 64000 夹到 64000。
3. #257 降档；测试用本机端点（`testing/openai-endpoint.ts`）按请求的档位回 400 与合法档位列表。

## 验收映射

按各 Spec 新增的输出条目编号对应上面三个切片的测试；`bun run test` 在包内全绿，`docs:check` 无失败。

## 验证

不调用真实模型（降档逻辑用本机端点验证）；真实网关上的行为由开发者在 Windows 上复核 #257、#258。

## 不做与风险

- 不读 omp 配置（开发者定）；不做 #258 第 3 条（理由见上）；不加 `effort.*` 配置项；不做 `--preview` 的疑似标题提示。
- 风险：32768 在个别网关上超过其真实上限会得 400——错误说明里要提示“在 config 里把该模型的 maxTokens 调小”。
