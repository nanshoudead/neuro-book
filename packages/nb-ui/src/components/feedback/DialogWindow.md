---
标签: [state:local, env:portal]
---

# DialogWindow

`DialogWindow` 是浮动窗口的旧名字。新代码用 [`Dialog`](Dialog.md) 的 `modal=false`。这一层留给还在按旧名字调用的界面，并把当时的默认值补回去：非模态、显示关闭按钮、没有确认页脚，尺寸档是 `sm`（420×420）、`md`（720×640）、`lg`（1100×820）。显式传入的宽高覆盖对应的档。

行为、拖动、缩放和叠放都由 `Dialog` 承担。打开期间不要把它当成模态框来用。
