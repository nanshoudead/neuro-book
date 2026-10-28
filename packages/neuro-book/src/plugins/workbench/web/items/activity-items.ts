/**
 * 活动栏底部条目的注册表（docs/specs/ui/workbench-shell.md 输出 40）：写法与状态栏、标题栏的条目注册表（`registry.ts`）相同。
 *
 * - 声明目录在工作台入口激活时取得，之后不变；交付句柄在 `published` 时记下、`revoke` 时去掉。条目只有声明，但仍随贡献方
 *   入口出现与消失：入口开始停止时句柄先失去 `published`，从那一刻起就不再显示。
 * - 显示与否只看声明的 `when`，按下与否只看 `toggled`：键在公开状态里已就绪且为真才算，与命令的可用性同一规则。
 */

import {shallowRef} from "@vue/reactivity";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";

import type {ActivityBarItemDeclaration} from "../../shared/items";
import type {ActivityBarItemImplementation} from "../contracts";

/** 活动栏此刻要画的一个底部条目：文字已按语言取好。 */
export interface ShownActivityItem {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    readonly command: {readonly id: string; readonly args: Readonly<Record<string, unknown>>} | null;
    /** 声明了 `toggled` 时是按下与否；没声明为 null（不是切换按钮）。 */
    readonly pressed: boolean | null;
}

type ActivityHandle = ContributionHandle<ActivityBarItemDeclaration, ActivityBarItemImplementation>;

export class ActivityItemRegistry {
    readonly #catalog: ReadonlyMap<string, ActivityBarItemDeclaration>;
    readonly #state: Pick<PublicStateService, "read">;
    readonly #handles = new Map<string, ActivityHandle>();
    /** 句柄集合的响应式版本号：交付、撤回、停止时加一，读 `shown` 的 computed 因此重算。 */
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(declarations: ReadonlyArray<ContributionDescriptor<ActivityBarItemDeclaration>>, state: Pick<PublicStateService, "read">, signal: AbortSignal) {
        this.#catalog = new Map(declarations.map((descriptor) => [descriptor.id, descriptor.declaration]));
        this.#state = state;
        signal.addEventListener("abort", () => {
            this.#stopped = true;
            this.#version.value += 1;
        }, {once: true});
    }

    receiver(): ContributionReceiver<ActivityBarItemDeclaration, ActivityBarItemImplementation> {
        return {
            published: (handle) => {
                this.#handles.set(handle.id, handle);
                this.#version.value += 1;
            },
            revoke: (handle) => {
                if (this.#handles.get(handle.id) !== handle) return;
                this.#handles.delete(handle.id);
                this.#version.value += 1;
            },
        };
    }

    /** 此刻要显示的条目，从上往下按 order 再按 id。响应式：在 computed 里读。 */
    shown(text: TextResolver): ShownActivityItem[] {
        void this.#version.value;
        if (this.#stopped) return [];
        const items: Array<{readonly order: number; readonly item: ShownActivityItem}> = [];
        for (const [id, handle] of this.#handles) {
            const declaration = this.#catalog.get(id);
            if (declaration === undefined || !handle.published || !(declaration.when?.requires ?? []).every((key) => this.#on(key))) continue;
            items.push({order: declaration.order, item: {
                id,
                title: text.t(declaration.title),
                icon: declaration.icon,
                command: declaration.command === undefined ? null : {id: declaration.command.id, args: declaration.command.args ?? {}},
                pressed: declaration.toggled === undefined ? null : this.#on(declaration.toggled),
            }});
        }
        return items
            .sort((a, b) => a.order - b.order || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
            .map((entry) => entry.item);
    }

    #on(key: string): boolean {
        const read = this.#state.read(key);
        return read.status === "ready" && read.value === true;
    }
}
