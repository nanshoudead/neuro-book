# 实施计划：密钥存储（t08）

> 2026-10-20 已搁置：开发者决定暂时不做凭据加密，API Key 用明文的普通配置项。本计划只作重开时的参考，见 [README](README.md)“下一步”。

2026-10-20 起草。来源：t02 的密钥部分（方案 A 与 omp 设计审查的处理，见 [t02 计划](../t02-settings-completion/plan.md)“设计审查的处理”）按开发者同意的可维护性修订拆出：独立的服务与远程合同、只有一把主密钥、丢失时显式重置、访问密钥库的子进程脚本是单独的构建产物。同日按设计审查（[evidences/design-review-omp.txt](evidences/design-review-omp.txt)，15 条）修订，处理见文末。

## Context

插件要存 API Key 一类的值：不能明文进 `settings.json`，浏览器不该读到值，服务端与项目实例要能读。t02 的声明 API 让配置项可以写 `secret: true`（只允许用户层、字符串、没有缺省值），普通层拒收这些键；值存在哪、谁能读写，由本 Task 提供。

依据：
- 开发者 2026-10-20 的决定：方案 A（加密存状态根，主密钥放系统密钥库，没有时退回状态根下只有本人可读的密钥文件），本轮就做；密钥做成独立的服务与合同，不加进 `SettingsService`；主密钥丢失时显式重置，不分代次；密钥库的子进程脚本做成单独的构建产物。
- 实测：[密钥库实测](../t02-settings-completion/evidences/keyring-spike.md)（`@napi-rs/keyring` 2.1.2 在 Bun 下能加载；本机会话没有 Secret Service，构造时约 2 ms 同步报错）。
- 设计审查：[t02 的 omp 设计审查](../t02-settings-completion/evidences/design-review-omp.txt) 第 1–4、6、10、11、17 条；本 Task 的设计审查 15 条。
- 现有机制：`nbook/backend/locked-replace`（`holdLock` 与加锁替换）；`server/start.ts` 按产物或源码找 `project.js` 的写法；`runtime/plugins.md` 的远程合同与原调用方身份；配置的快照排序（`{boot, seq}` 与 `supersedes`，`settings/shared/layers.ts`）。

前置：t02 S1（`secret` 声明与普通层拒收）。t02 S3 在本 Task 之后把密钥项接进设置窗口。

## 关键设计

### 归属与模块

拥有者仍是 `nbook.settings`（密钥项是它的配置声明的一部分），密钥是它的第二个服务，从内核已接受的 `settings.properties` 声明直接建登记表，不经 `SettingsService`：

- 服务键 `secretsKey`（`src/plugins/settings/shared/contracts.ts`），三个位置都提供；远程合同 `nbook.settings/secrets` 版本 1，服务端是唯一的真相源，项目实例与浏览器经远程门面。
- 服务端实现在 `src/plugins/settings/backend/secrets/`，各层只做自己的事，不重复包装同一种错误：
  - `store.ts`：格式、加解密、持锁读改写与提交；
  - `master-key.ts`：取得与选择主密钥，缓存绑定当前的 `key` 描述；
  - `keyring-client.ts`：有界的子进程协议（一次任务拥有子进程、管道、截止与退出）；
  - `service.ts`：声明核对、写入校验、快照与远程提供项。
- 子进程脚本 `src/server/keyring-helper.ts`，打包为单独的产物（见“密钥库子进程”）。
- 配置服务与它的 `nbook.settings/user`、`nbook.settings/project` 合同不变。

### 存储格式：`<状态根>/secrets.json`

```json
{"schema": "nbook.secrets/v1",
 "key": {"store": "keyring", "locator": {"service": "NeuroBook", "account": "<随机 id>"}, "check": "<base64>"},
 "entries": {"<配置键>": {"iv": "<base64，12 字节>", "data": "<base64>", "tag": "<base64，16 字节>"}}}
```

- 文件密钥时 `key` 为 `{"store": "file", "locator": {"file": "secrets.key.<随机 id>"}, "check": …}`，文件在状态根下、权限 0600。
- AES-256-GCM（`node:crypto`），主密钥 32 字节随机；每条的 AAD 是 `nbook.secrets/v1` 加配置键，整条密文挪到别的键上解密失败。
- `check` 是主密钥对固定串的 HMAC-SHA256：拿到的主密钥对不上 `check` 时判为“无法解密”，不去逐条试。
- 密钥库账号是随机 id，记在 `locator` 里，不从状态根路径推出（挪动状态根不丢）。
- 逐字段校验：未知 `schema`、结构坏了 → 整个存储“无法解密”（原因 `file-corrupt`），文件不动、不覆盖；单条认证失败 → 只这一条 `unreadable`，重新写这一条即可恢复。

### 存储的状态

| 状态 | 何时 | 读 | 写 |
|---|---|---|---|
| `empty` | 还没有 `secrets.json` | 都是 `unset` | 第一次写时产生主密钥 |
| `ready` | 主密钥拿到且对上 `check` | 按条解密 | 照常 |
| `unavailable` | 暂时拿不到主密钥：没有 Secret Service、锁着、子进程超时或失败 | 都是 `unreadable` | 拒绝，`secret-store-unavailable` |
| `unrecoverable` | 主密钥永久丢失或文件坏了：密钥库条目不存在、密钥文件不存在、对不上 `check`、`file-corrupt` | 都是 `unreadable` | 拒绝，`secret-store-unrecoverable` |

- 普通的读写从不产生新的主密钥；只有 `empty` 下的第一次写与用户的显式重置会产生。
- **主密钥缓存**：取得的主密钥连同它对应的 `key` 描述（`store`、`locator`、`check`）留在内存。每次持锁重读 `secrets.json` 后先比较描述：变了（另一个服务端重置过）就丢掉缓存，按新描述重新取得并核对 `check` 之后才读写；没变就继续用缓存，之后密钥库锁上或条目被删都不影响这个进程（已经拿到的能力不收回），下次重启时才会发现。
- **重新检查**：`unavailable` 不缓存失败，但读状态从不自己发起 I/O。重新取得主密钥只在三种时候发生：一次实际的读或写；用户在设置窗口点“重新检查”（服务的 `recheck()`）；服务端启动后第一次用到密钥。同一个 `key` 描述的取得同时只有一次在途，等待者共享它的结果；它结束之后，下一次访问才会再起子进程。
- **显式重置**（`reset()`，两个不可用的状态都能用）：
  1. 持锁，重读文件；
  2. 产生新的主密钥并存好（见“主密钥从哪来”）；
  3. 把当前的 `secrets.json`（若有）**复制**成 `secrets.json.reset-<时间>-<随机后缀>`（排他创建）；
  4. 核对仍持有锁，用一次原子替换把新的、没有条目的 `secrets.json` 发布出去。
  
  第 4 步之前任何一步失败或崩溃，旧文件原样在位，状态不变，新主密钥成为孤儿（按诊断列出）；第 4 步之后就是新库。不会出现“文件不见了、被当成 `empty`”的中间状态。重置后所有密钥项变成 `unset`，记一条诊断。旧的密钥库条目与密钥文件不自动删除，诊断里列出位置；文案不承诺“擦除”。
- 主密钥一旦产生，存放位置（密钥库或文件）就记在文件里不再变：之后密钥库变得可用也不自动迁移。

### 主密钥从哪来

- 产生（第一次写或重置）时直接用随机账号对密钥库执行一次 `set`：成功就记 `store: "keyring"`；失败（没有 Secret Service、超时、子进程失败）就写 `secrets.key.<随机 id>`（0600），记一条警告诊断，写明密钥只靠文件权限保护。生产路径不先探测：探测成功不保证随后的写入成功，只多起一个进程。
- 顺序：先把主密钥存好，再提交引用它的 `secrets.json`。中途崩溃留下的孤儿主密钥不复用；孤儿密钥文件在启动时按诊断列出，密钥库里的孤儿条目列不出来（不枚举密钥库），写在“已知限制”里。

### 密钥库子进程

- **协议**：每次访问起一个短命的 Bun 子进程运行 `keyring-helper`。stdin 写一行有版本的请求 `{v: 1, op: "get" | "set" | "probe", service, account, secret?}` 后关闭；stdout 回一行有版本的结果，`{v: 1, ok: true, value?}`，或 `{v: 1, ok: false, code: "no-entry" | "backend-unavailable" | "dependency-load-failed"}`。`no-entry` 来自库的 `getPassword` 返回 null，不按错误文案判断。密钥只走 stdin、stdout，不进命令行参数与环境变量。没有 `delete`：没有调用方。`probe` 只给产物 smoke 用（见下）。
- **一次任务的寿命**（`keyring-client.ts`）：任务拥有子进程、stdin、stdout、stderr、截止计时器与退出 Promise。stdout 限 64 KB、只接受一帧；stderr 同样排空、限长，只归类成固定码，不原样进日志。截止 5 秒：到点 SIGKILL，**等子进程实际退出、管道收完**才结算为 `unavailable` 并释放执行槽；所以“同时至多一个子进程”是真的。非 0 退出、帧不合格、超限都是 `unavailable`；`dependency-load-failed` 另记一条错误级诊断（这是交付问题，不是用户机器没有密钥库）。
- **停止**：服务端停止时拒绝新任务；在途任务立即 SIGKILL 并等它退出，等待者得到 `unavailable`。某个等待者取消只结束它自己的等待，不杀掉别人共享的取得过程。
- 主密钥产生要 `set` 一次、之后每个进程启动后取得一次，各一个子进程；5 秒截止是单次任务的，一次重置最多一次 `set`。
- Linux 显式用 Secret Service 后端（`{linux: {store: "secret-service"}}`），不退到不跨重启保存的 kernel keyutils；锁定 `@napi-rs/keyring` 2.1.2。
- **构建与交付**：
  - `build:server` 加第三个入口 `src/server/keyring-helper.ts` → `dist/server/keyring-helper.js`；运行时按 `server/start.ts` 找 `project.js` 的写法定位（产物里同目录，源码里 `src/server/keyring-helper.ts`）。
  - 原生模块：Bun 把 `.node` 当文件资源处理，不内联进 JS；包的加载器还会找相邻的 `.node` 与平台包（`@napi-rs/keyring-linux-x64-gnu` 等）。S1 第一步实测并写定交付布局：要么 Bun 产出的 `.node` 资源随产物复制，要么把 `@napi-rs/keyring` 与当前平台包标为 external、随产物一起发布到产物旁的 `node_modules`。两种都把结论记进证据。
  - `check:dist` 按写定的布局核对：helper 的 JS 在场并带产品标记，原生文件在场（按存在与大小核对，不当文本扫描）。
  - `smoke:server` 把产物复制到仓库之外、没有上级 `node_modules` 可回退的临时目录里跑 `probe`：`ok` 或 `backend-unavailable` 通过；`dependency-load-failed`、帧不合格、超时、崩溃都失败。另有一条负向检查：删掉原生文件后再跑，必须失败。

### 并发与崩溃

- 整个存储的读改写（产生主密钥、写条目、清除、重置）都在一把跨进程锁里，持锁后先重读 `secrets.json` 再决定。
- `locked-replace` 现在只导出“自己取锁再替换”的 `replaceLocked`，持锁之后不能再用它（会等自己的锁约 3 秒后失败，审查实测）。S2 先做最小的共享改造：把“已持锁时的一次替换”（临时文件、权限、sync、身份核对、改名、清理）拆成导出的函数，收 `HeldLock`；`replaceLocked` 取锁后复用它。密钥存储在同一把外层锁里调用它，提交前核对锁仍持有、文件身份没变，否则不发布、重做。
- 两个进程同时第一次写密钥只产生一把主密钥；本 Task 只保证持锁的读改写正确，跨服务端的实时通知不做（同 `settings.json` 的现状）。

### 写入校验

- 密钥项的 schema 只能是字符串（t02 S1 的登记规则），可以带 `minLength`、`maxLength`、`pattern`、`format`。`write`、`editSecret` 先核对声明（未声明、不是密钥项为 `undeclared`；`write` 只许调用方插件自己声明的项，否则 `denied`），再按声明的 schema 校验值（不合格为 `invalid-value`，摘要只写约束，不带值），最后才进存储。值不做 trim；空串合不合格由 schema 决定；清除是单独的动作，不是写空串。
- 校验失败、声明不对、存储不可用都没有副作用。

### 服务与远程合同

`secretsKey` 的服务（三个位置同一接口；值只在服务端与项目实例能读到）：

```ts
type SecretStatus = "set" | "unset" | "unreadable" | "unknown";
type StoreState = {state: "empty" | "ready" | "unavailable" | "unrecoverable" | "unknown"; reason?: string};
type SecretWriteResult =
    | {ok: true}
    | {ok: false; code: "undeclared" | "denied" | "invalid-value" | "secret-store-unavailable" | "secret-store-unrecoverable" | "unavailable"; summary: string}
    | {ok: false; code: "unknown-outcome"};   // 请求已发出、结果没回来：不自动重发

interface SecretsService {
    /** 同步、响应式，读快照，不发起 I/O。`unknown`：还没拿到快照或连接断开，不冒充 `unset`。 */
    status(setting: SecretSettingDefinition): SecretStatus;
    store(): StoreState;
    onDidChange(listener: (key: string) => void): Disposable;
    read(setting): Promise<{ok: true; value: string} | {ok: false; code: "unset" | "secret-unreadable" | "secret-store-unavailable" | "secret-store-unrecoverable" | "unavailable" | "denied" | "undeclared"}>;
    write(setting, value: string): Promise<SecretWriteResult>;
    clear(setting): Promise<SecretWriteResult>;
}
```

- 用户编辑（只给设置窗口，同配置输出 19 的核对）：`editSecret(key, value)`、`unsetSecret(key)`、`reset()`、`recheck()`。
- `status` 的优先级：快照没到或断开 → `unknown`；存储是 `unavailable`、`unrecoverable` → 所有密钥项 `unreadable`（不管键在不在 `entries`）；否则在 `entries` 里 → `set`，单条坏了 → `unreadable`，不在 → `unset`。
- **快照与顺序**：沿用配置的约定。快照带拥有者的启动标识与单调序号 `{boot, seq}`，形状为 `{revision: {boot, seq}, store: {state, reason?}, entries: {<键>: {state: "set" | "unreadable"}}}`。订阅先给当前基线；`write`、`clear`、`reset`、`recheck` 成功都返回新快照，门面先按 `supersedes` 应用再结算，迟到的旧响应不会把已清除的项改回“已设置”。断开时 `status` 回到 `unknown`；重连后以新基线为准；门面释放后调用得到 `unavailable`。
- **远程失败的归类**：传输层的超时、取消、目标不在、提供方出错，在 `read` 里是 `unavailable`，在写入里，请求还没发出是 `unavailable`、已发出没回来是 `unknown-outcome`。
- **`read` 的调用方核对**：合同的 `callers` 只能整份合同一起写，浏览器还要订阅与写入，所以不收窄合同；拥有者按内核填写的原调用方身份核对 `location` 是服务端或项目实例，否则 `denied`。验收分别用浏览器直调与浏览器经本地签发的代理两条路径验证提供方收到浏览器身份时拒绝（审查确认：内核不允许项目实例把浏览器的来访身份再代理出去，那条路径在内核就被拒，证明不了提供方的核对）。
- **不泄漏**：密钥库、子进程与加解密的错误只以固定的码与摘要出现在响应与诊断里，不带原始异常文字与值。

## Spec 与文档改动

- 新 Spec `docs/specs/settings/secrets.md`（`settings.secrets`，planned）：格式、状态、缓存与重新检查、重置、写入校验、接口、快照与顺序、核对与失败码；注册表加一行。
- `settings/configuration.md` 输出 20 改为链接它（t02 S0 已改为链接，本 Task 补上目标）。
- `runtime/plugin-api.md`：“配置与密钥不在 `ctx` 上”一句改为链接密钥服务；“失败与恢复”与验收 11 改写为：单条密文认证失败可以重新写这一条；主密钥丢失或整个存储损坏须由用户显式重置，恢复合同以 `settings/secrets.md` 为准；运行时只保证不泄漏、不静默删除。
- 应用的构建说明（`packages/neuro-book/AGENTS.md` 或构建脚本旁的说明）写上第三个产物与原生文件的交付布局。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 写 `settings/secrets.md`，改 `configuration.md`、`plugin-api.md` | `docs:check` |
| S1 | 子进程脚本与 `keyring-client`、原生模块的交付布局、`check:dist` 与 `smoke:server` | 产物在隔离目录里的 `probe`、删掉原生文件后 smoke 失败；`check-dist.test.ts`；交付布局记证据 |
| S2 | `locked-replace` 的持锁替换拆分；存储：格式、状态、主密钥与缓存、重置 | 真实文件系统与真实进程的测试（见验收映射） |
| S3 | 服务、写入校验、远程合同与快照顺序、调用方核对、不泄漏 | 合同测试经真实内核与远程门面 |

每片一个提交，在 Work 分支上；S3 之后交 omp 审查（后端）。

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 加解密与格式 | 写后读回；AAD 绑定键（把一条挪到别的键上读为 `unreadable`）；改坏一条只这一条 `unreadable`，重新写这一条恢复；`file-corrupt` 时文件不被覆盖 |
| 主密钥来源 | 本机没有 Secret Service：落到 0600 的密钥文件并有警告诊断；密钥文件被删 → `unrecoverable`；`check` 对不上 → `unrecoverable`；普通读写失败不产生新主密钥 |
| 子进程 | 真实 helper：stdin 关闭后处理一条请求，`set` 后 `get` 读回（有 Secret Service 时），条目不存在为 `no-entry`，固定的安全错误码。可控的测试脚本只用来注入故障：挂起到截止后被 SIGKILL、确认退出之后才结算、帧坏了、输出超限；并发的等待者只起一个子进程，之后一次访问能恢复；停止服务端时在途子进程被杀并退出 |
| 缓存 | 两个真实服务端 A、B：A 读过之后 B 重置，A 再读写用的是新主密钥、写入的条目 B 能读 |
| 重置 | `unrecoverable` 与 `unavailable` 下都能重置：备份文件在、所有项变 `unset`、能重新写；分别在备份后、新主密钥存好后、替换前、替换后杀掉进程，重启后要么是旧库原样、要么是新的空库 |
| 并发 | 两个真实进程同时第一次写不同的键：都能读回、只有一把主密钥；持锁替换在锁被接管时拒绝提交 |
| 写入校验 | 越界长度、正则不匹配、非字符串的远程输入、非声明者、用户编辑代理：都无副作用地失败 |
| 快照顺序 | 写入响应与推送乱序、清除与重置之后迟到的旧响应、断开与重连、门面释放后 |
| 调用方核对 | 浏览器直调、浏览器经本地签发的代理、项目实例、服务端本地、门面释放后、未声明与非密钥的键 |
| 不泄漏 | 用一个唯一标记当密钥值，核对浏览器收到的响应、全部快照、错误、诊断与日志里都没有它；服务端与项目实例的 `read` 另外断言精确读回 |
| 产物 | `check:dist` 有 helper 与原生文件；隔离目录里的 `probe` 得到 `ok` 或 `backend-unavailable`；删掉原生文件后 smoke 失败 |

## 验证

- 每片自跑上表；完成后跑应用的 `bun test`、typecheck、`docs:check`、`governance:check`、`build` 与 `smoke:server`。
- 真实密钥库：本机会话没有 Secret Service，尝试在本机起一个 Secret Service 实现（例如 `gnome-keyring-daemon` 或 KWallet 的 Secret Service 接口）跑真实 helper 的 `set`、`get` 与服务端重启后读回；起不来时这几条记为未验证，不拿测试脚本代替。
- 未验证边界：macOS、Windows 的密钥库；密钥库要求交互解锁时（子进程到截止被杀、读为 `unavailable`），只看诊断，界面只给“重新检查”。

## 不做与风险

- 不做：主密钥分代次；密钥库与密钥文件之间的自动迁移；跨服务端进程的实时通知；枚举并清理密钥库里的孤儿条目；动态的凭据集合（例如按服务商 id 随时新增的密钥，见 t02 的 Lab 示例）；设置窗口的界面（t02 S3）。
- 风险：
  - 密钥库在有桌面会话的机器上可能弹解锁框：子进程到截止被杀，读为 `unavailable`，用户解锁后点“重新检查”或再操作即可；普通读写不产生新主密钥，所以不会因为一次没解锁而丢掉已有的密钥。
  - 每个服务端进程启动后第一次用密钥时起一个子进程（耗时未实测，S1 记数字）；之后用内存里的主密钥，除非另一个服务端重置过。
  - 原生模块的交付布局在 S1 第一步实测后写定；两种布局都由隔离目录里的 smoke 与负向检查守住。
  - 重置会让所有密钥要重新输入：只由用户在设置窗口里确认后触发，程序从不自动重置；旧的密钥库条目与密钥文件留着，重置不是安全擦除。

## 设计审查的处理（2026-10-20）

omp 设计审查（[evidences/design-review-omp.txt](evidences/design-review-omp.txt)）15 条：阻断 1、重要 12、建议 2，都成立。处理：

- 重置的崩溃窗口（第 1 条）：旧文件留在原位、复制备份、新库一次原子替换发布。见“存储的状态”。
- 缓存与外部重置（第 2 条）：缓存绑定 `key` 描述，持锁重读后比较。
- 持锁替换（第 4 条）：S2 先拆出收 `HeldLock` 的替换函数。
- 构建交付（第 6 条）：协议区分 `dependency-load-failed`；写定交付布局；隔离目录的 smoke 与负向检查。
- 快照顺序（第 7 条）：沿用配置的 `{boot, seq}` 与 `supersedes`，写入返回快照。
- 子进程寿命（第 8 条）：任务拥有子进程，确认退出后才释放；停止与取消的语义写定。
- 写入校验与失败合同（第 9 条）：按声明的 schema 校验；`SecretWriteResult` 与远程失败归类写定。
- 旧的恢复合同（第 11 条）：S0 改 `plugin-api.md`。
- `unknown` 与重新检查（第 13 条）：`status` 优先级写定，读状态不发 I/O，加 `recheck()`；`unknown` 在设置窗口里的显示在 t02 S3。
- 验收措辞（第 14 条）：普通读写不产生新主密钥、重置例外；不泄漏的范围排除合法的服务端读取；测试脚本只做故障注入，真实 helper 另验。
- 去掉生产路径的探测与 `delete`（第 15 条）。
- 第 3、5、10、12 条落在 t02，见 t02 计划的“设计审查的处理”。
