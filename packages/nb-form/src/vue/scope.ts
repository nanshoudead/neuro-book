/**
 * 一张表单（`SchemaForm`）或一个独立字段（`SchemaField`）交给其中每个字段的上下文：当前的根值与改它的入口、模式与
 * 开关、问题、选项源、带外状态，以及字段与草稿的登记。
 *
 * 值的所有权在调用方（docs/specs/ui/forms.md 输出 3）：字段提交时这里用 `setAt` / `removeAt` 算出新的根值交给
 * `emitRoot`，自己不留副本。例外是“同一个任务里的连续提交”（`chained`）与“最近发出的值”（`recent`，列表据此分辨
 * 自己的修改与外部替换）。
 *
 * 字段与草稿按所有者（每个字段组件实例一个 symbol）登记，路径只是它们当前的位置：列表删除、排序时组件跟着项走，
 * 路径随之变化，登记不能按路径记，否则会被移过来的另一项覆盖或删掉（审查 S3 omp 3、10、18）。
 */

import {computed, inject, nextTick, provide, reactive, ref, shallowReactive, toRaw, toValue} from "vue";
import type {ComputedRef, InjectionKey, MaybeRefOrGetter} from "vue";

import type {FieldNode, FormModel} from "../model";
import {itemNode} from "../model";
import type {OptionSource} from "../options";
import {getAt, removeAt, setAt, toPointer} from "../path";
import type {FieldPath} from "../path";
import type {FormIssue, FormMeta} from "../validate";
import {validateForm} from "../validate";
import {isVisible} from "../visible";
import type {FormWidget} from "./widgets";

export type FormMode = "edit" | "view";
export type CommitMode = "change" | "input";
export type FormOptionSources = Readonly<Record<string, MaybeRefOrGetter<OptionSource>>>;

/** 文字、数字、JSON 与自定义控件的草稿状态（输出 15），经 `draft-state` 报给调用方。 */
export interface DraftState {
    readonly path: FieldPath;
    readonly state: "clean" | "dirty" | "unparseable";
    readonly issues: ReadonlyArray<FormIssue>;
}

/** 字段在表单里登记的操作；表单的 `commit()`、`reset()` 与问题的聚焦经它们做到每个字段。 */
export interface FieldHandle {
    /** 聚焦字段的控件；焦点确实进了字段时返回 true。 */
    focus(): boolean;
    /** 把可解析的草稿提交出去；没有草稿的字段什么也不做。草稿不可解析或提交被拒时返回 false。 */
    commit(): boolean;
    /** 丢掉草稿，显示当前值。 */
    reset(): void;
}

/** 一份草稿登记：`problem` 是要显示在字段上的问题码（提交失败过的 `unparseable`，或被拒的 `read-only`）。 */
export interface DraftEntry {
    readonly path: () => FieldPath;
    readonly state: DraftState["state"];
    readonly problem?: "unparseable" | "read-only";
}

/**
 * 能把某个路径打开的容器（折叠的分组、折叠或分页的列表、左列表右详情）：聚焦一条问题时，目标没挂载就请它们打开。
 * 路径在自己里面、而且确实改了状态（展开、翻页、选中）时返回 true。
 */
export type Revealer = (path: FieldPath) => boolean;

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
    /** schema 的问题、调用方的问题与草稿的问题，合在一起（输出 9、14）。 */
    readonly issues: ComputedRef<ReadonlyArray<FormIssue>>;
    /**
     * 要显示的问题：去掉被条件隐藏的字段上的（开发者 2026-10-20 定），必填缺失只在字段碰过、或调用方要求显示全部之后
     * 才算。
     */
    readonly shownIssues: ComputedRef<ReadonlyArray<FormIssue>>;
    /** 调用方要求显示全部问题的次数：问题汇总据此播报问题数。 */
    readonly revealCount: ComputedRef<number>;
    valueAt(path: FieldPath): unknown;
    rootValue(): unknown;
    /** 字段现在能不能改：编辑态、表单不只读不停用、字段自己不只读。 */
    editable(node: FieldNode): boolean;
    /** 提交一个字段的新值；`CLEAR` 按字段清除。字段不可改或修改会动到只读的成员时拒绝，返回 false。 */
    update(node: FieldNode, next: unknown): boolean;
    /** 在一次调用里提交几个字段，只发出一个根值。 */
    batch(run: () => void): void;
    /** 这个路径上的值是不是本表单最近发出的（按内容比）：列表据此分辨成员编辑与外部的整体替换。 */
    emittedRecently(path: FieldPath, value: unknown): boolean;
    source(name: string): OptionSource | undefined;
    setDraft(owner: symbol, draft: DraftEntry): void;
    clearDraft(owner: symbol): void;
    register(owner: symbol, path: () => FieldPath, handle: FieldHandle): void;
    unregister(owner: symbol): void;
    /** 字段失过一次焦点：它的必填缺失从此显示。 */
    touch(owner: symbol): void;
    /** 提交所有可解析的草稿（只发出一个根值）并显示全部问题；有草稿提交不了时返回 false。 */
    commitAll(): boolean;
    /** 丢掉草稿：给了路径只丢那个字段的。 */
    resetAll(path?: FieldPath): void;
    /** 显示全部问题。 */
    revealAll(): void;
    addRevealer(revealer: Revealer): () => void;
    /** 把焦点移到路径上的字段：没挂载时先请容器打开；去不了精确的字段时退到最近的上级。焦点确实移过去时为 true。 */
    focusPath(path: FieldPath): Promise<boolean>;
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

/**
 * 字段当前的路径，内容不变时保持同一个数组。列表每次渲染都给项一个新的节点对象，路径数组也是新的；问题与“碰过”
 * 按路径算，若跟着数组的身份变，列表一渲染问题就“变了”，列表又因问题变了重新渲染，循环不止。
 */
export function stablePath(path: () => FieldPath): ComputedRef<FieldPath> {
    return computed((previous?: FieldPath) => {
        const next = path();
        return previous !== undefined && samePath(previous, next) ? previous : next;
    });
}

/** 按 JSON 写法比较内容；写不成 JSON（循环引用、BigInt）的值不是表单发出的，算不同。 */
export function sameContent(left: unknown, right: unknown): boolean {
    if (Object.is(toRaw(left), toRaw(right))) return true;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

/** 路径上的每一层字段都显示着：任何一层被条件隐藏，这个路径就看不见。 */
function pathVisible(root: FieldNode, value: unknown, path: FieldPath): boolean {
    let node: FieldNode | undefined = root;
    for (const segment of path) {
        node = typeof segment === "number" ? (node.item === undefined ? undefined : itemNode(node, segment)) : node.children.find((child) => child.path[child.path.length - 1] === segment);
        if (node === undefined) return true;
        if (!isVisible(node, value)) return false;
    }
    return true;
}

/** 修改会不会动到只读的成员：对象成员逐个比，列表项里的成员按下标比（结构上增删项不算）。 */
function touchesReadOnly(node: FieldNode, before: unknown, after: unknown): boolean {
    for (const child of node.children) {
        const key = child.path[child.path.length - 1] as string;
        const from = getAt(before, [key]);
        const to = getAt(after, [key]);
        if (child.readOnly && !sameContent(from, to)) return true;
        if (!child.readOnly && touchesReadOnly(child, from, to)) return true;
    }
    if (node.item !== undefined && Array.isArray(before) && Array.isArray(after)) {
        const length = Math.min(before.length, after.length);
        for (let index = 0; index < length; index += 1) {
            const item = itemNode(node, index)!;
            if (item.readOnly ? !sameContent(before[index], after[index]) : touchesReadOnly(item, before[index], after[index])) return true;
        }
    }
    return false;
}

/** 最近发出的根值留几份：异步写回时调用方可能一次传回较早的那份。 */
const RECENT_LIMIT = 16;

interface FieldRecord {
    readonly path: () => FieldPath;
    readonly handle: FieldHandle;
}

export function createFormScope(input: FormScopeInput): FormScope {
    const model = computed(input.model);
    const meta = computed(input.meta);
    const mode = computed(input.mode);
    const formReadonly = computed(input.readonly);
    const formDisabled = computed(input.disabled);
    const fields = shallowReactive(new Map<symbol, FieldRecord>());
    const touched = shallowReactive(new Set<symbol>());
    const drafts = shallowReactive(new Map<symbol, DraftEntry>());
    /** 每份草稿最后一次报给调用方的样子：只在变化时发 `draft-state`，换了路径时先在旧路径上报干净。 */
    const reported = new Map<symbol, {readonly pointer: string; readonly path: FieldPath; readonly state: DraftState["state"]; readonly problem?: string}>();
    const revealed = ref(false);
    const revealCount = ref(0);
    const revealers = new Set<Revealer>();
    const selections = reactive(new Map<string, number>());

    /**
     * 同一个任务里接连两次提交（例如 `commit()` 一次提交几个草稿，或回车提交后紧接着失焦）时，调用方还没来得及把
     * 第一次的新值传回来：第二次要在第一次的结果上改，否则第一次的修改会丢。所以记住最近发出的根值，到下一个微任务
     * 清掉；那时 Vue 已经把调用方更新后的值传进来（它的更新排在我们之前的微任务里），调用方没采纳时则回到传入的值。
     */
    let chained: {readonly value: unknown} | null = null;
    let batching: {value: unknown} | null = null;
    const recent: unknown[] = [];
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
        recent.push(next);
        if (recent.length > RECENT_LIMIT) recent.shift();
        input.emitRoot(next);
    }

    const editable = (node: FieldNode) => mode.value === "edit" && !formReadonly.value && !formDisabled.value && !node.readOnly;

    function problemIssue(path: FieldPath, problem: NonNullable<DraftEntry["problem"]>): FormIssue {
        return {path, code: problem, params: {}, severity: "error", source: "schema"};
    }

    function reportDraft(owner: symbol): void {
        const draft = drafts.get(owner);
        const previous = reported.get(owner);
        const path = draft?.path() ?? previous?.path ?? [];
        const pointer = toPointer(path);
        const state = draft?.state ?? "clean";
        const problem = draft?.problem;
        if (previous !== undefined && previous.pointer === pointer && previous.state === state && previous.problem === problem) return;
        if (previous !== undefined && previous.pointer !== pointer && previous.state !== "clean") {
            input.emitDraft({path: previous.path, state: "clean", issues: []});
        }
        if (previous === undefined && state === "clean") return;
        input.emitDraft({path, state, issues: problem === undefined ? [] : [problemIssue(path, problem)]});
        if (state === "clean") reported.delete(owner);
        else reported.set(owner, {pointer, path, state, ...(problem === undefined ? {} : {problem})});
    }

    const schemaIssues = computed(() => validateForm(model.value, input.value(), {meta: meta.value}));
    const draftIssues = computed(() => [...drafts.values()].flatMap((draft) => (draft.problem === undefined ? [] : [problemIssue(draft.path(), draft.problem)])));
    const issues = computed<ReadonlyArray<FormIssue>>(() => [...schemaIssues.value, ...input.issues(), ...draftIssues.value]);
    const touchedPointers = computed(() => new Set([...touched].flatMap((owner) => {
        const field = fields.get(owner);
        return field === undefined ? [] : [toPointer(field.path())];
    })));
    const shownIssues = computed(() => issues.value.filter((issue) => {
        if (!pathVisible(model.value.root, input.value(), issue.path)) return false;
        return revealed.value || issue.code !== "required" || issue.source !== "schema" || touchedPointers.value.has(toPointer(issue.path));
    }));

    function handleAt(path: FieldPath): FieldHandle | undefined {
        const pointer = toPointer(path);
        for (const field of fields.values()) if (toPointer(field.path()) === pointer) return field.handle;
        return undefined;
    }

    function batch(run: () => void): void {
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
    }

    function revealAll(): void {
        revealed.value = true;
        revealCount.value += 1;
    }

    return {
        locale: computed(input.locale),
        mode,
        readonly: formReadonly,
        disabled: formDisabled,
        commitMode: computed(input.commit),
        revision: computed(input.revision),
        meta,
        model,
        widgets: computed(input.widgets),
        issues,
        shownIssues,
        revealCount: computed(() => revealCount.value),
        valueAt: (path) => getAt(input.value(), path),
        rootValue: () => input.value(),
        editable,
        update(node, next) {
            if (!editable(node)) return false;
            const current = base();
            const before = getAt(current, node.path);
            // 传回来的值可能是调用方 `ref()` 里的响应式代理，按原始对象比。
            if (next !== CLEAR && Object.is(toRaw(before), toRaw(next))) return true;
            const result = next !== CLEAR ? setAt(current, node.path, next) : node.nullable ? setAt(current, node.path, null) : removeAt(current, node.path);
            if (touchesReadOnly(node, before, getAt(result, node.path))) return false;
            if (!Object.is(result, current)) emit(result);
            return true;
        },
        batch,
        emittedRecently: (path, value) => recent.some((root) => sameContent(getAt(root, path), value)),
        source: (name) => {
            const source = input.options()[name];
            return source === undefined ? undefined : toValue(source);
        },
        setDraft(owner, draft) {
            const existing = drafts.get(owner);
            if (draft.state === "clean" && draft.problem === undefined) {
                if (existing !== undefined) drafts.delete(owner);
            } else if (existing === undefined || existing.state !== draft.state || existing.problem !== draft.problem) {
                drafts.set(owner, draft);
            }
            reportDraft(owner);
        },
        clearDraft(owner) {
            drafts.delete(owner);
            reportDraft(owner);
        },
        register(owner, path, handle) {
            fields.set(owner, {path, handle});
        },
        unregister(owner) {
            fields.delete(owner);
            touched.delete(owner);
        },
        touch(owner) {
            touched.add(owner);
        },
        commitAll() {
            revealAll();
            let ok = true;
            batch(() => {
                for (const field of [...fields.values()]) if (!field.handle.commit()) ok = false;
            });
            return ok;
        },
        resetAll(path) {
            for (const field of [...fields.values()]) if (path === undefined || samePath(field.path(), path)) field.handle.reset();
        },
        revealAll,
        addRevealer(revealer) {
            revealers.add(revealer);
            return () => revealers.delete(revealer);
        },
        async focusPath(path) {
            // 一层一层地打开：分组展开后里面的列表才挂载，列表翻页后项才挂载。层数不会超过路径的长度。
            for (let attempt = 0; attempt <= path.length + 1; attempt += 1) {
                const handle = handleAt(path);
                if (handle !== undefined) return handle.focus();
                let opened = false;
                for (const revealer of [...revealers]) opened = revealer(path) || opened;
                if (!opened) break;
                await nextTick();
            }
            for (let length = path.length - 1; length >= 0; length -= 1) {
                const handle = handleAt(path.slice(0, length));
                if (handle !== undefined) return handle.focus();
            }
            return false;
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
