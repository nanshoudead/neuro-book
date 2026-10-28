---
标签: [state:inject]
别名: ["设置页框", "Settings Page Frame"]
验证入口: SettingsWindow
---

# SettingsPageFrame

设置窗口里 page 分区的可见形态（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 4–6）：分区所属的入口还没交付、受阻、启动失败或已撤回时原位显示原因；交付了在加载时显示占位；`load()` 失败给“重新加载”，页面渲染出错给“重试”；正常时渲染页面组件并把 `context` 交给它。一个分区出错不影响窗口与别的分区。加载与代际由窗口模型（`settings-window.ts`）决定，它只呈现。

它把页面包在一个错误边界里：边界只接住 Vue 调用路径上的错误，接住后发 `render-error`，不让错误冒到窗口；页面自己发起、没有交给 Vue 的异步错误归它所属的插件。

## 布局

填满父级给的区域：`column` 页面由窗口放进内容列，`fill` 页面拿到标题下面的整块区域，自己分栏、自己滚动；这里不加滚动与内边距。状态说明在区域里居中、可换行；加载是一枚转动的指示加一句说明（`role="status"`、`aria-busy`），失败是原因加动作按钮（`role="alert"`）。

## 交互

- `entry-failed` 的“重试”发 `retry-entry`；`load()` 失败的“重新加载”发 `reload`；渲染出错的“重试”发 `retry-render`。按钮在 `busy` 时停用，不重复发起。
- 页面组件以 `generation` 作 key：模型给了新代际就卸掉旧实例、建新实例；同一次显示里 `context` 不变（切换标签只改它的 `layer`），页面不重建；新的一次显示模型另给一个 `context`（输出 6、22）。

## 数据

```ts
import type {Component} from "vue";
import type {SettingsPageContext} from "../contracts";
import type {SettingsPageDelivery} from "../sections";
import type {SettingsPageStatus} from "../settings-window";

type Props = {
    /** 交付状态；不是 available 时只显示它，不看 status。 */
    delivery: SettingsPageDelivery;
    status: SettingsPageStatus;
    /** 加载或渲染失败的摘要；没有失败为 null。 */
    error: string | null;
    /** status 为 ready 时的组件定义。 */
    component: Component | null;
    context: SettingsPageContext;
    generation: number;
    /** 一次重试进行中；缺省 false。 */
    busy?: boolean;
};

type Emits = {
    (event: "retry-entry"): void;
    (event: "reload"): void;
    (event: "retry-render"): void;
    /** 错误边界接住了页面的渲染错误；带上出错实例的代际，模型据此丢弃过期的报告。 */
    (event: "render-error", generation: number, message: string): void;
};
```

没有 slots、expose；attrs 落在根上。根带 `data-settings-page`（分区 id）与 `data-settings-page-state`（交付状态或实例状态）。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，固定文字在 `nbook.settings` 的目录里（`plugins/settings/locales/`；`pageFrame.*` 键）；语言随端口切换，不重新挂载，组件没有语言属性。设置窗口里的页面与 SDK 交给第三方插件的设置页都在宿主窗口里，宿主总会登记这份目录。没有宿主注入时得到 nb-ui 的缺省端口，那里没有这份目录，只显示键名，所以测试与 Lab 场景要注入登记了它的宿主引擎端口。
