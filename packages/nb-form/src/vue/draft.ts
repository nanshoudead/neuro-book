/**
 * 文字、数字（以后还有 JSON）控件的草稿与提交时机（docs/specs/ui/forms.md 输出 15、16 与“状态与转换”）。
 *
 * 控件显示的是草稿，没有草稿时显示当前值。草稿在提交成功、外部值或 `revision` 变化（且字段没有焦点）、`reset()`
 * 时丢掉。不可解析的草稿提交失败过一次以后，才报出 `unparseable` 问题：用户敲到一半的 `-` 不该马上标红。
 */

import {computed, onBeforeUnmount, ref, watch} from "vue";

import type {FieldNode} from "../model";
import type {FormIssue} from "../validate";
import type {FormScope} from "./scope";
import {CLEAR} from "./scope";

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
    /** 提交一个值（或 `CLEAR`）。 */
    readonly emit: (value: unknown) => void;
}

export function useDraft(options: DraftOptions) {
    const {scope, codec} = options;
    const draft = ref<string | null>(null);
    /** `input` 模式下草稿已随输入提交：显示仍用草稿（`1.50` 不被改写成 `1.5`），状态算干净。 */
    const synced = ref(false);
    /** 不可解析的草稿提交失败过：问题从此显示，直到草稿可以解析或被丢掉。 */
    const attempted = ref(false);
    const focused = ref(false);

    const text = computed(() => draft.value ?? codec.format(options.value()));
    const parsed = computed<ParseResult | null>(() => (draft.value === null ? null : codec.parse(draft.value)));

    function drop(): void {
        draft.value = null;
        synced.value = false;
        attempted.value = false;
    }

    function input(next: string): void {
        draft.value = next;
        synced.value = false;
        const result = parsed.value;
        if (result?.ok === true) attempted.value = false;
        if (scope.commitMode.value === "input" && result?.ok === true) {
            options.emit(result.value);
            synced.value = true;
        }
    }

    /** 提交草稿；不可解析时保留草稿并报出问题，返回 false。 */
    function commit(): boolean {
        const result = parsed.value;
        if (result === null) return true;
        if (!result.ok) {
            attempted.value = true;
            return false;
        }
        if (!synced.value) options.emit(result.value);
        drop();
        return true;
    }

    watch([options.value, scope.revision], () => {
        if (!focused.value) drop();
    });

    const state = computed(() => (draft.value === null || synced.value ? "clean" : parsed.value?.ok === true ? "dirty" : "unparseable"));
    watch([state, attempted], () => {
        const node = options.node();
        const issues: FormIssue[] = state.value === "unparseable" && attempted.value
            ? [{path: node.path, code: "unparseable", params: {}, severity: "error", source: "schema"}]
            : [];
        scope.reportDraft({path: node.path, state: state.value, issues});
    });

    // 字段卸载（布局或描述变了）时撤掉它报过的草稿问题，汇总里不留一条找不到字段的“无法解析”。
    onBeforeUnmount(() => {
        if (state.value !== "clean") scope.reportDraft({path: options.node().path, state: "clean", issues: []});
    });

    return {
        text,
        focused,
        input,
        commit,
        reset: drop,
        clear: () => {
            drop();
            options.emit(CLEAR);
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
