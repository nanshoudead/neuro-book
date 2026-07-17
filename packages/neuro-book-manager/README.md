# NeuroBook Manager

NeuroBook 的安装、更新、实例、Runtime 与工具链管理器。

没有安装Bun时，可以先通过平台Stage 0进入同一个安装向导：

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

Linux Stage 0支持x64 glibc，并依赖`curl`、`unzip`和`sha256sum`。Windows普通用户也可以直接从GitHub Release下载`neuro-book-windows-x64.zip`解压使用。

直接运行且不传参数，会先检测当前目录：受管实例进入管理菜单，未接管的NeuroBook Git checkout进入接管菜单，普通目录进入部署菜单：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

向导会说明部署方式并依次选择安装目录、实例名称、更新通道、端口和鉴权。自动化安装仍可显式传参：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --yes
```

六种Profile分别是：Windows解压/托管运行时使用`windows-portable`；Linux服务器预构建镜像使用`ghcr`；无Docker的预构建Product使用`product-bun`；开发使用`source-dev`；本机源码生产构建使用`source-product`；容器内源码构建使用`source-docker`。

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

`--root`、`--instance`和Manager自身`--version`是全局参数，必须写在子命令前；`install/update/runtime install`自己的`--version`写在子命令后，表示目标组件版本。

`neuro-book manage` 使用 blessed 提供多实例 TUI，可查看状态、执行诊断、启动、更新、注册、设置默认实例或忘记索引。忘记实例不会删除 Installation Root 或用户数据。

Windows Portable的State Root固定为`data/`。如果Installation Root下另外出现了真实`workspace/`目录，Manager会把它视为可能的数据分叉：`doctor`报告`state.shadow-workspace`失败，`status`给出人工处理步骤，`start`只警告并继续。Manager不会自动复制、合并、删除或重命名两个目录；junction或symlink若与`data/workspace/`指向同一真实目录则不会误报。

已有Manifest v3实例使用`instances import <path> --yes`执行离线完整性门禁后登记；`--yes`只接受“服务未启动”等warning，不能绕过checksum、wrapper或Operation blocker。无Manifest源码checkout使用`adopt`显式接管；三个Source Profile均在detached worktree准备，dirty、未知remote或非法branch会停止。无法证明revision/checksum的历史`.output`不会直接纳入管理。

Install、Update与Start在修改应用数据前都会先恢复未完成Operation，并在install lock内持久化Operation Journal。Agent Attachment格式迁移先dry-run记录受影响session的source/target hash，再apply并补充backup路径；健康检查或进程中断时，Manager先停止新Product/容器释放runtime lease并撤销session格式，之后才恢复Product、SQLite和Compose。缺少迁移脚本、runId不一致或`applied`操作返回`not_started`都会停止，不能静默启动不完整Product。

不要使用 `bunx run @notnotype/neuro-book-manager`；`bunx run` 会把包名按本地脚本或路径解析，Manager 不会被启动。

公开命令为 `neuro-book`。应用源码、Product、Runtime、Toolchain、Deployment State 与用户状态使用独立组件合同。
