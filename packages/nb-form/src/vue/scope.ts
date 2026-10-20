/**
 * 一张表单（`SchemaForm`）或一个独立字段（`SchemaField`）交给其中每个字段的上下文：当前的根值与改它的入口、模式与
 * 开关、问题、选项源、带外状态，以及字段的登记（聚焦、提交草稿、丢掉草稿）。
 *
 * 值的所有权在调用方（docs/specs/ui/forms.md 输出 3）：字段提交时这里用 `setAt` / `removeAt` 算出新的根值交给
 * `emitRoot`，自己不留副本。唯一的例外是“同一个任务里的连续提交”，见 `createFormScope` 里的 `chained`。
 */

import {computed, inject, provide, reactive, ref, shallowRef, toRaw, toValue} from "vue";
import type {ComputedRef, InjectionKey, MaybeRefOrGetter} from "vue";

import type {FieldNode, FormModel} from "../model";
import type {OptionSource} from "../options";
import {getAt, removeAt, setAt, toPointer} from "../path";
import type {FieldPath} from "../path";
import type {FormIssue, FormMeta} from "../validate";
import {validateForm} from "../validate";
import type {FormWidget} from "./widgets";

export type FormMode = "edit" | "view";
export type CommitMode = "change" | "input";
export type FormOptionSources = Readonly<Record<string, MaybeRefOrGetter<OptionSource>>>;

/** 文字、数字、JSON 字段的草稿状态（输出 15），经 `draft-state` 报给调用方。 */
export interface DraftState {
    readonly path: FieldPath;
    readonly state: "clean" | "dirty" | "unparseable";
    readonly issues: ReadonlyArray<FormIssue>;
}

/** 字段在表单里登记的操作；表单的 `commit()`、`reset()` 与问题的聚焦经它们做到每个字段。 */
export interface FieldHandle {
    focus(): void;
    /** 把可解析的草稿提交出去；没有草稿的字段什么也不做。草稿不可解析时返回 false。 */
    commit(): boolean;
    /** 丢掉草稿，显示当前值。 */
    reset(): void;
}

/** 清除一个字段：可为 null 的写 `null`，其余删去这个键（输出 4）。 */
export const CLEAR = Symbol("nb-form-clear");

export interface FormScopeInput {
    readonly model: () => FormModel;
    readonly value: () => unknown;
    readonly emitRoot: (next: unknown) => void;
    readonly emitDraft: (state: DraftState) => void;
    readonly mode: () => FormMode;
    readonly readonly: () => boolean;
    readonly disabled: () => boolean;
    readonly commit: () => CommitMode;
    readonly revision: () => number;
    readonly locale: () => string;
    readonly issues: () => ReadonlyArray<FormIssue>;
    readonly meta: () => FormMeta;
    readonly options: () => FormOptionSources;
    readonly widgets: () => ReadonlyArray<FormWidget>;
    /** 调用方用 `v-model:selected` 接管的左列表右详情（只有 `SchemaField` 的根）；其余的选中项由表单自己记。 */
    readonly selected?: {readonly pointer: string; get(): number | undefined; set(index: number): void};
}

/** 左列表右详情的选中项。 */
export interface Selection {
    get(): number;
    set(index: number): void;
}

export interface FormScope {
    readonly locale: ComputedRef<string>;
    readonly mode: ComputedRef<FormMode>;
    readonly readonly: ComputedRef<boolean>;
    readonly disabled: ComputedRef<boolean>;
    readonly commitMode: ComputedRef<CommitMode>;
    readonly revision: ComputedRef<number>;
    readonly meta: ComputedRef<FormMeta>;
    readonly model: ComputedRef<FormModel>;
    readonly widgets: ComputedRef<ReadonlyArray<FormWidget>>;
    /** schema 的问题、调用方的问题与已经报出的草稿问题，合在一起（输出 9、14）。 */
    readonly issues: ComputedRef<ReadonlyArray<FormIssue>>;
    /** 要显示的问题：必填缺失只在字段碰过、或调用方要求显示全部之后才算（见 `touch`）。 */
    readonly shownIssues: ComputedRef<ReadonlyArray<FormIssue>>;
    valueAt(path: FieldPath): unknown;
    rootValue(): unknown;
    /** 提交一个字段的新值；`CLEAR` 按字段清除。 */
    update(node: FieldNode, next: unknown): void;
    /** 在一次调用里提交几个字段，只发出一个根值。 */
    batch(run: () => void): void;
    source(name: string): OptionSource | undefined;
    reportDraft(state: DraftState): void;
    register(pointer: string, handle: FieldHandle): () => void;
    handle(pointer: string): FieldHandle | undefined;
    handles(): ReadonlyArray<FieldHandle>;
    /** 字段失过一次焦点：它的必填缺失从此显示。 */
    touch(pointer: string): void;
    /** 显示全部问题（调用方提交、或要求聚焦第一条问题时）。 */
    revealAll(): void;
    selection(pointer: string): Selection;
}

const FORM_SCOPE_KEY: InjectionKey<FormScope> = Symbol("nb-form-scope");

export function provideFormScope(scope: FormScope): void {
    provide(FORM_SCOPE_KEY, scope);
}

export function useFormScope(): FormScope {
    const scope = inject(FORM_SCOPE_KEY, null);
    if (scope === null) throw new Error("nb-form 的字段只能放在 SchemaForm 或 SchemaField 里");
    return scope;
}

function samePath(left: FieldPath, right: FieldPath): boolean {
    return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function issuesAt(issues: ReadonlyArray<FormIssue>, path: FieldPath): FormIssue[] {
    return issues.filter((issue) => samePath(issue.path, path));
}

/** 路径上与它下面的问题（折叠的分组、列表在头部标“含 N 个问题”）。 */
export function issuesUnder(issues: ReadonlyArray<FormIssue>, path: FieldPath): FormIssue[] {
    return issues.filter((issue) => issue.path.length >= path.length && path.every((segment, index) => issue.path[index] === segment));
}

export function createFormScope(input: FormScopeInput): FormScope {
    const model = computed(input.model);
    const meta = computed(input.meta);
    const drafts = shallowRef<ReadonlyMap<string, DraftState>>(new Map());
    const touched = ref<ReadonlySet<string>>(new Set());
    const revealed = ref(false);
    const handles = new Map<string, FieldHandle>();
    const selections = reactive(new Map<string, number>());

    /**
     * 同一个任务里接连两次提交（例如 `commit()` 一次提交几个草稿，或回车提交后紧接着失焦）时，调用方还没来得及把
     * 第一次的新值传回来：第二次要在第一次的结果上改，否则第一次的修改会丢。所以记住最近发出的根值，到下一个微任务
     * 清掉；那时 Vue 已经把调用方更新后的值传进来（它的更新排在我们之前的微任务里），调用方没采纳时则回到传入的值。
     */
    let chained: {readonly value: unknown} | null = null;
    let batching: {value: unknown} | null = null;
    const base = (): unknown => (batching !== null ? batching.value : chained !== null ? chained.value : input.value());

    function emit(next: unknown): void {
        if (batching !== null) {
            batching.value = next;
            return;
        }
        chained = {value: next};
        void Promise.resolve().then(() => {
            chained = null;
        });
        input.emitRoot(next);
    }

    const schemaIssues = computed(() => validateForm(model.value, input.value(), {meta: meta.value}));
    const draftIssues = computed(() => [...drafts.value.values()].flatMap((draft) => draft.issues));
    const issues = computed<ReadonlyArray<FormIssue>>(() => [...schemaIssues.value, ...input.issues(), ...draftIssues.value]);
    const shownIssues = computed(() => (revealed.value
        ? issues.value
        : issues.value.filter((issue) => issue.code !== "required" || issue.source !== "schema" || touched.value.has(toPointer(issue.path)))));

    return {
        locale: computed(input.locale),
        mode: computed(input.mode),
        readonly: computed(input.readonly),
        disabled: computed(input.disabled),
        commitMode: computed(input.commit),
        revision: computed(input.revision),
        meta,
        model,
        widgets: computed(input.widgets),
        issues,
        shownIssues,
        valueAt: (path) => getAt(input.value(), path),
        rootValue: () => input.value(),
        update(node, next) {
            const current = base();
            // 传回来的值可能是调用方 `ref()` 里的响应式代理，按原始对象比。
            if (next !== CLEAR && Object.is(toRaw(getAt(current, node.path)), toRaw(next))) return;
            const result = next !== CLEAR ? setAt(current, node.path, next) : node.nullable ? setAt(current, node.path, null) : removeAt(current, node.path);
            if (!Object.is(result, current)) emit(result);
        },
        batch(run) {
            if (batching !== null) {
                run();
                return;
            }
            const start = base();
            batching = {value: start};
            try {
                run();
            } finally {
                const result = batching.value;
                batching = null;
                if (result !== start) emit(result);
            }
        },
        source: (name) => {
            const source = input.options()[name];
            return source === undefined ? undefined : toValue(source);
        },
        reportDraft(state) {
            const pointer = toPointer(state.path);
            const previous = drafts.value.get(pointer);
            if (previous !== undefined && previous.state === state.state && previous.issues.length === state.issues.length) return;
            const next = new Map(drafts.value);
            if (state.state === "clean") next.delete(pointer);
            else next.set(pointer, state);
            drafts.value = next;
            input.emitDraft(state);
        },
        register(pointer, handle) {
            handles.set(pointer, handle);
            return () => {
                if (handles.get(pointer) === handle) handles.delete(pointer);
            };
        },
        handle: (pointer) => handles.get(pointer),
        handles: () => [...handles.values()],
        touch(pointer) {
            if (touched.value.has(pointer)) return;
            touched.value = new Set([...touched.value, pointer]);
        },
        revealAll() {
            revealed.value = true;
        },
        selection(pointer) {
            const owned = input.selected;
            if (owned !== undefined && owned.pointer === pointer) return {get: () => owned.get() ?? selections.get(pointer) ?? 0, set: (index) => {
                selections.set(pointer, index);
                owned.set(index);
            }};
            return {get: () => selections.get(pointer) ?? 0, set: (index) => selections.set(pointer, index)};
        },
    };
}
