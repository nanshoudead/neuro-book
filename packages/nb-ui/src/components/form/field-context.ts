import {inject} from "vue";
import type {ComputedRef, InjectionKey} from "vue";

/**
 * `Field` 交给后代控件的可访问性上下文（docs/specs/ui/forms.md 输出 26、27）。单个控件用 `inputId` 与 `<label for>`
 * 对上；组合控件（单选组、复选组）的根不是可标注的元素，用 `labelId` 写 `aria-labelledby`。
 */
export type FieldContext = {
    inputId: ComputedRef<string | undefined>;
    /** 标签元素的 id；没有标签时为 undefined。 */
    labelId: ComputedRef<string | undefined>;
    descriptionId: ComputedRef<string | undefined>;
    errorId: ComputedRef<string | undefined>;
    ariaDescribedby: ComputedRef<string | undefined>;
    required: ComputedRef<boolean>;
    invalid: ComputedRef<boolean>;
};

/**
 * 值可以是 null：组合控件用 null 盖住它给子项的上下文，免得组里的每个复选框都拿到字段的 id、各自标红（输出 27）。
 */
export const NB_FIELD_CONTEXT_KEY: InjectionKey<FieldContext | null> = Symbol("nb-field-context");

export function useFieldContext(): FieldContext | null {
    return inject(NB_FIELD_CONTEXT_KEY, null);
}
