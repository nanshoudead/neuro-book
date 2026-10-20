/**
 * 内建控件之间共用的属性（docs/specs/ui/forms.md 输出 22 的自定义控件合同是它的超集）。控件发出
 * `update:modelValue` 就是提交：值或 `CLEAR`；有草稿的控件另外暴露 `commit()` 与 `reset()`。
 *
 * id、说明与出错的关联由字段外壳经 nb-ui 的 `Field` 上下文交给控件，控件不必自己写。
 */

import type {FieldNode} from "../../model";

export interface ControlProps {
    readonly node: FieldNode;
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
