/**
 * 列表编辑的共用逻辑（docs/specs/ui/forms.md 输出 19、20 与“时序与寿命”）：字符串列表、对象列表与左列表右详情都用它。
 *
 * - 身份：每项一个稳定的 id，与值并行维护，`v-for` 按它作 key，所以删除与排序后每项的草稿、控件状态跟着项走。
 *   增删排序时新的 id 列表记在“待采纳”里，等调用方把那个数组传回来才换上；调用方没采纳（写入被拒）时 id 不动。
 *   传回来的往往不是同一个对象（`ref()` 的代理、经过 JSON 或一次 RPC 的副本），所以按内容比。外部换成长度不同的另一个
 *   数组时重建；长度相同的变化（项里的字段改了）保留 id。
 * - 焦点：增删排序的落点（Spec 输出 19）跟“待采纳”记在一起，等调用方把新数组传回来、渲染出来之后才移。调用方的写回
 *   可能是异步的（设置要经过一次 RPC），所以不能只等一个 `nextTick`；没采纳时这次的焦点也作废。
 * - 超过 `FOLD_LIMIT` 项先折叠成“N 项”，展开后按 `PAGE_SIZE` 分页。
 */

import {computed, nextTick, ref, toRaw, watch} from "vue";
import type {Ref} from "vue";

import type {FieldNode} from "../model";
import {messagesFor} from "./messages";

export const FOLD_LIMIT = 50;
export const PAGE_SIZE = 50;

export interface ListOptions {
    readonly node: () => FieldNode;
    readonly value: () => unknown;
    readonly locale: () => string;
    readonly editable: () => boolean;
    /** 提交新的数组。 */
    readonly emit: (next: unknown[]) => void;
    /** 列表的根元素：焦点落点在它里面找。 */
    readonly root: Readonly<Ref<HTMLElement | null>>;
    /** 新项的初值。 */
    readonly blank: () => unknown;
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

/** 传回来的数组是不是我们发出的那一个：同一个对象，或内容相同（JSON 写法相同）。 */
function sameContent(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
    if (toRaw(left) === toRaw(right)) return true;
    if (left.length !== right.length) return false;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        // 值里有循环引用或 BigInt：写不成 JSON，就不是表单发出的值（表单的值都是 JSON）。
        return false;
    }
}

const FOCUSABLE = "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex='0']";

export function useList(options: ListOptions) {
    const items = computed<ReadonlyArray<unknown>>(() => {
        const value = options.value();
        return Array.isArray(value) ? value : [];
    });
    const ids = ref<string[]>(items.value.map(newId));
    /** 等调用方传回来的那次修改：`adopt` 在渲染前跑（换上 id、调整选中），`focus` 在渲染后跑。 */
    let pending: {readonly array: ReadonlyArray<unknown>; readonly ids: string[]; readonly adopt?: () => void; readonly focus: () => void} | null = null;
    watch(items, (next) => {
        if (pending !== null && sameContent(next, pending.array)) {
            ids.value = pending.ids;
            pending.adopt?.();
            void nextTick(pending.focus);
        } else if (next.length !== ids.value.length) {
            ids.value = next.map(newId);
        }
        pending = null;
    });

    const announcement = ref("");
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
    const entries = computed<ListEntry[]>(() => items.value.map((value, index) => ({id: ids.value[index] ?? `item-at-${String(index)}`, index, value})));
    const visible = computed(() => {
        if (items.value.length <= FOLD_LIMIT) return entries.value;
        if (!expanded.value) return [];
        const start = Math.min(page.value, pageCount.value - 1) * PAGE_SIZE;
        return entries.value.slice(start, start + PAGE_SIZE);
    });

    /** `uniqueItems` 下与前面某项相同的项（按 JSON 比较）。 */
    const duplicates = computed(() => {
        const marked = new Set<number>();
        if (schema.value.uniqueItems !== true) return marked;
        const seen = new Set<string>();
        items.value.forEach((value, index) => {
            const key = JSON.stringify(value) ?? "undefined";
            if (seen.has(key)) marked.add(index);
            seen.add(key);
        });
        return marked;
    });

    function submit(next: unknown[], nextIds: string[], message: string, focus: () => void, adopt?: () => void): void {
        pending = {array: next, ids: nextIds, focus, ...(adopt === undefined ? {} : {adopt})};
        announcement.value = message;
        options.emit(next);
    }

    const itemElement = (id: string) => options.root.value?.querySelector<HTMLElement>(`[data-nb-list-item="${id}"]`) ?? null;
    const actionIn = (id: string, action: ListAction) => itemElement(id)?.querySelector<HTMLElement>(`[data-nb-list-action="${action}"]:not([disabled])`) ?? null;
    const addButton = () => options.root.value?.querySelector<HTMLElement>("[data-nb-list-add]") ?? null;

    const firstControl = (id: string) => itemElement(id)?.querySelector("[data-nb-list-body]")?.querySelector<HTMLElement>(FOCUSABLE) ?? null;

    /** 列表控件的附加步骤（左列表右详情用它调整选中项）；都在调用方采纳以后跑。 */
    interface Hooks {
        /** 渲染前：换上 id 的同时。 */
        readonly adopt?: () => void;
        /** 取代缺省的焦点落点。 */
        readonly focus?: () => void;
    }

    function add(hooks: Hooks = {}): void {
        if (!canAdd.value) return;
        const id = newId();
        const next = [...items.value, options.blank()];
        submit(next, [...ids.value, id], messages.value.added(next.length), hooks.focus ?? (() => firstControl(id)?.focus()), () => {
            // 新项落在最后一页：展开并翻过去，它才在页面上。
            if (next.length > FOLD_LIMIT) {
                expanded.value = true;
                page.value = Math.ceil(next.length / PAGE_SIZE) - 1;
            }
            hooks.adopt?.();
        });
    }

    function remove(index: number, hooks: Hooks = {}): void {
        if (!canRemove.value || index < 0 || index >= items.value.length) return;
        const nextIds = ids.value.filter((_, at) => at !== index);
        submit(items.value.filter((_, at) => at !== index), nextIds, messages.value.removed(index + 1), hooks.focus ?? (() => {
            const neighbour = nextIds[index] ?? nextIds[index - 1];
            (neighbour === undefined ? addButton() : actionIn(neighbour, "remove") ?? itemElement(neighbour))?.focus();
        }), hooks.adopt);
    }

    function move(index: number, delta: -1 | 1, hooks: Hooks = {}): void {
        const action: ListAction = delta < 0 ? "up" : "down";
        const target = index + delta;
        if (!options.editable() || target < 0 || target >= items.value.length) return;
        const swap = <T>(list: ReadonlyArray<T>): T[] => {
            const copy = [...list];
            [copy[index], copy[target]] = [copy[target] as T, copy[index] as T];
            return copy;
        };
        const id = ids.value[index] as string;
        const active = document.activeElement;
        submit(swap(items.value), swap(ids.value), messages.value.moved(index + 1, target + 1), hooks.focus ?? (() => {
            // 焦点跟着被移动的项：原来就在这一项里的元素还在就留在它上面（`v-for` 移动节点时可能丢焦点），否则落到同一个
            // 按钮上；它到了边界停用了，落到另一个方向的按钮上。
            if (active instanceof HTMLElement && itemElement(id)?.contains(active) && active.isConnected && !active.hasAttribute("disabled")) {
                active.focus();
                return;
            }
            (actionIn(id, action) ?? actionIn(id, action === "up" ? "down" : "up"))?.focus();
        }), hooks.adopt);
    }

    /** `Alt+↑ / ↓` 移动焦点所在的项。 */
    function onItemKeydown(event: KeyboardEvent, index: number): void {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
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
        onItemKeydown,
        itemElement,
    };
}
