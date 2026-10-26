# t04 计划：NeuroBook 主题字号恢复大一档

## Context

开发者 2026-10-22 看 w00027 t06 的设置界面时觉得字小。实测（三个版本同一浏览器逐元素量）：t80 至今设置界面字号、字重、字体文件都没变，Tailwind 重构也没改字号；字小来自 2026-09-01 的 `14b316ee2`：NeuroBook 主题从“比 macOS 大一档”收回 macOS 档（界面正文 14px 收成 13px），当时的理由只有“目测 macOS 那档更好看”。开发者 2026-10-22 定：恢复那次之前的一档。

| 档 | 现在 | 改成 |
|---|---|---|
| `--text-2xs` / `xs` / `sm` / `md` / `lg` / `xl` | 10 / 11 / 13 / 13 / 15 / 19px | 11 / 12 / 14 / 14 / 16 / 20px |
| `--control-h-sm` / `md` / `lg` | 26 / 32 / 40px | 28 / 34 / 42px |

行高 1.5、字距 0 不变（它们是汉字的约束，不是密度偏好）。只改 NeuroBook 主题；macOS、aurora、editorial 主题的刻度不变。

完成后 w00027 t06 合入 master 的这次改动，在新字号上重出设置界面设计稿（紧凑度与字重层级），t06 不在本 Task 里改。

依据：`packages/nb-ui/docs/design-language.md` 的“三、几何”；`packages/nb-ui/docs/ui-development-spec.md` 的 Button、Select 两节写了字面尺寸；没有产品 Spec 写字号，行为合同不变。

## 技术选型

无。

## 关键设计

### `packages/nb-ui/themes/nbook/vars.css`

改上表九个值；注释改写成当前的决定与理由（汉字占满 em 框，同 px 下比拉丁文挤；2026-09-01 收回过一次，2026-10-22 开发者看实际界面后恢复），不保留来回的过程。

### nb-ui 组件里写死的字号与高度

`Button`、`ToggleGroup`、`Select`、`Menubar`、`SegmentedControl`、`Badge`、`Kbd`、`SuggestionMenu` 的尺寸档用字面像素（例如 Button 的 `h-[26px] text-[12px]` / `h-[32px] text-[13px]` / `h-[38px] text-[14px]`），不随主题变，换刻度后会和周围差一档。改成引用 token：

- 字号：按“今天 NeuroBook 主题下等值的那一档”换，换完在当前刻度下像素不变，换刻度后一起长一档：13px → `sm`，11px → `xs`，10px → `2xs`，14px → `md`。12px 今天没有等值档，逐处判断，缺省归 `xs`（新刻度下 12px，不变）。写法用 `text-[length:var(--text-*)]`（t81 定的写法，token 扫描规则 5 已检查）或 Tailwind 工具类 `text-xs` 这类。
- 控件高度：Button 的三档高度改用 `--control-h-sm/md/lg`；Select、ToggleGroup 已用 `nb-ui-control-h-*` 的不动。
- `styles.css` 里 `.nb-ui-menu-item` 等处写死的 12px、11px 同样处理；`tokens.css` 的 `--menu-item-font: 13px` 改为 `var(--text-sm)`，`--menu-item-h` 在 NeuroBook 主题里随控件高度加 2px。

其它主题受的影响：字面像素换成 token 后，macOS 主题下 12px 的几处会变成它的 `xs`（11px）。逐处在 Lab 里看 macOS 主题的截图，确实变差的改用别的档。

防回归：`token-consumption.test.ts` 加规则 7，nb-ui 组件里禁止 `text-[<数字>px]` 与 `font-size: <数字>px`，带正反样例；确有理由的字面量（例如角标里的 10px 计数）用行内豁免注释写明理由。

### 应用里写死的字号（`packages/neuro-book/src`）

约 30 个文件，按同一条换算规则处理，分三类：

- **界面文字**（资源管理器行、编辑器页签与面包屑、标题栏、提示条、`ui/JsonViewer` 等）：换成 token。资源管理器行现在写死 13px（t80 时是 14px），换成 `sm` 后回到 14px；`ExplorerTree` 的 `FALLBACK_ROW_HEIGHT = 26` 按新行高核对。
- **展示排版**（书架、欢迎页、书卡的大标题与衬线字）：只换其中的小号说明文字；标题与展示字号是版式的一部分，保留字面值。
- **阅读字号**（Markdown 编辑区 17px、提示词编辑器等）：由编辑器偏好承载，不动。
- Lab 自己的外壳与夹具（`plugins/lab/`）：按同一规则换，开发工具，不逐张截图核对。

### 其它用 NeuroBook 主题的宿主

开发者面板（`packages/dev-panel`）与剧情图谱查看器（`packages/nb-story`）也用这个主题，会一起变大。不改代码，截首页与主要视图各一张核对没有溢出，问题记入本 Task 再定。

## 文档改动

- `packages/nb-ui/docs/design-language.md` 的“三、几何”：表里的字号与控件高度，以及“后来收回同档”那段改成现在的决定。
- `packages/nb-ui/docs/ui-development-spec.md`：Button、Select、弹出列表行写字面像素的几处改成写档名（`sm` 档、`--text-sm`），不再写数字。
- 改到的组件同名 `.md` 里写了像素的地方一并改。

## 切片

1. **S1 nb-ui**：主题刻度、组件与 `styles.css` 的字面量、`--menu-item-*`、规则 7、两份文档。验证：nb-ui `bun run test`、`typecheck`；nb-ui 演练场与应用 Lab 里 nbook、macOS 两个主题各截一轮组件场景。
2. **S2 应用**：`packages/neuro-book/src` 的字面量按三类处理；`lab-nb-ui.e2e.ts` 里断言 13px 的一条改成断言等于 `--text-sm` 的计算值。验证：`bun run test:affected --typecheck --with-consumers`；`lab-scenes.e2e.ts`（全部场景无越界、无被裁）。
3. **S3 收口**：全量 e2e；工作台、书架、设置窗口、Lab 与开发者面板、剧情图谱查看器各截改前改后对照，发到本 Task 的评审板（一道确认题），开发者看过再合入。

每片单独提交。实现审查（前端，Sonnet）在 S3 之前做，处理完再发评审板。

## 验收映射

没有 Spec 条目；验收按下面几条：

- NeuroBook 主题下界面正文 14px、控件 28/34/42px：S1 Lab 截图与 `lab-nb-ui.e2e.ts`。
- nb-ui 组件里没有字面像素字号：规则 7。
- 全部 Lab 场景无越界、无被裁：`lab-scenes.e2e.ts`。
- 其余行为不变：全量 e2e。

## 验证

上面各片的命令；开发服务与截图用 `nbdev dev start`、`nbdev shot`。未验证边界：Windows 与 macOS 上的实际观感（只在本机 Linux Chrome 上看）。

## 不做与风险

- 不做：其它主题的刻度；阅读区字号；设置界面的密度与字重层级（w00027 t06 在新字号上重出设计稿）。
- 风险：这七周的界面都按 13px 调，窄处（活动栏、状态栏、页签、设置左栏）可能放不下，靠 `lab-scenes` 与对照截图找，找到的在 S2、S3 里修。
- 风险：w00027 分支改过 `SegmentedControl.vue`（t06 的表单合同），本 Task 也改它的字号写法；t06 合 master 时可能冲突，范围小。
