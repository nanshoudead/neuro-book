---
标签: [state:local, state:inject, env:clipboard, env:portal]
---

# SchemaForm

`SchemaForm` 按一份数据 schema 画出整张表单：调用方交出 TypeBox（标准 JSON Schema）描述与当前值，表单按描述给每个字段选控件、显示与编辑值、标出问题，值由调用方保管。设置、nbdev 的提问、Agent 的提问与审批、命令参数共用它。行为合同是 [`docs/specs/ui/forms.md`](../../../../docs/specs/ui/forms.md)，本文只写组件层面的布局、交互与接口。

## 布局

- 根是 `role="group"` 的竖排容器，不是 `<form>`：回车不隐式提交，可以放进调用方自己的 `<form>`。
- 字段按布局排：没给布局时按根对象的属性顺序排成一列；`row` 横排，放不下时换行，每项至少 160px；`group` 是一段带标题的竖排。布局指向的字段不存在时不画。
- 每个字段是一个外壳：标题行（标签、必填的 `*`、“默认”标记、警告图标、右端的“清除”），下面是控件，再下面是说明。开关的控件排在标题行里。数字的单位画在输入框右边。
- 底部一行问题汇总，一直占位（没有问题时是空的一行）：字段出错时排版不跳。
- 控件的宽度随容器；`390×844` 下同样一列，横排按宽度换行，不出横向滚动。

## 交互

- **选控件**：按 Spec 输出 2，单选 3 项以内是横排单选组，多于 3 项是下拉，多于 15 项或 `searchable` 是可搜索的下拉；布尔是开关，`confirm` 是“是 / 否”；多选是复选组；文字是单行，`multiline` 是多行；数字是数字输入。`writeOnly` 与 `secret` 的字段现在按单行文字画（密钥输入随凭据存储再做）。对象、列表与 JSON 字段本片还不画（随结构控件接入）。
- **提交**：开关与选择类选了就提交；文字与数字在失焦或回车时提交（多行里回车是换行，只在失焦时）。`commit="input"` 时每次输入提交。每次提交发出一个新的根值，未改动的分支保留原引用。
- **草稿**：`1.`、`-` 这类解析不了的数字不提交；失焦或回车失败一次以后，字段标出错、汇总里列出“无法解析”。可选数字清空后离开是清除这个字段，必填的算解析不了。外部的值或 `revision` 变化时，没有焦点的字段丢掉草稿。
- **清除**：可选字段有值时标题行右端有“清除”（读屏名称“清除：<标签>”），删去这个键；可为 null 的写 `null`；必填字段没有。
- **问题**：字段只标出错（`aria-invalid` 与红框），第一条错误的文字经 `aria-describedby` 给读屏；警告不标出错，标题旁一个警告色的图标，文字同样给读屏。必填缺失在字段失过一次焦点、或调用方调用了 `commit()`、`focusIssue`、`focusFirstIssue()` 之后才显示；其余问题一直显示。
- **问题汇总**：一行“N 个问题”（有错误时是出错色，只有警告时是警告色），按下展开列表，每条写“标签：原因”，按字段在表单里的先后排；点一条把焦点移到那个字段，并发出 `focus-issue`。
- **选项**：动态选项加载中时字段停用、占位写“加载中…”；不可用时停用，原因写在说明里。当前值不在动态选项里时照常显示为“值（已不存在）”，标题旁有警告图标，值保留。
- **条件显示**：`visibleWhen` 不满足的字段隐藏且 `inert`，不卸载：值、草稿与控件自己的状态在重新显示后还在。
- **展示态**（`mode="view"`）：不画控件，每个字段画成静态文字；布尔写“是 / 否”，选择类写选项名，数字带单位，密钥只写“已设置 / 未设置”。超过 6 行或 400 字的文字先折叠，下面有“展开”；文字类字段有“复制”。Tab 只停在这两种按钮上。
- 焦点：表单自己不在挂载时抢焦点；`focusIssue`、`focusFirstIssue()` 与汇总里的一条把焦点交给字段的控件（组合控件交给组里当前的 Tab 停靠点）。

## 数据

```ts
type SchemaFormProps = {
    /** 数据 schema；界面提示写在 `x-form` 里（Spec“输入与前置条件”）。 */
    schema: object;
    /** 布局；缺省按根对象的属性顺序排成一列。 */
    layout?: FormLayout;
    /** 受控的根值；表单从不修改它，提交时发出新值。 */
    modelValue?: unknown;
    /** 显示语言：内建文字与 `FormText` 按它取，没有时取 en-US。必填。 */
    locale: string;
    /** 缺省 "edit"。 */
    mode?: "edit" | "view";
    /** 向下传给每个字段；缺省 false。 */
    readonly?: boolean;
    disabled?: boolean;
    /** 调用方算好的问题（跨字段、异步、服务端），与 schema 的问题一起显示；缺省空。 */
    issues?: ReadonlyArray<FormIssue>;
    /** 按 JSON Pointer 给出值之外的状态，例如密钥是否已设置；缺省空。 */
    meta?: FormMeta;
    /** 动态选项源，键是 `x-form.options` 写的名字；可以是 ref 或 getter。缺省空。 */
    options?: Readonly<Record<string, MaybeRefOrGetter<OptionSource>>>;
    /** 缺省 "change"。 */
    commit?: "change" | "input";
    /** 写入被拒、值没变时加一：没有焦点的字段回到实际值。缺省 0。 */
    revision?: number;
    /** 底部的问题汇总；缺省 true。 */
    summary?: boolean;
};

type SchemaFormEmits = {
    /** 一次提交发出一个新的根值。 */
    "update:modelValue": [value: unknown];
    /** 文字、数字字段的草稿状态变了（干净、改过、解析不了）。 */
    "draft-state": [state: {path: ReadonlyArray<string | number>; state: "clean" | "dirty" | "unparseable"; issues: ReadonlyArray<FormIssue>}];
    /** 表单因为一条问题把焦点移到了它的字段。 */
    "focus-issue": [issue: FormIssue];
};

type SchemaFormExpose = {
    /** 提交所有可解析的草稿（合成一个根值发出）并显示全部问题；有解析不了的草稿时返回 false。 */
    commit(): boolean;
    /** 丢掉草稿；给了路径只丢那个字段的。 */
    reset(path?: ReadonlyArray<string | number>): void;
    /** 聚焦到路径上第一条问题的字段。 */
    focusIssue(path: ReadonlyArray<string | number>): void;
    /** 聚焦到排在最前的问题；没有问题时返回 false。 */
    focusFirstIssue(): boolean;
};
```

没有插槽。attrs 落在根元素上。每个字段的根带 `data-nb-widget="<控件名>"`，汇总行带 `data-nb-form-summary="none" | "warning" | "error"`，调用方的测试可以据此定位，不必另加钩子。

## 状态

- **默认**：按描述画出每个字段。
- **缺值**：不补默认值。文字与数字的占位写“默认：X”；选择类不预选，标题旁写“默认：X”；开关显示默认的状态，标题旁标“默认”。
- **出错**：见“交互”的问题与汇总。
- **只读**：控件可以聚焦、可以选中复制，不能改；没有“清除”。`readOnly` 的字段与父级 `readOnly` 下的字段同样只读。
- **停用**：控件停用，不进 Tab 顺序；没有“清除”。
- **加载中、不可用**：只作用在有动态选项的字段上，见“交互”。
- **空描述**：根对象没有属性时只有汇总行。

## 不支持

- 对象、字符串列表、对象列表、JSON 字段与自定义控件（随结构控件接入；在那之前这些字段不画）。
- 布局分组的折叠。
- 字段之间除条件显示以外的联动；表单自己取选项或做异步校验。
- 密钥输入（`SecretInput`）：凭据存储搁置期间按单行文字画。

## 上游边界

控件来自 nb-ui（`Switch`、`RadioGroup`、`CheckboxGroup`、`Select`、`SearchSelect`、`Input`、`Textarea`、`NumberInput`），它们的键盘、指针与浮层行为以各自的文档为准；本组件承诺的是选哪个控件、传什么值、何时提交与问题怎样显示。

## 隐藏通道理由

- `state:local`：草稿、字段是否碰过、汇总是否展开与展示态的折叠在组件内，卸载即丢。
- `state:inject`：表单把值、问题与选项的上下文交给其中的字段，字段的外壳再给 nb-ui 控件提供 `Field` 的上下文；都只在这棵组件树里，不读外部的注入。
- `env:clipboard`：展示态的“复制”写系统剪贴板；写不了时按钮写“复制失败”，文字仍可选中复制。
- `env:portal`：下拉与可搜索下拉的列表由 nb-ui 传送到 `body`，见它们的文档。
