---
标签: [state:local, state:inject, env:clipboard, env:portal]
---

# SchemaField

`SchemaField` 按一份 schema 画一个字段，值就是这个字段的值。它和 [`SchemaForm`](SchemaForm.md) 里的每个字段是同一套外壳与控件，适合每个值单独摆放的地方，例如设置窗口的一行：`bare` 时只画控件，标签、说明与“恢复默认”由那一行画。行为合同见 [`docs/specs/ui/forms.md`](../../../../docs/specs/ui/forms.md)。

## 布局

不加 `bare` 时与 `SchemaForm` 里的一个字段相同：标题行、控件、说明。加 `bare` 时只有控件（数字带单位），宽度随容器；调用方用 [`widgetLayout`](layout.ts) 决定控件排在标签右边还是另起一块、占哪一档宽度。

## 交互

控件选择、提交时机、草稿、问题的标记与展示态都与 `SchemaForm` 相同（见它的“交互”）。另外：

- 字段就是根：它的路径是空的，没有“清除”（可为 null 的除外，清除写 `null`），标题旁不画必填的 `*`。
- `bare` 时名字来自调用方：单个控件用调用方的 `<label for="<id>">`，组合控件（单选组、复选组、确认）经 `labelledby` 指向调用方的标签元素。出错的文字照样经 `aria-describedby` 给读屏。
- 没有问题汇总；看得见的问题文字由调用方放在自己的固定位置。

## 数据

```ts
type SchemaFieldProps = {
    schema: object;
    /** 盖过 schema 里 `x-form` 的同名提示。 */
    hints?: FormHints;
    /** 受控的字段值。 */
    modelValue?: unknown;
    locale: string;
    /** 控件的 id；缺省生成。`bare` 时调用方的 `<label for>` 指向它。 */
    id?: string;
    /** 只画控件；缺省 false。 */
    bare?: boolean;
    /** `bare` 时组合控件的名字来源：调用方标签元素的 id。 */
    labelledby?: string;
    // 以下与 SchemaForm 相同。
    mode?: "edit" | "view";
    readonly?: boolean;
    disabled?: boolean;
    issues?: ReadonlyArray<FormIssue>;
    meta?: FormMeta;
    options?: Readonly<Record<string, MaybeRefOrGetter<OptionSource>>>;
    commit?: "change" | "input";
    revision?: number;
};

type SchemaFieldEmits = {
    /** 提交出字段的新值。 */
    "update:modelValue": [value: unknown];
    "draft-state": [state: {path: ReadonlyArray<string | number>; state: "clean" | "dirty" | "unparseable"; issues: ReadonlyArray<FormIssue>}];
};

type SchemaFieldExpose = {
    /** 提交可解析的草稿；解析不了时返回 false。 */
    commit(): boolean;
    reset(): void;
    focus(): void;
};
```

没有插槽。attrs 落在字段的根元素上，根带 `data-nb-widget="<控件名>"`。

## 状态

与 `SchemaForm` 的一个字段相同（缺值、出错、只读、停用、加载中、不可用）。

## 不支持

- 对象、列表、JSON 与自定义控件（随结构控件接入）。
- 问题汇总与布局。

## 隐藏通道理由

与 `SchemaForm` 相同：草稿与折叠在组件内（`state:local`）；给其中的外壳与 nb-ui 控件提供上下文（`state:inject`）；展示态的“复制”写剪贴板（`env:clipboard`）；下拉列表由 nb-ui 传送到 `body`（`env:portal`）。
