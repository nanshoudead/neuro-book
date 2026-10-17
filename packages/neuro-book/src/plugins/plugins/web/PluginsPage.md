---
标签: [state:local, env:portal]
别名: ["插件页", "插件管理", "Plugins"]
---

# PluginsPage

设置窗口里“插件”分区的页面（[`runtime/plugin-install.md`](../../../../../../docs/specs/runtime/plugin-install.md) 输出 1–4、7–9）：`nbook.plugins` 贡献的 column 页面，只在“用户”标签下可用。列出内置与第三方插件，从服务端本地的文件夹安装第三方插件，启用、禁用与卸载它们。所有操作都在下一次启动 NeuroBook 后生效，这一点在页面顶部常驻说明；有待生效的变化时每个插件上写出它（例如“重启后启用”）。内置插件标“内置”，没有任何操作。设置窗口画分区的标题与说明，这里从说明横幅开始画。

## 布局

从上到下：

1. 说明横幅（`Banner`，信息色）：“安装、卸载、升级、启用与禁用在下一次启动后生效”。有待生效变化时换成警告色，并写“重启 NeuroBook 后生效”。安全模式下另有一条警告色横幅：“安全模式：第三方插件没有加载”。
2. 安装：一行输入框（插件文件夹的路径，伸缩）加“安装…”按钮。窄屏时按钮仍在同一行，输入框收窄。
3. 操作失败时一行危险色的说明（可在任意处折行）。
4. 插件列表：先内置、后第三方，各按 id 排序。每个插件一行带边框的块：左边是 id、版本与徽标（“内置”；待生效变化，例如“重启后安装”“重启后升级到 1.1.0”；没有登记的原因，例如“清单无效”“不兼容”“安全模式未加载”），没有登记时下面另起一行写原因的说明；右边是第三方插件的启用开关与“卸载”按钮。左边的文字放不下时换行，右边的控件不缩。

列表自己不滚动，由设置窗口的内容列滚动。

## 交互

- “安装…”：路径为空时停用。点了打开确认对话框，写明完全信任的后果（插件可以访问全部作品、服务器与本机资源）与要安装的路径；确认后调 `install`，对话框在结算前保持打开、确认按钮显示进行中。成功：关闭对话框、清空输入框、重新读列表；失败：关闭对话框，在失败说明里写出原因。
- 启用开关：调 `enable` 或 `disable`，结算前开关停用；成功后这一行换成返回的新状态，失败写原因。开关的值是登记表里的用户状态（不是本次运行的状态），与“重启后启用”“重启后禁用”徽标一起看。
- “卸载”：打开确认对话框（“卸载 {id}？重启后删除插件的安装目录，配置与私有数据保留”），确认后调 `uninstall`，这一行换成“重启后卸载”。卸载中的插件开关与“卸载”都停用：卸载不能撤销，重启后才能再操作。
- 任一操作进行中时，其它会写的按钮都停用，不发起第二个写操作。
- 对话框关闭后焦点回到打开它的按钮（`Dialog` 的行为）。

## 数据

```ts
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {pluginsRegistryContract} from "../shared/contracts";

type Props = {
    /** `nbook.plugins/registry` 的客户端（浏览器入口经 `context.remote.use` 取得）。必填。 */
    registry: RemoteClient<typeof pluginsRegistryContract>;
    /** 显示语言。必填。 */
    locale: DisplayLocale;
};
```

没有 emits、slots、expose；attrs 落在根上。根带 `data-plugins-page`；路径输入框带 `data-plugin-path`，“安装…”带 `data-plugin-install`；每个插件一行带 `data-plugin-row`（id）与 `data-plugin-source`（`builtin` 或 `third-party`），其中待生效变化的徽标带 `data-plugin-pending`（种类），没有登记的原因带 `data-plugin-not-loaded`（码），开关带 `data-plugin-toggle`，“卸载”带 `data-plugin-uninstall`；失败说明带 `data-plugin-problem`（失败码）；安全模式横幅带 `data-plugins-safe-mode`。

## 状态

- 加载中：列表的位置写“正在读取插件…”。
- 读取失败：失败说明写原因，列表为空；之后的操作成功会重新读。
- 空：不会出现（内置插件总在）。
- 进行中：见“交互”。

## 隐藏通道理由

- `state:local`：列表、输入框、两个对话框的开合、进行中的操作与最近一次失败。
- `env:portal`：来自 `Dialog`。

## 注意事项

- 读写都经属性传入的 `registry` 发出，它是调用方给的、可替换的入口，不是组件自己伸出去的通道。
- 失败说明是按失败码的固定文字，后面接服务端给的 `detail`（文件系统错误只带错误码），不显示堆栈。

## 不支持

不选择文件夹（只输入服务端本地路径，Desktop 的文件选择器之后接入）；不提供删除私有数据的卸载选项；不显示插件入口的运行状态与受阻原因；不提供重启按钮。
