import {inject} from "vue";
import type {ComputedRef, InjectionKey} from "vue";

export type FieldContext = {
    inputId: ComputedRef<string | undefined>;
    descriptionId: ComputedRef<string | undefined>;
    errorId: ComputedRef<string | undefined>;
    ariaDescribedby: ComputedRef<string | undefined>;
    required: ComputedRef<boolean>;
    invalid: ComputedRef<boolean>;
};

export const NB_FIELD_CONTEXT_KEY: InjectionKey<FieldContext> = Symbol("nb-field-context");

export function useFieldContext(): FieldContext | null {
    return inject(NB_FIELD_CONTEXT_KEY, null);
}
