---
标签: [state:local]
---

# CheckboxGroup

`CheckboxGroup` 将一组选项作为一个多选值管理，适合一组可同时勾选的相关选项。它把每项交给 `Checkbox` 呈现，允许逐项描述和禁用；与单个复选框相比，它额外提供组级方向、选项集合与数组模型。

## 布局

默认纵向排列，项间距 12px；可切换为水平排列，空间不足时换行。每项的标签、可选说明和复选框由 `Checkbox` 布局。组件宽度由内容与父容器决定。

## 交互

- 点击选项切换该项值，发出包含完整选中 value 集合的 `update:modelValue`。组的选择顺序按添加顺序保留，取消选择移除对应 value。
- `disabled` 禁用整组；选项自身也可通过 `disabled` 禁用。
- 每个选项使用 `Checkbox` 的原生 checkbox 输入和标签；箭头键是否形成跨选项组导航未由本包装保证。焦点离开组后的去向由调用方决定。
- 组根是 `role="group"`。放在 `Field` 的组形态里时，组根读字段上下文：`id`、`aria-labelledby`（字段标签）、`aria-describedby` 与出错时的 `aria-invalid` 都标在组上；组里的每个 `Checkbox` 看不到字段上下文（组用 null 盖住它），不会都拿到字段的 id、各自标红（docs/specs/ui/forms.md 输出 27）。

## 数据

```ts
interface CheckboxOption {
    /** 在选中值数组中的稳定标识。 */
    value: string;
    /** 可见标签，也是子复选框的标签文本。 */
    label: string;
    /** 可选的次级说明文字。 */
    description?: string;
    /** 是否禁用该项；默认 false。 */
    disabled?: boolean;
}

interface CheckboxGroupProps {
    /** 选中值数组；传入时受控，默认 undefined。 */
    modelValue?: string[];
    /** 非受控初始值；默认空数组。不给 modelValue 时组件按它起步并自己记选中的值。 */
    defaultValue?: string[];
    /** 选项列表；默认空数组。 */
    options?: CheckboxOption[];
    /** 排列方向；默认 "vertical"。 */
    orientation?: "horizontal" | "vertical";
    /** 禁用全部选项；默认 false。 */
    disabled?: boolean;
    /** 出错：aria-invalid 写在组上，组里每个框只描红；默认 false，与 Field 上下文的出错取或。 */
    invalid?: boolean;
    /** 只读：可以聚焦、写 aria-readonly，交互不改值；默认 false（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
}

interface CheckboxGroupEmits {
    /** 选中值集合变化时发出；受控模式下父组件应更新 modelValue。 */
    (event: "update:modelValue", value: string[]): void;
}

interface CheckboxGroupSlots {}
```

组件没有 expose API，也没有自定义插槽。未声明 attrs 按 Vue 默认行为继承到根 CheckboxGroupRoot。

## 状态与边界

- 默认选中数组为空、无选项、纵向且启用。
- 组禁用时所有选项禁用；单项禁用由选项字段控制。
- 空列表不渲染选项。
- **只读**（`readonly`）：每个复选框写 `aria-readonly`、点击不切换；组上不写（`group` 角色不支持 `aria-readonly`）。
- **出错**（`invalid` 或 Field 的出错）：组上写 `aria-invalid`，每个框描红但不各自写 `aria-invalid`。
- **没给 `modelValue`**：选中的值记在组件里（初值是 `defaultValue`），勾第二项时发出的数组含两项。
- 没有独立的加载状态。

## 不支持

- 不提供“全选”、分组标题、选项自定义 slot 或混合/半选组状态。
- 不对选项 value 去重；重复 value 会共享相同选中身份，应由调用方提供唯一值。

## 上游边界

Reka UI `CheckboxGroupRoot` 提供组级原语；各选项的呈现与逐项选择由本组件及 `Checkbox` 完成。键盘与焦点细节没有在本包装中另外实现，不作超出原生 checkbox 交互的承诺。
