/**
 * 场地里的工作台替身：只拥有视图与状态栏条目两个贡献点，把交来的实现收进表，场景直接读条目的 `text()`、视图的 `load()`。
 * 场地不装真正的工作台（`nbook.workbench`）：它要页面与布局，Bun 里起不来。
 *
 * 替身与真实工作台的合同对齐在两处：贡献点 id 与要求实现，用产品里同一份常量；声明的校验用产品里同一份函数
 * （`shared/views.ts`、`shared/items.ts`），所以替身接受的声明，真实工作台也接受。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {itemValidator, WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/items";
import {validateViewContribution, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewImplementation} from "nbook/plugins/workbench/web/contracts";

export interface WorkbenchStandIn {
    readonly definition: PluginDefinition;
    /** 此刻交到的状态栏条目的实现；贡献方停止后撤回。 */
    item(id: string): ItemImplementation | null;
    view(id: string): ViewImplementation | null;
}

export function workbenchStandIn(): WorkbenchStandIn {
    const items = new Map<string, ContributionHandle<unknown, ItemImplementation>>();
    const views = new Map<string, ContributionHandle<unknown, ViewImplementation>>();
    const receiver = <T>(table: Map<string, ContributionHandle<unknown, T>>) => ({
        published: (handle: ContributionHandle<unknown, T>) => void table.set(handle.id, handle),
        revoke: (handle: ContributionHandle<unknown, T>) => {
            if (table.get(handle.id) === handle) table.delete(handle.id);
        },
    });
    return {
        definition: {
            id: "nbook.workbench",
            contributionPoints: [
                {id: WORKBENCH_VIEWS_POINT, implementation: "required", validate: validateViewContribution},
                {id: WORKBENCH_STATUSBAR_ITEMS_POINT, implementation: "required", validate: itemValidator(WORKBENCH_STATUSBAR_ITEMS_POINT)},
            ],
            entries: [defineEntry({
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                receives: [WORKBENCH_VIEWS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT],
                activate: () => ({receivers: {[WORKBENCH_VIEWS_POINT]: receiver(views), [WORKBENCH_STATUSBAR_ITEMS_POINT]: receiver(items)}}),
            })],
        },
        item: (id) => items.get(id)?.implementation() ?? null,
        view: (id) => views.get(id)?.implementation() ?? null,
    };
}
