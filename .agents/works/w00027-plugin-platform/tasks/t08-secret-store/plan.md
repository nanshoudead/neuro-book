# 实施计划：密钥存储（t08）

2026-10-20 起草。来源：t02 的密钥部分（方案 A 与 omp 设计审查的处理，见 [t02 计划](../t02-settings-completion/plan.md)“设计审查的处理”）按开发者同意的可维护性修订拆出：独立的服务与远程合同、只有一把主密钥、丢失时显式重置、访问密钥库的子进程脚本是单独的构建产物。

## Context

插件要存 API Key 一类的值：不能明文进 `settings.json`，浏览器不该读到值，服务端与项目实例要能读。t02 的声明 API 让配置项可以写 `secret: true`（只允许用户层、字符串、没有缺省值），普通层拒收这些键；值存在哪、谁能读写，由本 Task 提供。

依据：
- 开发者 2026-10-20 的决定：方案 A（加密存状态根，主密钥放系统密钥库，没有时退回状态根下只有本人可读的密钥文件），本轮就做；密钥做成独立的服务与合同，不加进 `SettingsService`；主密钥丢失时显式重置，不分代次；密钥库的子进程脚本做成单独的构建产物。
- 实测：[密钥库实测](../t02-settings-completion/evidences/keyring-spike.md)（`@napi-rs/keyring` 2.1.2 在 Bun 下能加载；本机会话没有 Secret Service，构造时约 2 ms 同步报错）。
- 设计审查：[t02 的 omp 设计审查](../t02-settings-completion/evidences/design-review-omp.txt) 第 1–4、6、10、11、17 条。
- 现有机制：`nbook/backend/locked-replace` 的 `holdLock`（跨进程锁，持有者提交前用 `stillHeld` 核对）与加锁替换；`server/start.ts` 按产物或源码找 `project.js` 的写法；`runtime/plugins.md` 的远程合同与原调用方身份。

前置：t02 S1（`secret` 声明与普通层拒收）。t02 S3 在本 Task 之后把密钥项接进设置窗口。

## 关键设计

### 归属与模块

拥有者仍是 `nbook.settings`（密钥项是它的配置声明的一部分），密钥是它的第二个服务：

- 服务键 `secretsKey`（`src/plugins/settings/shared/contracts.ts`），三个位置都提供；远程合同 `nbook.settings/secrets` 版本 1，服务端是唯一的真相源，项目实例与浏览器经远程门面。
- 服务端实现在 `src/plugins/settings/backend/secrets/`：`store.ts`（格式、加解密、锁）、`master-key.ts`（主密钥从哪来）、`keyring-client.ts`（起子进程、截止、结果归类）、`service.ts`（服务与远程提供项）。
- 子进程脚本 `src/server/keyring-helper.ts`，打包为 `dist/server/keyring-helper.js`（见“密钥库子进程”）。
- 配置服务与它的 `nbook.settings/user`、`nbook.settings/project` 合同不变。

### 存储格式：`<状态根>/secrets.json`

```json
{"schema": "nbook.secrets/v1",
 "key": {"store": "keyring", "locator": {"service": "NeuroBook", "account": "<随机 id>"}, "check": "<base64>"},
 "entries": {"<配置键>": {"iv": "<base64，12 字节>", "data": "<base64>", "tag": "<base64，16 字节>", "revision": 3}}}
```

- 文件密钥时 `key` 为 `{"store": "file", "locator": {"file": "secrets.key.<随机 id>"}, "check": …}`，文件在状态根下、权限 0600。
- AES-256-GCM（`node:crypto`），主密钥 32 字节随机；每条的 AAD 是 `nbook.secrets/v1` 加配置键，整条密文挪到别的键上解密失败。
- `check` 是主密钥对固定串的 HMAC-SHA256：拿到的主密钥对不上 `check` 时判为“无法解密”，不去逐条试。
- 密钥库账号是随机 id，记在 `locator` 里，不从状态根路径推出（挪动状态根不丢）。
- `revision` 每次写入加一，用于通知（替换一个已设置的密钥也通知）。
- 逐字段校验：未知 `schema`、结构坏了 → 整个存储“无法解密”（原因 `file-corrupt`），文件不动、不覆盖；单条认证失败 → 只这一条 `unreadable`，重新写这一条即可恢复。

### 存储的状态

| 状态 | 何时 | 读 | 写 |
|---|---|---|---|
| `empty` | 还没有 `secrets.json` | 都是 `unset` | 第一次写时产生主密钥 |
| `ready` | 主密钥拿到且对上 `check` | 按条解密 | 照常 |
| `unavailable` | 暂时拿不到主密钥：没有 Secret Service、锁着、子进程超时或失败 | 都是 `unreadable` | 拒绝，`secret-store-unavailable` |
| `unrecoverable` | 主密钥永久丢失或文件坏了：密钥库条目不存在、密钥文件不存在、对不上 `check`、`file-corrupt` | 都是 `unreadable` | 拒绝，`secret-store-unrecoverable` |

- `unavailable` 不缓存：下一次访问重新探测（同一时刻至多一个子进程在做，并发的访问等同一个结果）。主密钥拿到后留在内存，直到服务端停止。
- 两个不可用的状态都可以由用户**显式重置**：持锁，把旧文件改名为 `secrets.json.reset-<时间>`（不删，留作排查），按当时的条件产生新的主密钥（见下），写一个没有条目的新文件，所有密钥项变成 `unset`，记一条诊断。旧的密钥库条目与密钥文件不自动删除，诊断里列出位置。
- 主密钥一旦产生，存放位置（密钥库或文件）就记在文件里不再变：之后密钥库变得可用也不自动迁移。

### 主密钥从哪来

- 第一次写（或重置）时探测密钥库：子进程探测成功就存进密钥库；不成功就写 `secrets.key.<随机 id>`（0600），记一条警告诊断，写明密钥只靠文件权限保护。
- 顺序：先把主密钥存好（密钥库或文件），再写引用它的 `secrets.json`。中途崩溃留下的孤儿主密钥下次不复用（没有文件引用它）；孤儿密钥文件在启动时按诊断列出，密钥库里的孤儿条目列不出来（不枚举密钥库），只在“已知限制”里写明。

### 密钥库子进程

- 每次访问密钥库（探测、读、写、删）起一个短命的 Bun 子进程运行 `keyring-helper`，请求经 stdin 传一行 JSON（`{op: "probe" | "get" | "set" | "delete", service, account, secret?}`），结果经 stdout 回一行 JSON；密钥只走 stdin、stdout，不进命令行参数与环境变量。
- 截止 5 秒，过时 SIGKILL；子进程以非 0 退出、输出不是一行合格的 JSON、被杀 → `unavailable`。条目不存在 → `no-entry`（判为 `unrecoverable`）。原生调用放进子进程，是因为它在主线程里会阻塞事件循环，`AsyncEntry` 加超时也停不下正在做的调用（审查第 6 条）。
- Linux 显式用 Secret Service 后端（`{linux: {store: "secret-service"}}`），不退到不跨重启保存的 kernel keyutils（审查第 4 条）；锁定 `@napi-rs/keyring` 2.1.2。
- 构建：`build:server` 加第三个入口 `src/server/keyring-helper.ts` → `dist/server/keyring-helper.js`；运行时按 `server/start.ts` 找 `project.js` 的写法定位（产物里同目录，源码里 `src/server/keyring-helper.ts`）。`check:dist` 核对它在场并带产品标记；`smoke:server` 在产物上跑一次 `probe`，要求得到合格的一行结果（成功或 `unavailable` 都算），不能崩溃或挂起。
- **S1 第一步先验证打包**：`bun build` 能不能把原生模块（`.node`）带进产物、产物在仓库外的目录里能不能加载。不能时改为把 `@napi-rs/keyring` 标为 external，运行时从安装目录解析，并在 `check:dist` 里核对；两种结果都记进证据。

### 并发与崩溃

- 整个存储的读改写（产生主密钥、写条目、清除、重置）都在一把跨进程锁里（`secrets.json` 旁的锁，`holdLock`），持锁后先重读 `secrets.json` 再决定；写文件用加锁替换（先写临时文件再改名）。两个进程同时第一次写密钥只产生一把主密钥。
- 内存里的状态以文件为准：别的进程改了文件（同一状态根下的另一个服务端）由文件监视或下一次持锁重读发现；本 Task 只保证持锁的读改写正确，跨服务端的实时通知不做（同 `settings.json` 的现状）。

### 服务与远程合同

`secretsKey` 的服务（三个位置同一接口；值只在服务端与项目实例能读到）：

```ts
interface SecretsService {
    /** 同步、响应式。`unknown`：还没拿到快照或暂时连不上，不冒充 `unset`。 */
    status(setting: SecretSettingDefinition): "set" | "unset" | "unreadable" | "unknown";
    store(): {state: "empty" | "ready" | "unavailable" | "unrecoverable" | "unknown"; reason?: string};
    onDidChange(listener: (key: string) => void): Disposable;     // 状态或 revision 变化
    read(setting): Promise<{ok: true; value: string} | {ok: false; code: "unset" | "secret-unreadable" | "unavailable" | "denied" | "undeclared"}>;
    write(setting, value: string): Promise<SecretWriteResult>;     // 只写调用方自己声明的项
    clear(setting): Promise<SecretWriteResult>;
}
```

- 用户编辑（只给设置窗口，同配置的输出 19 的核对）：`editSecret(key, value)`、`unsetSecret(key)`、`reset()`。
- 远程合同 `nbook.settings/secrets` v1：快照 `{store: {state, reason?}, entries: {<键>: {state: "set" | "unreadable", revision}}}`（`unset` 的键不出现）；方法 `read`、`write`、`clear`、`editSecret`、`unsetSecret`、`reset`。
- **`read` 的调用方核对**：合同的 `callers` 只能整份合同一起写，浏览器还要订阅与写入，所以不收窄合同；拥有者按内核填写的原调用方身份核对 `location` 是服务端或项目实例，否则 `denied`；经代理时按原调用方核对（浏览器经项目实例代理也是 `denied`）（审查第 3 条）。
- 声明从配置的登记表取：未声明或不是密钥项的键为 `undeclared`；`write`、`clear` 只接受调用方插件自己声明的项。
- **不泄漏**：密钥库、子进程与加解密的错误只以固定的码与摘要出现在响应与诊断里，不带原始异常文字。

## Spec 与文档改动

- 新 Spec `docs/specs/settings/secrets.md`（`settings.secrets`，planned）：上面的格式、状态、重置、接口、合同、核对与失败码；注册表加一行。
- `settings/configuration.md` 输出 20 改为链接它（t02 S0 已改为链接，本 Task 补上目标）。
- `runtime/plugin-api.md`“激活上下文”下“配置与密钥不在 `ctx` 上”一句改为链接密钥服务。
- 应用的构建说明（`packages/neuro-book/AGENTS.md` 或构建脚本旁的说明）写上第三个产物。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 写 `settings/secrets.md` 与相关链接 | `docs:check` |
| S1 | 子进程脚本、打包验证、`check:dist` 与 `smoke:server` | 产物上的 `probe`；`check-dist.test.ts`；打包结论记证据 |
| S2 | 存储：格式、状态、主密钥、锁、重置 | 真实文件系统与真实进程的测试（见验收映射） |
| S3 | 服务、远程合同、调用方核对、不泄漏 | 合同测试经真实内核与远程门面 |

每片一个提交，在 Work 分支上；S3 之后交 omp 审查（后端），审查说明里要求逐条核对 t02 设计审查的密钥各条在新设计下是否仍被处理。

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 加解密与格式 | 写后读回；AAD 绑定键（把一条挪到别的键上读为 `unreadable`）；改坏一条只这一条 `unreadable`；`file-corrupt` 时文件不被覆盖 |
| 主密钥来源 | 本机没有 Secret Service：落到 0600 的密钥文件并有警告诊断；密钥文件被删 → `unrecoverable`；`check` 对不上 → `unrecoverable` |
| 子进程 | 用一个协议相同的测试脚本代替 `keyring-helper`（与真实脚本对过协议）：超时被 SIGKILL 并判 `unavailable`、输出坏了判 `unavailable`、`no-entry` 判 `unrecoverable`；`unavailable` 时不产生新主密钥 |
| 重置 | `unrecoverable` 下重置：旧文件改名保留、所有项变 `unset`、可以重新写；`unavailable` 下也能重置 |
| 并发与崩溃 | 两个真实进程同时第一次写不同的键：都能读回、只有一把主密钥；存好主密钥后、写 `secrets.json` 前杀掉进程，重启后再写正常、孤儿密钥文件出现在诊断里 |
| 调用方核对 | 浏览器直调、经项目代理、项目实例、服务端本地、门面释放后、未声明与非密钥的键 |
| 不泄漏 | 用一个唯一标记当密钥值，核对所有响应、快照、诊断与日志里都没有它 |
| 产物 | `check:dist` 有第三个产物；`smoke:server` 的 `probe` 得到合格结果 |

## 验证

- 每片自跑上表；完成后跑应用的 `bun test`、typecheck、`docs:check`、`governance:check`、`build` 与 `smoke:server`。
- 真实密钥库：本机会话没有 Secret Service，尝试在本机起一个 Secret Service 实现（例如 `gnome-keyring-daemon` 或 KWallet 的 Secret Service 接口）写一个密钥、重启服务端后读回；起不来时这一条记为未验证。
- 未验证边界：macOS、Windows 的密钥库；密钥库要求交互解锁时（子进程到截止被杀、读为 `unavailable`），只看诊断，不做专门界面。

## 不做与风险

- 不做：主密钥分代次；密钥库与密钥文件之间的自动迁移；跨服务端进程的实时通知；枚举并清理密钥库里的孤儿条目；设置窗口的界面（t02 S3）。
- 风险：
  - 密钥库在有桌面会话的机器上可能弹解锁框：子进程到截止被杀，读为 `unavailable`，用户解锁后再操作即可；不产生新主密钥，所以不会因为一次没解锁而丢掉已有的密钥。
  - 每次访问密钥库起一个子进程，一次约几十毫秒；主密钥拿到后留在内存，只在服务端启动后第一次用密钥时付这个代价。
  - 原生模块打包可能不成：S1 第一步先验证，不成时改 external（见“密钥库子进程”）。
  - 重置会让所有密钥要重新输入：只由用户在设置窗口里确认后触发，程序从不自动重置。
