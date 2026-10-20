# 凭据存储的做法调研（2026-10-20，Sonnet 子代理）

本机只看结构（键名、表结构、权限），没有读任何密钥的值；文档与源码出处见各条。

| 工具 | 存在哪 | 加密 | 系统密钥库 | 键怎么组织 |
|---|---|---|---|---|
| omp | `~/.omp/agent/agent.db` 表 `auth_credentials`（0600，目录 0700）；列 `id, provider, credential_type, data, disabled_cause, identity_key, …` | 无，`data` 是明文 JSON | 不用（源码里没有 keyring 相关代码） | 按服务商 id 动态增加，一家可以多个账号（`identity_key` 去重）；API Key 与 OAuth 同表。服务商的地址与模型在 `models.yml`，按 id 关联；`apiKey` 也可以写环境变量名或命令 |
| VS Code `SecretStorage` | 应用内部数据库，加密 | 有（Electron safeStorage） | 用；Linux 上没有时退到 `basic`（固定密钥，相当于混淆） | 按扩展隔离的任意字符串键；接口 `get`、`store`、`delete`、`keys`、`onDidChange` |
| Codex CLI | `~/.codex/auth.json`（0600） | 无 | 默认不用（有可选的 keyring 模式，未核实） | 固定槽位；自定义服务商只写环境变量名 |
| Claude Code | Linux 上 `~/.claude/.credentials.json`（0600） | 无（macOS 用 Keychain） | Linux 不用 | 固定槽位 |
| opencode | `~/.local/share/opencode/auth.json`（文档） | 无 | 不用 | 按服务商 id 动态增加，服务商配置在 `opencode.json`，按 id 关联 |

结论：
- 命令行 Agent 工具在 Linux 上普遍是 0600 明文文件；只有 VS Code 这类 Electron 宿主默认加密并用系统密钥库。
- 两种键模型能统一：底层是按插件隔离的任意键键值库（同 VS Code），声明式的密钥配置项只是它上面一层，把设置键对应到固定的密钥键，用来出界面与校验；动态服务商由插件自己拼键（例如 `provider/<id>/apiKey`），普通设置按 id 关联。
- 以后要做时的建议：先做 0600 文件后端加可替换的后端接口，系统密钥库与加密以后再接；可以学 omp 允许写环境变量名或命令，不必把 key 存进应用。
