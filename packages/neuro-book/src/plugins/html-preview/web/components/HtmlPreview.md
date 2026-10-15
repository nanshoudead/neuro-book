---
标签: [state:local]
别名: ["HTML 预览", "HTML Preview"]
---

# HtmlPreview

HTML 预览的控件（[`workbench/html-preview.md`](../../../../../../../docs/specs/workbench/html-preview.md)）：按编辑器控件合同收到文本绑定（预览视图只读），把正文拼成 `srcdoc` 放进只给 `allow-scripts` 的沙箱 iframe。相对引用经预览令牌读作品里的文件。

## 数据

```ts
type Props = {
    binding: TextEditorBinding | null;
    host: ViewStateSlot;
    readonly: boolean;
    visible: boolean;
    label: string;
    locale: DisplayLocale;
    /** 由插件给出：令牌的签发与作废（`web/access.ts`）。 */
    access: PreviewAccess;
    /** 停手计时用的时钟（宿主时钟）。 */
    clock: RuntimeClock;
    /** 这个文件是否允许联网（插件的开关，按地址）。 */
    network: (address: string) => boolean;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

句柄只有 `focus`（聚焦 iframe）与 `flushPendingChange`（无事可做）。

## 布局与状态

- 可见且有绑定时申请令牌（每个绑定一个），拿到后渲染 iframe（白底，铺满内容区，`referrerpolicy="no-referrer"`）；换绑定、卸载时作废令牌。不可见时移除 iframe，重新可见时按当时的正文重建。
- 正文变化停手 300 ms 后整页重载（用 `clock` 计时，不可见时不计时）；联网开关变化时立即重载。
- 拼页面见 `web/compose.ts`：CSP、`<base>`、页内锚点脚本插在 `<head>` 之后。
- 不是 `project://` 的文件、令牌申请失败时内容区说明原因，后者带“重试”。

## 不支持

- 不运行 Worker 的 http 地址；不跟随页面里跳到别的 `.html` 的实时更新。
