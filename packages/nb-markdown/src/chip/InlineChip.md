---
标签: []
别名: ["小块", "引用小块", "Inline Chip"]
---

# InlineChip

与正文同一行高的行内小块：引用、技能、选区、命令、图片 `#N`、文件 `#N`、粘贴位置 `#N`，以及还没上传完的图片或文件。写给 Agent 的编辑组件（[ui.prompt-editor](../../../../docs/specs/ui/prompt-editor.md)）与已发送消息的静态显示用它；Markdown 编辑器与展示器里外部链接以外的链接画成同样的小块（文字仍是链接本身，见“注意事项”）。它只负责画，小块代表什么、点了以后做什么由调用方决定。

## 布局与交互

- 与正文同一行高的行内块：图标加文字，名称过长时截断（最宽 16rem），悬停提示与可访问名称给出全称。
- 图标与色调：
  - 引用按宿主的目标分类取（`env`，[workspace.markdown-dialect](../../../../docs/specs/workspace/markdown-dialect.md) 输出 27）：文件按文件名取宿主给的文件图标（neuro-book 是作品里的文件与用户资产）；附件是回形针，外部链接是地球，其它是链接符号并用次级色。色调类是 `nb-chip--<细分>`，宿主没给细分时是类别本身。
  - 选区、技能、命令各有图标；命令用强调色加粗，技能用警示色。
  - 图片、文件、位置标记只显示图标加 `#N`，用信息色；位置标记用次级色。
- 上传中的附件把图标换成转圈（减少动效时不转）；失败的用危险色，悬停提示带失败原因。
- 悬停时描边与底色加深；`highlighted` 时再加一圈 2px 的光晕，用于和附件条里同号的卡片、同号的粘贴块联动。`selected` 时画成选中样子（浏览器不给不可编辑的行内块画选中底色）。
- 文字不可选中，复制时由调用方决定写出什么。点击发出 `activate`，鼠标进出发出 `hover`。
- `interactive` 为真时是可聚焦的按钮（`role="button"`、`tabindex="0"`），回车或空格发出 `activate`，键盘聚焦时画焦点框；用在已发送消息这类静态显示里。编辑器里保持为假：小块在可编辑区域里，光标跨过它而不是聚焦它。
- 只用主题 token，明暗两态都由 token 给出；390px 窄屏下照样按 16rem 与容器宽度中较小者截断。

## 数据

```ts
type InlineChipKind = "reference" | "skill" | "selection" | "command" | "image" | "file" | "paste";

interface InlineChipProps {
    /** 必填。 */
    kind: InlineChipKind;
    /** 宿主的目标分类与文件图标（`ChipEnv`）；默认只认外部链接、文件图标是通用的文件图标。不 inject：调用它的组件从宿主取了传下来。 */
    env?: ChipEnv;
    /** 界面语言：悬停提示与可访问名称的文字。必填。 */
    locale: MarkdownLocale;
    /** 引用名称、技能名、命令名、文件名或选区显示名；图片与位置标记不用。默认空字符串。 */
    label?: string;
    /** 引用目标，决定引用的图标与色调；悬停提示里也会写出。默认空字符串。 */
    target?: string;
    /** 目标所在文件的地址，交给宿主的分类解析相对地址；默认 null。 */
    base?: string | null;
    /** 图片、文件、位置标记的编号；默认 null。 */
    number?: number | null;
    /** 附件的上传状态；默认 "ready"。 */
    state?: "ready" | "uploading" | "failed";
    /** state 为 failed 时的原因，写进悬停提示；默认空字符串。 */
    error?: string;
    /** 默认 false。 */
    highlighted?: boolean;
    /** 默认 false。 */
    selected?: boolean;
    /** 可用键盘聚焦与触发；默认 false。 */
    interactive?: boolean;
}

interface InlineChipEmits {
    (e: "activate"): void;
    (e: "hover", active: boolean): void;
}
```

没有 slot 与 expose。根元素带 `data-inline-chip="<kind>"`；未声明的 attribute 落到根元素上。

## 注意事项

- 外观的判断（图标、色调、文字、悬停提示）在 `chip.ts`，样式在 `chip.css`：编辑器里链接的装饰与展示器的静态视图是普通 DOM，挂不了组件，它们用同一份判断与样式画出同样的小块。改外观改这两个文件，不在组件里另写。
- 编辑器与展示器里的链接不是这个组件：链接的文字要能编辑、能被批注盖住一部分，外框画在文字上（`chip.css` 的 `nb-chip-link`），图标是文字前面的部件。
