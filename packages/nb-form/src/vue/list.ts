/**
 * 列表编辑的共用逻辑（docs/specs/ui/forms.md 输出 19、20 与“时序与寿命”）：字符串列表、对象列表与左列表右详情都用它。
 *
 * - 身份：每项一个稳定的 id，与值并行维护，`v-for` 按它作 key，所以删除与排序后每项的草稿、控件状态跟着项走。
 *   增删排序时新的 id 列表排进“待采纳”队列，等调用方把那个数组传回来才换上；传回来的往往不是同一个对象（`ref()` 的
 *   代理、经过 JSON 或一次 RPC 的副本），所以按内容比。认领到第几条，它之前的几条就作废（调用方采纳了更新的结果）。
 *   调用方没采纳时 id 不动。
 * - 退回：调用方先采纳了一次增删排序（例如先显示写入中的值），随后又传回采纳之前的数组（写入失败），换回那时的 id，
 *   播报“没有生效”；焦点所在的元素因此不被卸载（审查 S5 Sonnet 2）。
 * - 其它变化：本表单最近发出过的值（成员编辑）且长度没变时保留 id；否则是外部的整体替换，重建 id、待采纳全部作废
 *   （审查 S3 omp 5、6）。
 * - 焦点：增删排序的落点（Spec 输出 19）跟待采纳记在一起，采纳、渲染之后才移。
 * - 超过 `FOLD_LIMIT` 项先折叠成“N 项”，展开后按 `PAGE_SIZE` 分页；页码随列表变短收回范围。
 * - 按钮与 `Alt+↑ / ↓` 走同一个入口，控件给的附加步骤（左列表右详情调整选中）两条路都执行（审查 S3 omp 16）。
 */

import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import type {Ref} from "vue";

import type {FieldNode} from "../model";
import type {FieldPath} from "../path";
import {messagesFor} from "./messages";
import type {FormScope} from "./scope";
import {issuesAt, sameContent} from "./scope";

export const FOLD_LIMIT = 50;
export const PAGE_SIZE = 50;

/** 一次增删排序的附加步骤；都在调用方采纳以后跑。 */
export interface ListHooks {
    /** 渲染前：换上 id 的同时。 */
    readonly adopt?: () => void;
    /** 取代缺省的焦点落点，渲染后跑。 */
    readonly focus?: () => void;
}

export interface ListOptions {
    readonly node: () => FieldNode;
    readonly value: () => unknown;
    readonly locale: () => string;
    readonly scope: FormScope;
    readonly editable: () => boolean;
    /** 提交新的数组。 */
    readonly emit: (next: unknown[]) => void;
    /** 列表的根元素：焦点落点在它里面找。 */
    readonly root: Readonly<Ref<HTMLElement | null>>;
    /** 新项的初值。 */
    readonly blank: () => unknown;
    /** 控件给的附加步骤：`add` 收新项的下标，`remove` 收删掉的下标，`move` 收原下标与方向。 */
    readonly hooks?: {
        readonly add?: (index: number) => ListHooks;
        readonly remove?: (index: number) => ListHooks;
        readonly move?: (index: number, delta: -1 | 1) => ListHooks;
    };
    /** 聚焦问题时要露出第 `index` 项（左列表右详情选中它）；改了状态时返回 true。 */
    readonly reveal?: (index: number) => boolean;
}

export interface ListEntry {
    readonly id: string;
    readonly index: number;
    readonly value: unknown;
}

/** 列表里按钮的标记：焦点按它找“同类控件”。 */
export type ListAction = "select" | "up" | "down" | "remove";

let sequence = 0;
const newId = (): string => {
    sequence += 1;
    return `item-${String(sequence)}`;
};

const FOCUSABLE = "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex='0']";

/** `Alt+↑ / ↓` 不在这些元素上截获：多行文字里它是移到段首段尾，组合框里 `Alt+↓` 是打开列表（审查 S3 Sonnet 13）。 */
const KEEPS_ALT_ARROWS = "textarea, select, [role='combobox']";

interface Pending {
    readonly array: ReadonlyArray<unknown>;
    readonly ids: string[];
    /** 提交时的数组与 id：调用方退回时换回它们。 */
    readonly before: {readonly array: ReadonlyArray<unknown>; readonly ids: string[]};
    readonly adopt?: () => void;
    readonly focus: () => void;
}

export function useList(options: ListOptions) {
    const items = computed<ReadonlyArray<unknown>>(() => {
        const value = options.value();
        return Array.isArray(value) ? value : [];
    });
    const ids = ref<string[]>(items.value.map(newId));
    let pending: Pending[] = [];
    /** 最近采纳的一次增删排序之前的样子；之后的任何别的变化都让它作废。 */
    let reverting: Pending["before"] | null = null;
    watch(items, (next) => {
        const matched = pending.findIndex((record) => sameContent(next, record.array));
        if (matched !== -1) {
            const record = pending[matched]!;
            pending = pending.slice(matched + 1);
            reverting = record.before;
            ids.value = record.ids;
            record.adopt?.();
            void nextTick(record.focus);
            return;
        }
        const before = reverting;
        reverting = null;
        if (before !== null && sameContent(next, before.array)) {
            ids.value = before.ids;
            pending = [];
            announce(messages.value.notApplied);
            return;
        }
        if (next.length === ids.value.length && options.scope.emittedRecently(options.node().path, next)) return;
        ids.value = next.map(newId);
        pending = [];
    });

    /** 播报的文字与序号：同一句话连着出现两次时序号让节点换新，读屏再念一次（审查 S3 Sonnet 11）。 */
    const announcement = ref({text: "", sequence: 0});
    const announce = (text: string) => {
        announcement.value = {text, sequence: announcement.value.sequence + 1};
    };
    const expanded = ref(false);
    const page = ref(0);
    const messages = computed(() => messagesFor(options.locale()));
    const schema = computed(() => options.node().schema);
    const minItems = computed(() => (typeof schema.value.minItems === "number" ? schema.value.minItems : 0));
    const maxItems = computed(() => (typeof schema.value.maxItems === "number" ? schema.value.maxItems : Number.POSITIVE_INFINITY));
    const canAdd = computed(() => options.editable() && items.value.length < maxItems.value);
    const canRemove = computed(() => options.editable() && items.value.length > minItems.value);

    const folded = computed(() => items.value.length > FOLD_LIMIT && !expanded.value);
    const pageCount = computed(() => Math.max(1, Math.ceil(items.value.length / PAGE_SIZE)));
    watch(pageCount, (count) => {
        if (page.value > count - 1) page.value = count - 1;
    });
    const entries = computed<ListEntry[]>(() => items.value.map((value, index) => ({id: ids.value[index] ?? `item-at-${String(index)}`, index, value})));
    const visible = computed(() => {
        if (items.value.length <= FOLD_LIMIT) return entries.value;
        if (!expanded.value) return [];
        return entries.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE);
    });

    /** 重复的项：取核心 `unique-items` 问题给出的下标，与校验的等值判定一致（审查 S3 omp 13）。 */
    const duplicates = computed(() => {
        const marked = new Set<number>();
        for (const issue of issuesAt(options.scope.issues.value, options.node().path)) {
            if (issue.code !== "unique-items" || !Array.isArray(issue.params.duplicateItems)) continue;
            for (const index of issue.params.duplicateItems) if (typeof index === "number") marked.add(index);
        }
        return marked;
    });

    /** 让第 `index` 项出现在页面上（展开、翻页）；改了状态时返回 true。 */
    function showItem(index: number): boolean {
        if (items.value.length <= FOLD_LIMIT) return false;
        const target = Math.floor(index / PAGE_SIZE);
        if (expanded.value && page.value === target) return false;
        expanded.value = true;
        page.value = target;
        return true;
    }

    const removeRevealer = options.scope.addRevealer((path: FieldPath) => {
        const base = options.node().path;
        if (path.length <= base.length || !base.every((segment, at) => path[at] === segment)) return false;
        const index = path[base.length];
        if (typeof index !== "number" || index >= items.value.length) return false;
        const shown = showItem(index);
        return (options.reveal?.(index) ?? false) || shown;
    });
    onBeforeUnmount(removeRevealer);

    function submit(next: unknown[], nextIds: string[], message: string, focus: () => void, adopt?: () => void): void {
        pending.push({array: next, ids: nextIds, before: {array: items.value, ids: ids.value}, focus, ...(adopt === undefined ? {} : {adopt})});
        announce(message);
        options.emit(next);
    }

    const itemElement = (id: string) => options.root.value?.querySelector<HTMLElement>(`[data-nb-list-item="${id}"]`) ?? null;
    const actionIn = (id: string, action: ListAction) => itemElement(id)?.querySelector<HTMLElement>(`[data-nb-list-action="${action}"]:not([disabled])`) ?? null;
    const addButton = () => options.root.value?.querySelector<HTMLElement>("[data-nb-list-add]") ?? null;
    const firstControl = (id: string) => itemElement(id)?.querySelector("[data-nb-list-body]")?.querySelector<HTMLElement>(FOCUSABLE) ?? null;

    function add(): void {
        if (!canAdd.value) return;
        const id = newId();
        const index = items.value.length;
        const next = [...items.value, options.blank()];
        const hooks = options.hooks?.add?.(index) ?? {};
        submit(next, [...ids.value, id], messages.value.added(next.length), hooks.focus ?? (() => firstControl(id)?.focus()), () => {
            showItem(index);
            hooks.adopt?.();
        });
    }

    function remove(index: number): void {
        if (!canRemove.value || index < 0 || index >= items.value.length) return;
        const nextIds = ids.value.filter((_, at) => at !== index);
        const neighbourIndex = index < nextIds.length ? index : index - 1;
        const hooks = options.hooks?.remove?.(index) ?? {};
        submit(items.value.filter((_, at) => at !== index), nextIds, messages.value.removed(index + 1), hooks.focus ?? (() => {
            const neighbour = nextIds[neighbourIndex];
            (neighbour === undefined ? addButton() : actionIn(neighbour, "remove") ?? itemElement(neighbour))?.focus();
        }), () => {
            // 邻项可能在另一页：先翻过去，渲染后再移焦点。
            if (neighbourIndex >= 0) showItem(neighbourIndex);
            hooks.adopt?.();
        });
    }

    function move(index: number, delta: -1 | 1): void {
        const target = index + delta;
        if (!options.editable() || target < 0 || target >= items.value.length) return;
        const action: ListAction = delta < 0 ? "up" : "down";
        const swap = <T>(list: ReadonlyArray<T>): T[] => {
            const copy = [...list];
            [copy[index], copy[target]] = [copy[target] as T, copy[index] as T];
            return copy;
        };
        const id = ids.value[index] as string;
        const active = document.activeElement;
        const hooks = options.hooks?.move?.(index, delta) ?? {};
        submit(swap(items.value), swap(ids.value), messages.value.moved(index + 1, target + 1), hooks.focus ?? (() => {
            // 焦点跟着被移动的项：原来就在这一项里的元素还在就留在它上面（`v-for` 移动节点时可能丢焦点），否则落到同一个
            // 按钮上；它到了边界停用了，落到另一个方向的按钮上。
            if (active instanceof HTMLElement && itemElement(id)?.contains(active) && active.isConnected && !active.hasAttribute("disabled")) {
                active.focus();
                return;
            }
            (actionIn(id, action) ?? actionIn(id, action === "up" ? "down" : "up"))?.focus();
        }), () => {
            showItem(target);
            hooks.adopt?.();
        });
    }

    /**
     * `Alt+↑ / ↓` 移动焦点所在的项。挂在项根的捕获阶段并停止传播：项里的数字框自己也处理方向键（步进），冒泡阶段再排序
     * 时数字已经被改了（审查 S3 omp 17）。
     */
    function onItemKeydownCapture(event: KeyboardEvent, index: number): void {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        if (event.target instanceof Element && event.target.closest(KEEPS_ALT_ARROWS) !== null) return;
        event.preventDefault();
        event.stopPropagation();
        move(index, event.key === "ArrowUp" ? -1 : 1);
    }

    return {
        items,
        entries,
        visible,
        folded,
        expanded,
        page,
        pageCount,
        duplicates,
        canAdd,
        canRemove,
        announcement,
        add,
        remove,
        move,
        onItemKeydownCapture,
        itemElement,
    };
}
