# t10 实施计划：设置窗口的外框与“本作品”沿用行

## Context

开发者 2026-10-23 看 t06 的实现，提了两件事：

- “本作品”标签里，沿用用户设置的行要先点“单独设置”才出现控件；
- 设置窗口拖不动、圆角太圆、标题区太高。

查明的原因：设置窗口用 nb-ui `Dialog` 的浮动窗口（`modal=false`），外框是对话框那一套：

- 圆角取 `--radius-dialog`，nbook 是 26px；
- 上边距 20px、单独一行标题“设置”、与正文隔 14px；
- 拖动把手只绑在标题文字那一块，18px 高。

第七轮定稿的草稿本来没有这条标题栏，实现时偏离了。

两轮评审定下的六条（[README](README.md)“设计决定”）：

1. 去掉标题栏，关闭在右上角，顶上空白处能拖；
2. 圆角 14px；
3. 沿用的行控件一直在、标题后加标签；
4. 左上角不写“设置”；
5. 页面标题 20px 加粗；
6. 标签写“来自用户设置”、描边。

依据：

- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 3、12、16（已改，标 planned）；
- nb-ui [`Dialog.md`](../../../../../packages/nb-ui/src/components/feedback/Dialog.md)。

工作方式：主会话实现。Work 分支 `feat/w00027-plugin-platform`（worktree `.worktree/w00027-plugin-platform`），每片单独提交；界面实现审查派 Sonnet，合入 master 不请示，push 要问。

## 技术选型

无：都是现有组件与样式的改动，不引入新库。

## 关键设计

### `packages/nb-ui`：浮动窗口的外框

- **圆角**：新 token `--radius-window`，缺省等于 `--radius-dialog`，nbook 取 14px。
  - 只给浮动窗口用（`.nb-dialog--window`），模态对话框仍取 `--radius-dialog`。
  - 登记照 `--radius-dialog-compact` 的做法：`theme/tokens.ts` 的清单、`tokens.css` 的缺省、`tokens.test.ts`、`themes/nbook/vars.css`，以及 `authoring-themes.md`、`design-language.md`、`ui-development-spec.md` 里讲对话框圆角的地方。
  - 规则：叠在窗口上的确认框圆角不大于窗口，nbook 两者都是 14px。
- **拖动区域**：浮动窗口里，以下三处都能按住拖动：
  - 面板自己的留白（按下的就是面板本身）；
  - 有标题栏时，整条标题栏（原来只有标题文字那一块）；
  - 内容里标了 `data-dialog-drag` 的元素。

  按下的是按钮、输入控件、链接或 `[data-interactive]` 时不拖，这条判断沿用 `useFloatingWindow.startDrag` 现有的。指针捕获从“把手元素”改为面板：有了多处拖动区域后，没有唯一的把手。`dragHandleRef` 随之去掉。拖动区域不改光标；只有标题栏原来的 `cursor-move` 保留。
- **没有标题栏的浮动窗口**：`showHeader=false` 且 `closable` 时，在面板右上角画关闭按钮（绝对定位，与有标题栏时的关闭按钮同一个 `IconButton`、同一个 `request-close('close-button')`）。标题照旧作为对话框的可访问名称，只给读屏。
- **测试**：在 `components.test.ts` 的 Dialog 一节补用例。
  - 拖动：按在留白、标题栏空处、`data-dialog-drag` 区域里都能拖；按在区域里的按钮、输入框上不拖；
  - 没有标题栏时，有关闭按钮、发出 `request-close`，可访问名称仍是标题。
  - 拖动用真实的 pointer 事件派发，量面板的 `left`、`top`。

### `packages/neuro-book/src/plugins/settings/web/components/`：设置窗口

- **`SettingsWindow.vue`**：
  - 用 `:show-header="false"`，标题“设置”只作可访问名称；
  - 左栏顶部（层标签与搜索框所在的那一块的空白）与标题区标 `data-dialog-drag`；
  - 窄窗口两行左栏的第一行同样标。
- **关闭按钮的让位**：关闭按钮在窗口右上角，和标题区那一行同高。
  - 只在会重叠时给标题区右侧让出位置：内容列封顶 720px，窗口宽时列的右边离窗口还远，不用让；窄窗口、fill 页面会重叠，要让。
  - 做法：内容区（左栏右边那一块）设为尺寸容器，标题区右内边距取“关闭按钮占的宽度减去列右边到内容区右边的空隙”，不小于 0。
  - 窄窗口两行左栏的第一行（层标签与搜索框）右侧同样让位。
  - 实现时用 Lab 的 960、1200、1400 宽和 560 窄窗口截图核对。
- **`SettingsSectionHeading.vue`**：标题改用界面字体 `--text-xl`（20px）加粗，行高取整数 28px（与旁边 28px 高的按钮同为偶数，见 design-language“行内的文字块与控件同奇偶”），去掉 26px、32px 两个局部变量与展示字体。标题区根元素标 `data-dialog-drag`。
- `SettingsWindow.md`、`SettingsSectionHeading.md` 随之改外框、拖动与标题的描述。

### `packages/neuro-book/src/ui/settings/`：沿用的行

- **`SettingsRow.vue`**：
  - **沿用时的画法**：状态为 `inherit`（本作品层没写）时，照常经插槽画控件。插槽拿到的值是 `state.inherited`，停用只看 `blocked`；宽控件同样可编辑，原来沿用时停用。
  - **标签**：标题后加一枚描边小标签“来自用户设置”（英文 “From your settings”）。它在生效时机标签之前，样式与填色的 `__applies` 分开；读屏经 `aria-describedby` 念。
  - **删掉的部分**：“沿用用户设置：X”的文字、“单独设置”按钮、`override` 动作、`TEXT.inherit` 与 `TEXT.override`。
  - **不变的部分**：只读的项照旧只写值与锁，沿用时也加标签。
- **写入**：控件改值走调用方原有的写入路径，写到当前标签那一层：
  - 通用列表经窗口模型写当前标签；
  - page 页面经自己的配置服务按 `context.layer` 写。

  所以沿用的行一改就写进本作品层。

  `SettingsListSection` 的“改回层里原来的值时不写”的比较对象：沿用时是下一层的值（`actualValue` 已经这样算），所以只是点一下、不改值，不会写进本作品层。
- **`row-state.ts`**：`inherit` 状态保留，只是画法变了。
- `SettingsRow.md` 随之改。

### `packages/neuro-book/examples/plugins/snippets/`：示例插件

- “常用片段”页现在沿用时控件停用、要点“在本作品里单独设置”。它是 page 页面的教学样板，改成新画法：控件一直在，改了就写进本作品层。
- `SnippetsPage.vue` 的讲解注释、`SnippetsPage.dom.test.ts`、`examples/scenarios/06-settings-page.test.ts` 一起改，场景照旧验证“写本作品层、用户层不变、层之间不合并”。

### Lab 与 e2e

- Lab：设置窗口的场景不加新场景，截图核对外框、拖动区域与沿用标签。`SettingsRowFixture` 与 `scene-settings.ts` 里“单独设置”的说明改成新画法。
- e2e：
  - `settings.e2e.ts` 第 305 行、`plugins.e2e.ts` 第 97 行改为直接改控件；
  - `settings.e2e.ts` 补一步：按住窗口顶上的空白拖动，窗口位置跟着变；按在标题区的按钮上不拖。

## Spec 与文档改动

- `docs/specs/settings/settings-window.md`：输出 3、12、16 已改，标 planned；批准依据已补 t10。实现后去掉 planned，并补证据（新测试）。
- nb-ui：`Dialog.md`（拖动区域、`data-dialog-drag`、没有标题栏时的关闭按钮、浮动窗口圆角）；`authoring-themes.md`、`design-language.md`、`ui-development-spec.md` 里的圆角条目。
- 组件同名 `.md`：`SettingsWindow`、`SettingsSectionHeading`、`SettingsRow`；示例页的讲解。

## 切片

1. **nb-ui**：`--radius-window`、拖动区域、没有标题栏时的关闭按钮。验证：`bun run --cwd packages/nb-ui test`、`typecheck`，`lab-nb-ui.e2e.ts`。
2. **设置窗口外框**：`SettingsWindow` 去掉标题栏、拖动区域、关闭按钮让位，`SettingsSectionHeading` 标题字号。验证：`SettingsWindow.dom.test.ts`、`settings.e2e.ts`（含新补的拖动）、`lab-scenes.e2e.ts`、Lab 截图（四种宽度、窄窗口、深色、macOS）。
3. **沿用的行**：`SettingsRow`、示例插件、相关测试与 e2e。验证：`test:affected --typecheck --with-consumers`，`settings.e2e.ts`、`plugins.e2e.ts`。

收口：全量 e2e，界面实现审查（Sonnet），处理后合入 master，去掉 Spec 的 planned。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `settings.window` 输出 3（标题字号） | Lab 截图核对；字号属外观，不写断言 |
| `settings.window` 输出 12 | `SettingsRow.dom.test.ts`（沿用时有控件与标签、改值写本作品层、移除回到沿用）、`06-settings-page.test.ts`、`settings.e2e.ts` 验收 2 |
| `settings.window` 输出 16（没有标题栏、拖动、关闭） | nb-ui `components.test.ts` Dialog 用例、`SettingsWindow.dom.test.ts`（可访问名称“设置”、关闭按钮）、`settings.e2e.ts` 拖动 |

## 验证

- 每片跑上面列的命令；收口跑全量 e2e 与 `test:affected --since master --typecheck --with-consumers`。
- 真实浏览器：在 Lab 与真实应用里各拖一次：按左栏顶边、标题区空白处、标题文字能拖，按标题区的按钮不拖。截图核对 960、1200、1400 宽与 560 窄窗口下关闭按钮不压内容。
- 未验证边界：触屏拖动（沿用现有的 pointer 事件处理，不另测）。

## 不做与风险

- **不做**：模态对话框的圆角与标题区不动；不加新的设置分区或场景。
- **风险**：
  - 沿用的行一改就写进本作品层，比原来多了误改的可能。“移除本作品的设置”能一键回到沿用，开发者选这个画法时已知。
  - 宽控件（列表）沿用时可直接编辑：第一次改动会把整份列表写进本作品层，层之间不合并，这是现有语义。“常用片段”示例要讲清这一点。
