# 密钥库实测（2026-10-20，本机 Arch + KDE，Bun 1.4.2）

- `@napi-rs/keyring` 2.1.2（MIT），带 linux-x64 gnu/musl 预编译包；`bun add` 11 秒装好，在 Bun 下能加载原生模块。
- 本机当前会话的 D-Bus 上没有 Secret Service：`secret-tool store/lookup/clear` 都报 `The name is not activatable`；`busctl` 调 `org.freedesktop.secrets` 同样失败（KWallet 的名字可激活，但 `org.freedesktop.secrets` 不可激活）。
- 此时 `new Entry(...)` 与 `new AsyncEntry(...)` 在构造时同步抛出 `Couldn't access platform storage: KeyRevoked`（code `GenericFailure`），约 2 ms，不挂起。
- 库有异步类 `AsyncEntry`，`getPassword(signal)`、`setPassword(password, signal)`、`deleteCredential(signal)` 都收 `AbortSignal`：密钥库要求解锁、弹框等待时可以用超时中止，不阻塞服务端的事件循环。同步的 `Entry` 不要用。
- 没能实测：密钥库存在但锁着、弹解锁框时的表现（本机会话没有 Secret Service）。
- 结论：本机（以及无桌面会话、以 systemd 用户单元运行的服务端）会走状态根下的密钥文件；有桌面会话的机器走密钥库。
