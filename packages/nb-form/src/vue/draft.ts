/**
 * 文字、数字、JSON 控件的草稿与提交时机（docs/specs/ui/forms.md 输出 15、16 与“状态与转换”）。
 *
 * 控件显示的是草稿，没有草稿时显示当前值。草稿在提交成功、外部值或 `revision` 变化（且字段没有焦点）、`reset()`、
 * 字段变得不可改（只读、停用、展示态）时丢掉。不可解析的草稿提交失败过一次以后，才报出 `unparseable` 问题：用户
 * 敲到一半的 `-` 不该马上标红。提交被拒（会改到只读的成员）时草稿留着，报 `read-only`。
 *
 * 草稿按本控件的所有者 token 登记在表单上（见 `scope.ts` 模块头），路径随列表项移动；卸载时无条件注销。
 */

import {computed, onBeforeUnmount, ref, watch} from "vue";

import type {FieldNode} from "../model";
import type {FormScope} from "./scope";
import {CLEAR, stablePath} from "./scope";

export type ParseResult = {readonly ok: true; readonly value: unknown} | {readonly ok: false};

export interface DraftCodec {
    format(value: unknown): string;
    /** 草稿换成值；`CLEAR` 表示清除这个字段。 */
    parse(text: string): ParseResult;
}

export interface DraftOptions {
    readonly node: () => FieldNode;
    readonly value: () => unknown;
    readonly codec: DraftCodec;
    readonly scope: FormScope;
}

export function useDraft(options: DraftOptions) {
    const {scope, codec} = options;
    const owner = Symbol("nb-form-draft");
    const path = stablePath(() => options.node().path);
    const draft = ref<string | null>(null);
    /** `input` 模式下草稿已随输入提交：显示仍用草稿（`1.50` 不被改写成 `1.5`），状态算干净。 */
    const synced = ref(false);
    /** 提交失败过（解析不了或被拒）：问题从此显示，直到草稿改了或被丢掉。 */
    const failed = ref<"unparseable" | "read-only" | null>(null);
    const focused = ref(false);

    const text = computed(() => draft.value ?? codec.format(options.value()));
    const parsed = computed<ParseResult | null>(() => (draft.value === null ? null : codec.parse(draft.value)));

    function drop(): void {
        draft.value = null;
        synced.value = false;
        failed.value = null;
    }

    function submit(value: unknown): boolean {
        return scope.update(options.node(), value);
    }

    function input(next: string): void {
        draft.value = next;
        synced.value = false;
        failed.value = null;
        const result = parsed.value;
        if (scope.commitMode.value === "input" && result?.ok === true) synced.value = submit(result.value);
    }

    /** 提交草稿；不可解析或被拒时保留草稿并报出问题，返回 false。 */
    function commit(): boolean {
        const result = parsed.value;
        if (result === null) return true;
        if (!result.ok) {
            failed.value = "unparseable";
            return false;
        }
        if (!synced.value && !submit(result.value)) {
            failed.value = scope.editable(options.node()) ? "read-only" : null;
            if (failed.value === null) drop();
            return false;
        }
        drop();
        return true;
    }

    watch([options.value, scope.revision], () => {
        if (!focused.value) drop();
    });
    // 变得不可改时丢掉草稿：留着的草稿以后经 `commit()` 或失焦写出去，就绕过了只读（审查 S3 omp 9）。
    watch(() => scope.editable(options.node()), (editable) => {
        if (!editable) drop();
    });

    const state = computed(() => (draft.value === null || synced.value ? "clean" : parsed.value?.ok === true ? "dirty" : "unparseable"));
    watch([state, failed, path], () => {
        scope.setDraft(owner, {path: () => path.value, state: state.value, ...(failed.value === null ? {} : {problem: failed.value})});
    });
    onBeforeUnmount(() => scope.clearDraft(owner));

    return {
        text,
        focused,
        input,
        commit,
        reset: drop,
        clear: () => {
            drop();
            submit(CLEAR);
        },
    };
}

/** JSON：两格缩进写出；清空了的可选字段算清除，写坏了的算不可解析。 */
export function jsonCodec(node: () => FieldNode): DraftCodec {
    return {
        format: (value) => (value === undefined ? "" : JSON.stringify(value, null, 2)),
        parse: (text) => {
            if (text.trim() === "") return node().required && !node().nullable ? {ok: false} : {ok: true, value: CLEAR};
            try {
                return {ok: true, value: JSON.parse(text) as unknown};
            } catch {
                // 写坏的 JSON 是草稿的正常状态，按不可解析报出（输出 15），不是程序错误。
                return {ok: false};
            }
        },
    };
}

/** 文字：草稿原样就是值。 */
export const TEXT_CODEC: DraftCodec = {
    format: (value) => (value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value)),
    parse: (text) => ({ok: true, value: text}),
};

/** 十进制写法；`1.`、`-`、`1e`、`0x10`、`Infinity` 都不算（输出 15）。 */
const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** 数字：清空了的可选字段算清除，必填字段算不可解析。整数字段写了小数照常提交，由校验报 `type`。 */
export function numberCodec(node: () => FieldNode): DraftCodec {
    return {
        format: (value) => (value === undefined || value === null ? "" : String(value)),
        parse: (text) => {
            const trimmed = text.trim();
            if (trimmed === "") return node().required && !node().nullable ? {ok: false} : {ok: true, value: CLEAR};
            if (!NUMBER_PATTERN.test(trimmed)) return {ok: false};
            const value = Number(trimmed);
            return Number.isFinite(value) ? {ok: true, value} : {ok: false};
        },
    };
}
