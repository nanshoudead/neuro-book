---
标签: [state:shared-read, state:shared-write]
---

# 明暗切换

顶栏里的一个图标按钮，点开是“跟随系统 / 亮色 / 暗色”三选一（docs/specs/story/viewer.md 输出 34）。书页、书架页、设置页、导入页与抽取进度页共用这一个控件，选择存在同一份偏好里（`host/prefs.ts` 的 `theme`，经 `host/theme.ts` 的 `useAppearance`），所以任何一页改了，别的页同时生效、刷新后保持。

## 布局

一个 `sm` 的图标按钮，图标随当前选择变（显示器、太阳、月亮）；菜单靠右对齐。放在各页顶部右端。

## 数据

无 props、无事件：状态都在 `useAppearance()`。

- 共享状态的理由（`state:shared-read`、`state:shared-write`）：明暗是整个浏览器的偏好，五个页面各自挂这个控件；让每个页面把当前值与修改回调传下来，就是五份一样的接线。偏好的读写在 `host/theme.ts`，组件不碰浏览器存储。
- 调用方传的 `class`、`data-*` 等属性落在触发按钮上（经 `DropdownMenu` 的 `rootClass`；DropdownMenu 的根是不渲染元素的原语，属性不会自己落下来），所以 `class="ml-auto"` 能把它推到一行的右端。

## 验证入口

各页顶栏的 `data-testid="theme-menu"`（`e2e/viewer.e2e.ts` 的外壳用例）。
