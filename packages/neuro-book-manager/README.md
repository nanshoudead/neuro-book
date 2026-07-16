# NeuroBook Manager

NeuroBook 的安装、更新、实例、Runtime 与工具链管理器。

没有安装Bun时，可以先通过平台Stage 0进入同一个安装向导：

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

POSIX Stage 0支持Linux glibc与macOS的x64/ARM64：Linux依赖`sha256sum`并验证glibc，macOS使用系统`shasum -a 256`；两者都依赖`curl`和`unzip`。Windows普通用户也可以直接从GitHub Release下载`neuro-book-windows-x64.zip`解压使用。

直接运行且不传参数，会先检测当前目录：受管实例进入管理菜单，未接管的NeuroBook Git checkout进入接管菜单，普通目录进入部署菜单：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

向导会说明部署方式并依次选择安装目录、实例名称、更新通道、端口和鉴权。自动化安装仍可显式传参：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --yes
```

六种Profile分别是：Windows解压/托管运行时使用`windows-portable`；Linux/macOS容器部署使用`ghcr`；无容器的预构建Product使用`product-bun`；开发使用`source-dev`；本机源码生产构建使用`source-product`；容器内源码构建使用`source-docker`。Windows x64、Linux x64/AArch64 glibc和macOS x64/ARM64支持各自原生Product；Windows ARM64和Linux musl明确不支持。

容器Profile首次安装时会验证Docker/Podman CLI、Compose和engine状态，并把选定engine写入Installation Manifest与Operation Journal。后续start/update/rollback/doctor/create-admin始终使用该engine，不会在Docker与Podman之间静默切换；管理员命令只使用Docker Compose与`podman-compose`共同支持的`compose exec`。

Managed Bun在复用或提交版本目录前会恢复POSIX执行位并执行真实版本检查；损坏缓存会删除后重新下载，不会进入Installation Manifest。

安装成功后，实例会注册到 `~/.neuro-book-manager/config.json`。该文件只保存用户偏好、默认实例和实例目录索引；每个实例的真实部署状态仍由其 `.deploy/installation.json` 管理。

```bash
neuro-book manage
neuro-book instances list
neuro-book instances inspect . --json
neuro-book instances discover
neuro-book adopt . --profile source-dev
neuro-book --instance <name> status
neuro-book --root <path> doctor
```

`neuro-book manage` 使用 blessed 提供多实例 TUI，可查看状态、执行诊断、启动、更新、注册、设置默认实例或忘记索引。忘记实例不会删除 Installation Root 或用户数据。

已有Manifest v4实例使用`instances import <path> --yes`执行离线完整性门禁后登记；v3不自动迁移，需要重新安装并只复用用户状态。`--yes`只接受“服务未启动”等warning，不能绕过checksum、wrapper或Operation blocker。无Manifest源码checkout使用`adopt`显式接管；三个Source Profile均在detached worktree准备，dirty、未知remote或非法branch会停止。无法证明revision/checksum的历史`.output`不会直接纳入管理。

不要使用 `bunx run @notnotype/neuro-book-manager`；`bunx run` 会把包名按本地脚本或路径解析，Manager 不会被启动。

公开命令为 `neuro-book`。应用源码、Product、Runtime、Toolchain、Deployment State 与用户状态使用独立组件合同。
