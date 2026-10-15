# t03 实施计划：编辑器区的标签栏与拆分

## Context

- **为什么做**：开发者 2026-10-15 要求打磨编辑器区。现状：拆分后拖不动分隔线（已修，`80d9cdbd5`）；标签栏只有单行横向滚动、没有图标；不能拖动标签排序、换组或拖到边缘拆分（旧应用有）；没有固定标签、多行标签、标签右键菜单；标题动作一直显示。
- **依据**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（“不承诺”里列着拖放、固定、多行与标签右键菜单）、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 10（悬停时显示）、[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)、[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md)。
- **已定**：Task README 的“开发者的决定”1 到 10（注意力排序；VS Code 式标签块；多行时固定标签单独一行；面包屑；开放式分隔线）；标签条的深浅等评审板第 3 轮的答复。
- **工作方式**：在 `.worktree/w00025-t03-tabs-and-split` 逐片提交；视觉在草稿 worktree 定稿后才写进组件。测试用真实的组模型、文档模型与浏览器，不用 mock。

## 关键设计

### 1. 组模型 `plugins/editor/web/groups/groups.ts`

- `FileTab` 加 `pinned: boolean`，会话记录里写 `pinned?: true`（旧记录没有时为 false）。不变量：每组里固定标签在前、普通标签在后；所有改顺序的操作都维持它。
- 现有的 `pin(tabId)`（preview 转正）改名为 `keep(tabId)`，避免与“固定”混淆；新增 `setPinned(tabId, pinned)`：固定时转正并移到固定区末尾，取消时移到普通区开头。页面标签不能固定。
- 新增 `moveTab(tabId, {group, before, pinned})`：组内排序或换组。目标组已有同地址同编辑器的标签时不新增，激活那一个并关掉源标签（同 VS Code）。落点跨过固定区边界时随之固定或取消固定。源组空了就关掉（与关闭最后一个标签相同）。返回消失的标签，交给控制器释放引用。
- 新增 `moveToNewGroup(tabId, {group, edge})`：在目标组的上下左右边拆出新组并把标签移过去（拖到边缘）。源组只有这一个标签并且就是目标组时拒绝（拆不出东西）。
- `closeOthers`、新增的 `closeToRight`、`closeSaved` 跳过固定标签。

### 2. 控制器 `plugins/editor/web/area.ts`

- 按第 1 节的操作补控制器方法：换组时文档引用随标签走（标签 id 不变，引用不动）；`moveTab` 关掉的源标签按现有的 `releaseTab` 释放；需要结算的标签被并掉时先按 `closeTab` 的规则问（它其实是被关掉）。
- 多个标签一起关（关闭其他、关闭右侧、关闭已保存）：逐个走 `closeTab`，有人选“取消”就停在那里，已关的不回滚（同 VS Code）。
- 预览标签页开关：设置 `enablePreview` 为假时，`open` 的 `mode: "preview"` 按 `permanent` 处理。

### 3. 设置 `plugins/editor/shared/settings.ts`（新）

- 照 `plugins/explorer/shared/settings.ts` 的写法：分区“编辑器”（list），设置项 `nbook.editor/enablePreview`（缺省 true）、`nbook.editor/wrapTabs`（缺省 true）。改了即时生效。

### 4. 标签栏 `plugins/editor/web/components/EditorTabBar.vue` 与 `.md`

- 按评审定稿重写外观（VS Code 式）：标签条低一档、活动标签是与正文同色的一块；文件图标、名字、同名附 `…/目录`、状态位（未保存圆点，悬停或活动时换成关闭；固定的换成图钉）、预览斜体；标题动作在最后一行右侧；同一行相邻标签之间是开放式分隔线（活动与悬停标签两侧不画）。低一档的颜色按 nb-ui 表面模型提案加层级色阶，不在组件里混色。
- 文件图标：`FileIcon.vue` 与 `icons/` 现在在资源管理器插件里；编辑器插件不跨插件引用别人的组件，挪到共享的 `src/ui/file-icons/`，资源管理器与编辑器都从那里引。
- 同名的目录提示：在组内按名字分组，同名的取能区分它们的最短上级目录（VS Code 的做法），在 `area` 侧算好随 `TabItem` 给出，组件只画。
- 多行：`wrap` 属性，固定标签单独占第一行；关掉时保持现在的横向滚动（悬停滚动条），固定标签排在最前。键盘：多行时 ↑/↓ 换到上下一行最近的标签。
- 零布局位移：隐藏的关闭按钮占位；活动标签的突出不改变宽度。

### 5. 拖动标签 `plugins/editor/web/tab-drag.ts`（新）

- 手势照 `plugins/explorer/web/tree-drag.ts`：指针拖动，鼠标 6px、触摸按住 200ms 起拖；Escape、失焦、`pointercancel` 取消不写；吞掉末尾的 click。
- 落点两类：某组的标签条（插入位，`resolveListInsertion`，多行时先按纵向距离选行，同旧应用 `editor-tab-drop.ts`）；某组的正文区（`resolveGridEdgeDrop`：中央为移到这一组末尾，四边为拆分）。反馈用 nb-ui 的 `DropIndicator` 与 `DropFeedbackOverlay`。
- 放下时按最后显示的动作提交到第 2 节的方法；动作不可提交（例如拖到自己原位）只显示不写。
- 资源管理器拖到编辑区（`data-editor-group`，输出 35）不变：只打开到那一组，不支持拖到边缘拆分。

### 6. 标签右键菜单

- 菜单位置 `editor.tab-context`（拥有者 `nbook.editor`，`contexts: ["resource"]`，与 `editor.title` 同一套共同规则），编辑器自己的项：关闭、关闭其他、关闭右侧、关闭已保存；固定或取消固定；向右拆分、向下拆分；复制路径、复制相对路径、在资源管理器中显示（执行 `nbook.files.copy-path`、`copy-relative-path`、`reveal`）。别的插件可以往里加。
- 新命令：`nbook.editor.close-to-right`、`close-saved`、`pin-tab`、`unpin-tab`，参数 `{tabId?}`，缺省是活动标签；菜单执行时带被右击的那个标签。
- 菜单用 nb-ui 的 `ContextMenu`，与资源管理器右键同一种画法；键盘 Shift+F10 与菜单键在聚焦的标签上打开。

### 7. 悬停时显示

- 编辑区标题动作与非活动标签的关闭按钮：鼠标在编辑组上、焦点在组里或菜单打开时显示，其余时候透明（仍占位、仍能 Tab 到），100ms 淡入淡出；不能悬停的设备一直显示。规则同 views.md 输出 10。

### 8. 面包屑 `plugins/editor/web/components/EditorBreadcrumbs.vue`（新）

- 标签条下面一行：作品名 › 目录 › 文件；Markdown 再接光标所在的标题（Markdown 控件经句柄交出大纲与当前标题，与 `status`、`language` 同一种做法：句柄加可选的 `outline`）。
- 点目录段列出它的子项（读文件服务的 `list`），点文件段列出同级，点标题段列出这一章的大纲；选中即打开（普通 `open`）或跳到标题（句柄的定位）。下拉用 nb-ui 的菜单浮层。
- 设置 `nbook.editor/breadcrumbs`（缺省 true）。命令 `nbook.editor.focus-breadcrumbs`；←/→ 换段、Enter 或 ↓ 打开下拉、Escape 回到编辑器。
- `user://` 的文件以“用户资产”为第一段；页面标签没有面包屑。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/editor.md` | “不承诺”去掉拖放、固定、多行、标签右键菜单、面包屑；新增输出：固定标签、拖动标签、多行与设置项、预览标签页开关、标签右键菜单与命令、同名提示、悬停显示；会话记录加 `pinned`；验收场景 |
| `docs/specs/workbench/menus.md` | 第五处位置 `editor.tab-context` |
| `docs/specs/workbench/files-explorer.md` | 文件图标挪到共享位置（只改实现入口的链接） |
| 组件 `.md` | `EditorTabBar.md` 重写；`FileIcon.md` 随文件挪位置 |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 拆分调整大小（已完成 `80d9cdbd5`） | — |
| S1 | Spec 改动（planned 标记） | `docs:check`、`governance:check` |
| S2 | 第 1、2 节：组模型与控制器的固定、换组、拆到边缘、批量关闭 | `test:affected --typecheck`（`groups.test.ts`、`area.test.ts`） |
| S3 | 第 3 节设置与预览开关；第 6 节的命令与菜单位置（菜单先接现在的标签条） | 同上；`editor-area.e2e.ts` 右键菜单一例 |
| S4 | 第 4 节标签栏外观（等评审定稿）与第 7 节悬停显示；文件图标挪位置 | 同上；`EditorTabBar.dom.test.ts`；`lab:shot` 亮暗、390 与 1400 宽 |
| S5 | 第 5 节拖动 | 同上；`editor-area.e2e.ts` 拖动用例 |
| S5b | 第 8 节面包屑 | 同上；`EditorBreadcrumbs.dom.test.ts`、`editor-area.e2e.ts` 面包屑用例 |
| S6 | Spec 去掉 planned、证据；审查与修正 | `test:affected --typecheck`、编辑器相关 e2e、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 固定后排到固定区末尾；关闭其他与关闭右侧不关固定标签；刷新后仍固定 | `groups.test.ts`、`area.test.ts`、e2e |
| 组内拖动排序；拖到别的组；拖到别的组的边缘拆出新组；源组空了关掉；目标组已有同一标签时并掉 | `groups.test.ts`（模型）、`editor-area.e2e.ts`（真实指针拖动） |
| 拖动中 Escape 取消，什么都不变 | `editor-area.e2e.ts` |
| 并掉的标签有未保存修改时照常结算 | `area.test.ts` |
| 关掉预览标签页后单击打开的是普通标签；关掉多行后标签条横向滚动 | `area.test.ts`、e2e |
| 标签右键菜单的项、可用性与执行；贡献的项出现在里面 | `editor/title-actions.test.ts` 同类的菜单测试、e2e |
| 同名标签附上能区分的最短目录 | `area.test.ts` |
| 标签栏外观与零布局位移 | `EditorTabBar.dom.test.ts`、`lab:shot` |
| 面包屑的段与下拉：点目录列子项、点文件列同级、点标题列大纲并跳转；关掉设置后不显示 | `EditorBreadcrumbs.dom.test.ts`、`editor-area.e2e.ts` |

## 验证

- 每片：`bun run test:affected --typecheck`；动到界面的片跑 `lab:shot` 与编辑器相关 e2e（`editor-area`、`editor-types`、`lab-editor`）。
- 收口：生产构建上的编辑器相关 e2e、`docs:check`、`governance:check`；按 `reviewing` Skill 做实现审查（前端 Sonnet；后端与领域逻辑 omp）。
- 未验证边界：触摸设备上的拖动只按代码与 tree-drag 的同一套门槛，不在真机上测。

## 不做与风险

- 不做：拖动时按 Ctrl 复制标签；把标签拖出窗口；资源管理器拖到编辑区边缘拆分；固定标签的紧凑样式；标签条的滚动按钮。
- 风险：换组时同一文档在两组的视图与撤销历史。标签 id 不变、引用不动，控件随组重挂；Markdown 的撤销历史按组，换组后撤销历史从空开始（与拆分一致）。实现时若发现控件依赖组 id，先停下补 Spec。
