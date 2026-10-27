---
标签: [state:local]
---

# 明暗切换

顶栏里的一个图标按钮，点开是“跟随系统 / 亮色 / 暗色”三选一（docs/specs/story/viewer.md 输出 34）。书页、书架页、设置页、导入页与抽取进度页共用这一个控件，选择存在同一份偏好里（`host/prefs.ts` 的 `theme`，经 `host/theme.ts` 的 `useAppearance`），所以任何一页改了，别的页同时生效、刷新后保持。

## 布局

一个 `sm` 的图标按钮，图标随当前选择变（显示器、太阳、月亮）；菜单靠右对齐。放在各页顶部右端。

## 数据

无 props、无事件：状态都在 `useAppearance()`。

## 验证入口

各页顶栏的 `data-testid="theme-menu"`（`e2e/viewer.e2e.ts` 的外壳用例）。
