/**
 * 内建控件之间共用的属性（docs/specs/ui/forms.md 输出 22 的自定义控件合同是它的超集）。控件发出
 * `update:modelValue` 就是提交：值或 `CLEAR`；有草稿的控件另外暴露 `commit()` 与 `reset()`。
 *
 * id、说明与出错的关联由字段外壳经 nb-ui 的 `Field` 上下文交给控件，控件不必自己写。
 */

import type {BuiltinWidget, FieldNode} from "../../model";

export interface ControlProps {
    readonly node: FieldNode;
    /**
     * 实际用的内建画法。控件按它分派，不读 `node.widget`：描述里写了没登记的自定义控件名时，`node.widget` 还是那个名字，
     * 实际画法是退回的内建控件（审查 S3 omp 11）。
     */
    readonly widget: BuiltinWidget;
    readonly modelValue: unknown;
    readonly readonly: boolean;
    readonly disabled: boolean;
    readonly invalid: boolean;
    readonly locale: string;
}

export interface DraftControl {
    /** 提交可解析的草稿；不可解析时返回 false。 */
    commit(): boolean;
    reset(): void;
}
