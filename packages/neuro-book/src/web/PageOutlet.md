---
标签: [state:local, state:inject, env:route]
---

# PageOutlet

窗口 ready 后的根组件：按路由渲染当前页面，并呈现窗口状态的后续变化。它把窗口状态投影到页面根元素的标记上，远程服务链路断开时在页面顶部浮出离线横幅；窗口不再可用（实例已停止、服务端已换进程）时把页面换成 [FailurePage](FailurePage.md)。行为合同见 [`runtime.browser-host`](../../../../docs/specs/runtime/browser-host.md) 的“断线与重连”。

## 数据

```ts
type Props = {
    /** 窗口（window.ts 的 BrowserWindow）；组件只订阅它的状态，不改写。 */
    browserWindow: BrowserWindow;
};

type Emits = {
    /** 宿主页上点“刷新页面”。 */
    reload: [];
};
```

无 slots、无 expose。路由由装配方（`mount.ts`）在挂载前安装，组件里的 `RouterView` 读取它。

## 布局与状态

- **在线**：只有页面本身。页面根元素带 `data-window-state="ready"`、`data-window-instance="<实例 id>"`、`data-rpc-state="online"`。
- **离线**：页面保留不动，根元素的 `data-rpc-state` 变为 `offline`；横幅 `.nb-offline-banner`（`role="status"`）固定在视口顶部，不占布局、不拦截指针，出现与收起都不推动页面内容。重连成功后横幅收起、标记回到 `online`。
- **服务端已重启、窗口已关闭**：不再渲染页面，显示 FailurePage，只给刷新。

## 页面合同

上面三个标记在页面组件挂上时就有了，页面按需加载的主体可能还没出来。页面自己在首屏的主体挂上之后，在根元素上加 `data-page-rendered`（空值）；主体同步渲染的页面直接写在根上（`NotFoundPage`），按需加载主体的页面等它挂上再加（工作台的 `/` 与 `/workbench`，见 `plugins/workbench/web/home-page.ts`）。页面里还在加载的区域标 `aria-busy="true"`，加载完（成功或失败）去掉；只有骨架、转圈这类动画不够，它们多是无限循环的，截图工具不等。截图工具 `page:shot`（`scripts/page-shot.ts`）按这两条与有限的动画判断画面是否就绪；不给 `data-page-rendered` 的页面（目前是 `/lab`，它有自己的 `lab:shot`）截不了。

## 隐藏通道理由

- `state:local`：持有窗口状态的本地快照，随订阅更新，组件卸载时取消订阅。
- `env:route`：经 `RouterView` 读取装配方安装的路由；路由归宿主，一个文档一个，组件不发起跳转。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，翻译离线横幅（宿主目录 `nbook.host` 的 `offline.banner`）。
