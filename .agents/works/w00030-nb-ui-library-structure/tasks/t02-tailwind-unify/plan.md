# 实施计划：全仓统一用 Tailwind v4，宿主编译 nb-ui（w00030 t02）

2026-10-20 起草，2026-10-21 开发者确认。总计划见 [t01 的 plan.md](../t01-plan/plan.md) 的 t02 一节；本文件是细化后的实施版本，两者不一致时以本文件为准。

## Context

- **为什么做**：同一页面上并存两套原子 CSS 引擎：neuro-book 用 UnoCSS，ADR 0023 是从旧应用沿用来的；nb-ui、nb-story、dev-panel 用 Tailwind v4。nb-ui 还另发一份不分层的预编译产物 `dist/nb-ui.css`。由此出现了这些症状：
  - L01：组件字号随宿主变。
  - 坑 58：图标尺寸。
  - neuro-book 有一份位移类封禁名单，还有导入顺序约定。
  - nb-story、dev-panel 为了配合 nb-ui，放弃了 Tailwind 的标准分层写法。
  - L18：入库的 86 KB 产物。
- **开发者已定**（2026-10-20）：
  1. 统一用 Tailwind v4。
  2. nb-ui 不发预编译产物，由宿主的 Tailwind 编译 nb-ui 源码。
  3. 旧应用失去样式，不管它。
  4. 宿主自己的 `text-sm` 等从 14px 变成 nb-ui token 的 13px，影响不大，接受。
  5. 实施派 Sonnet 子代理，批量改动写脚本替换，不逐个文件手改。
- **先后**：等 w00027 t07 的 S2a、S2b（nb-ui 的 29 个文件）进 master 后开工；2026-10-21 确认已进 master。开工时先在 master 上重跑下面的“改动面”统计。

### 改动面（2026-10-20 在 master 上实测）

方法：用 neuro-book 现在的 `uno.config.ts` 和 Tailwind v4 分别编译 neuro-book 的源码，按类名对比两份输出。对比脚本是验收工具之一，见“工具”一节。

- **Tailwind 编不出的类**：除 127 个 `i-lucide-*` 图标外，一个都没有。
  - UnoCSS 多出来的 45 个“类”，都是它从源码里宽松抽出的杂词，例如 `h1`、`px`、SVG 路径里的数字、从 `max-w-[420px]` 里截出的 `w-[420px]`，或者来自测试文件。
  - 图标交给 `@iconify/tailwind4`。UnoCSS 的图标规则与 nb-ui 现在的垫片同形（`1em`、遮罩），尺寸不变。
- **改了含义、要替换的类**（Tailwind v3 到 v4 的刻度改名）：

  | 类 | 处数 | 替换为 |
  |---|---|---|
  | `shadow-sm` | 1 | `shadow-xs` |
  | `rounded-sm` | 1 | `rounded-xs` |
  | `outline-none` | 8 | `outline-hidden` |

  其余同名类的值相同，例如 `shadow`、`rounded`、`blur`、`leading-5`。没有不带宽度的 `ring`。UnoCSS 的基础样式没有设缺省边框颜色，所以 v4 的边框颜色变化不影响现状。
- **随 nb-ui token 改变的**：
  - `text-xs`（100 处）、`text-sm`（69 处）改为 12px、13px，行高跟 Tailwind 的配套值。这一条开发者已接受。
  - `font-mono`（18 处）改为 nb-ui 的等宽字体栈。
- **UnoCSS 专有写法**：没有，`@apply`、`theme()` 这类都没用到。接入点只有三处：`uno.config.ts`、`vite.config.ts` 的插件、`src/web/boot.ts` 里的 `virtual:uno.css`。

## 关键设计

### nb-ui 的样式入口（`packages/nb-ui/src/tailwind.css`，导出为 `@notnotype/nb-ui/tailwind.css`）

现在的 `src/tailwind.css` 只用来产出 `dist/nb-ui.css`，改写成给宿主导入的入口：

```css
/* 宿主写法：先 Tailwind 的 theme 与 utilities（要不要 preflight 由宿主定），再本入口 */
@layer theme, base, components, utilities;

@import "./theme.css";                    /* @theme static：与 Tailwind 主题键同名的 nb-ui token */
@import "./tokens.css" layer(base);       /* 其余 token */
@import "./styles.css" layer(components); /* nb-ui 的语义类 */

@source "./components";
@source "./composables";
@source not "./**/*.test.ts";

@plugin "@iconify/tailwind4" { prefixes: lucide; iconSelector: ".i-{prefix}-{name}"; prefix: false; }
@layer base { [class*="i-lucide-"] { /* 现在的遮罩垫片原样搬来 */ } }
```

- **`theme.css`**：把 `tokens.css` 里落在 Tailwind 主题命名空间的 token 搬过来，写成 `@theme static`：`--text-*` 六档、`--leading-tight`、`--leading-ui`、`--leading-reading`、`--font-ui`、`--font-mono`、`--font-display`。
  - 用 `static`，Tailwind 才会把没被工具类用到的变量也输出到 `:root`，组件里直接写 `var(--leading-reading)` 的地方才取得到值。
  - 这样 `text-sm` 明确就是 nb-ui 的 13px，`text-2xs`、`text-md`、`leading-ui` 也成了真的工具类。
  - Tailwind 自己的其余刻度（`text-base`、`leading-relaxed` 等）保留。
- **token 的检查**：`theme/tokens.ts` 的名单和 `tokens.test.ts` 改成从 `theme.css` 加 `tokens.css` 两个文件里读声明。
- **主题包**：`themes/*/vars.css` 照旧不分层，靠 `:root[data-nb-theme]` 的特异性覆盖，分层以后它们仍然赢。
- **分层的效果**：调用方给组件传的原子类在 `utilities` 层，自然压过 `components` 层的语义类。图标垫片的 `width: 1em` 在 `base` 层，输给菜单的图标尺寸。坑 58 的判据随之改写。

### 分层后要换写法的地方（nb-ui 组件）

语义类进 `components` 层之后，与模板里的原子类设同一属性时，改由原子类赢。现在有意靠语义类赢的地方要改写：

- 已知一处：`.nb-ui-control.nb-ui-control-invalid:hover` 要压过 `hover:border-[…]`，见现在 `tailwind.css` 头注释第 2 条。改成在模板里写 `aria-invalid:` 变体。
- 其余由“冲突扫描”脚本找出来，见“工具”一节，逐处列进 Task 记录再改。

### 宿主的写法

- **neuro-book**：
  - `vite.config.ts` 的 `UnoCSS(...)` 换成 `@tailwindcss/vite`。
  - 新文件 `src/web/tailwind.css`，依次导入 `tailwindcss/theme.css`、`tailwindcss/utilities.css`、`@notnotype/nb-ui/tailwind.css`，并写 `@source "../"` 覆盖 `src/`。Vite 的 root 是 `src/web`，自动探测不一定覆盖整个 `src`，所以显式写出来。
  - 不导入 preflight，继续用 `the-new-css-reset`。
  - `boot.ts` 换掉 `virtual:uno.css` 与 nb-ui 的 `styles.css`，导入顺序的注释删掉。
  - 删掉 `uno.config.ts` 与依赖 `unocss`，加 `tailwindcss`、`@tailwindcss/vite`、`@iconify-json/lucide`（版本与 nb-ui 一致）。
  - `build:e2e` 用的构建配置同步改。
- **nb-story、dev-panel**：`app.css` 现在是“preflight 进 base 层、utilities 不分层”的拆分写法，加了自己的图标插件和垫片，另外导入 nb-ui 的产物。改成标准分层：preflight、theme、utilities，再加 nb-ui 入口。自己那份图标插件和垫片删掉。注释里为分层迁就写的说明一并删掉。
- **playground**：`main.css` 改为导入 nb-ui 入口，不再靠 Nuxt 模块注入产物。

### 删掉的东西

- nb-ui：
  - `dist/nb-ui.css`、`build:css` 脚本、`src/dist-css.test.ts`；
  - `package.json` 的 `./styles.css` 导出，加 `./tailwind.css`；
  - Nuxt 模块的 `injectCss` 选项；
  - `token-consumption.test.ts` 与 README 里关于产物的说明。
- neuro-book：`uno.config.ts` 及其中的封禁名单函数、`vite.config.ts` 里 UnoCSS 的注释。

### 滚动条 token（L06，最后一片）

- `tokens.css` 加 `--scrollbar-thumb`、`--scrollbar-thumb-hover`、`--scrollbar-w`。`ScrollArea`、`OverlayScrollbar`、`PopupScrollbar` 都从这里取。
- 加 `.nb-ui-scrollbar-thin`。三个宿主各自手写的 `* { scrollbar-width…; scrollbar-color… }` 改为在根上挂这个类。
- `overlay-scrollbar.ts` 的 `thumbGeometry` 与 `usePopupScroll` 的滑块几何合成一个函数，最短滑块取一个值。

## 工具（主会话先写好，子代理与验收共用；放 `scripts/nb-ui/tailwind-migration/`，Task 完成后删除，不长期入库）

1. **类名对比** `compare-classes.ts`：分别编译 UnoCSS 与 Tailwind 的输出，按类名对比，列出三类：
   - Tailwind 编不出的；
   - 两边都有但声明不同的（只比字号、行高、圆角、阴影、轮廓、滤镜这几类会改观感的属性）；
   - 只有 Tailwind 有的。

   用来在 S3 前后确认改动面没有超出上表。
2. **改名替换** `rename-classes.ts`：
   - 按上表的映射，只在类名出现的位置替换：`class`、`:class` 的字符串、`.ts` 里写类名的字符串。
   - 识别方式：类名前面是引号、空白或变体冒号，后面是引号或空白，不碰 `var(--…)` 与 CSS 文件里的属性值。
   - 先跑 `--dry-run` 列出每一处，核对后再写入。
3. **冲突扫描** `scan-layer-conflicts.ts`：
   - 读 `styles.css` 的语义类各设了哪些属性；
   - 编译出每个组件模板里的原子类各设了哪些属性；
   - 列出同一元素上语义类与原子类设同一属性的地方。这些就是分层后结果会翻转的位置。
4. **截图对照** `shoot-all.ts`：对 Lab 的全部组件场景（nbook、macos 两个主题，明暗各一，900×620）在改前改后各截一套，用 `magick compare -metric AE` 列出有差异的场景与像素数。复用 `scripts/lab-shot.ts` 的打开方式，不另写一套。另外截应用的四个页面：工作台、设置窗口、书架、资源管理器，用 e2e 的启动方式。

## 切片与分工

都在一个 worktree `.worktree/w00030-t02-tailwind`、分支 `refactor/w00030-t02-tailwind` 上依次做。

每片派一个 Sonnet 编码子代理（`coder`，`model: sonnet`），给它本计划、这一片的范围和工具路径。子代理只改代码、跑这一片的自测，不提交。

主会话负责：
- 审 diff，跑验证，提交；
- 下一片派新的子代理；
- 改前的基准截图在 S1 之前由主会话截好。

| 片 | 做什么 | 谁 | 自测 |
|---|---|---|---|
| S0 | 写好工具 1 到 4；在 master 上截改前基准；重跑改动面统计 | 主会话 | 工具在 master 上能跑出上面的数字 |
| S1 | nb-ui 入口、`theme.css`、分层；playground 改用入口；删产物、`build:css`、`dist-css` 测试、`./styles.css` 导出 | 子代理 | nb-ui typecheck、单测、e2e |
| S2 | 冲突扫描列出的地方逐处改写（`invalid` 边框等） | 子代理 | 同上，加 `invalid` 悬停的计算样式断言 |
| S3 | neuro-book 换 Tailwind：插件、入口、依赖，改名脚本替换 | 子代理 | neuro-book typecheck、Vitest；工具 1 的输出只剩上表 |
| S4 | nb-story、dev-panel 改用标准分层加 nb-ui 入口 | 子代理 | 各自 typecheck、单测 |
| S5 | 文档：ADR 0023、neuro-book 的 `AGENTS.md`、`monorepo-boundaries.md`、nb-ui README、`tailwind.css` 头注释、设计文档坑 47、58 与产物一段（`design-language.md` 1116 行附近） | 子代理 | `docs:check`、`governance:check` |
| S6 | 滚动条 token | 子代理 | nb-ui 单测、e2e |
| 收尾 | 改后截图与对照；全量验证；Sonnet 审实现 | 主会话 | 见“验证” |

## 验收

| 行为 | 怎么证明 |
|---|---|
| 页面上只有一个原子 CSS 引擎 | 仓库里没有 `unocss` 依赖与 `uno.config.ts`；nb-ui 不再导出 `./styles.css` |
| 同一组件在各宿主里外观相同 | Lab（neuro-book）与 playground 里读 `IconButton` 字号、`Switch` 滑块位移、`Select` 箭头旋转的计算样式，各一条 e2e 断言 |
| 调用方传的原子类能覆盖组件的语义类 | Lab 里一条计算样式断言（例如给 `Button` 传 `w-full`） |
| 菜单图标是 16px（坑 58） | 现有 Lab e2e 断言原样通过 |
| 出错的输入框悬停时仍是红边框 | S2 新增的计算样式断言 |
| 外观只按预期变化 | 截图对照：有差异的场景逐个看。预期内的差异只有两类：宿主小字从 14px 变 13px，以及上表三处改名；其余差异都要查明 |

## 验证

- **每片**：做上表的自测。
- **收尾**：
  - nb-ui 的 typecheck、单测、e2e；
  - `bun run test:affected --since master --typecheck`；
  - neuro-book 的整套 e2e（跑前停掉多余的开发服务）；
  - nb-story 的 e2e；
  - dev-panel 的单测。
- **审查**：派 Sonnet 审实现，范围是分层与入口的设计、宿主写法、截图对照里的差异。
- **未验证的边界**：旧应用（开发者定不管）。

## 风险

- **`@source` 经 workspace 软链解析的路径**：入口里的相对路径按入口文件的真实位置解析，宿主经 `node_modules` 软链导入时要实测能扫到。S1 用 nb-story 先试，不行就改成宿主自己写 `@source` 指向 nb-ui。
- **Vite 开发模式下 Tailwind 扫描 nb-ui 源码的热更新**：改 nb-ui 组件后宿主页面要跟着更新，S3 手动确认一次。
- **w00027 合入后新写的 neuro-book 界面**：如果 S3 时 w00027 的后续切片还没合入，那些代码合进来时用工具 1、2 再跑一遍。
