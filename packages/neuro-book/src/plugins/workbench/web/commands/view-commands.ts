/**
 * 视图命令。打开视图（docs/specs/workbench/views.md 输出 14）：选中视图所在的容器、显示它所在的区域、多视图容器里展开它；
 * 不给 `viewId` 时经选择挑一个。移动视图（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-shell.md 外壳二输出 24）：“移动到”菜单
 * 带三项参数直接执行（目标是已有容器 `targetContainerId`，或在某个 Part 新建自建容器 `newContainerIn`）；命令面板执行
 * `{}`，经选择先选视图、再选目标。实现调布局 store 的 `applyView`，合成与校验都在那里，这里只把合成结果翻成命令结果。
 *
 * 新建容器的 `custom:<UUID>` 在这次执行接纳时生成一次，保存冲突重放复用同一个（补丁里带着它）。
 *
 * 来源容器是发起时界面看到的位置：菜单打开后、或两步选择之间视图被别处移走，按 `stale-target` 拒绝且不写。
 */

import {Type} from "typebox";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import {OPEN_VIEW_COMMAND, VIEW_LOCATIONS} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import type {LayoutStore} from "../state/layout-store";
import {workbenchState} from "../state/public-state";
import {customContainerId} from "../views/placement";
import {moveTargetsOf} from "../views/presentation";
import type {IntentResult, ViewIntent} from "../views/intents";

export const MOVE_VIEW_COMMAND = "nbook.view.move-view";
export {OPEN_VIEW_COMMAND};

const Id = Type.String({minLength: 1, maxLength: 160});

export const VIEW_COMMAND_DECLARATIONS = {
    [OPEN_VIEW_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Show a view: select the container it is in, show that part of the window and expand the view. Give viewId, or nothing to pick one.",
        args: Type.Object({viewId: Type.Optional(Id)}, {additionalProperties: false}),
        // 会改写布局记录（选中的容器、区域显隐、视图展开），所以是写入；与别的布局命令一样不给 Agent。
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
    [MOVE_VIEW_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Move a view into another existing view container (targetContainerId), or into a new container at the end of a part (newContainerIn). Give viewId, sourceContainerId and one target, or nothing to pick the view and the target.",
        args: Type.Object({
            viewId: Type.Optional(Id),
            sourceContainerId: Type.Optional(Id),
            targetContainerId: Type.Optional(Id),
            newContainerIn: Type.Optional(Type.Union(VIEW_LOCATIONS.map((part) => Type.Literal(part)))),
        }, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

export const PART_LABELS: Readonly<Record<ViewLocation, DisplayText>> = {
    sidebar: workbenchText("viewCommands.parts.sidebar"),
    auxiliarybar: workbenchText("viewCommands.parts.auxiliarybar"),
    panel: workbenchText("viewCommands.parts.panel"),
};

/** “新建容器（在 X）”的标题，按区域各一条（区域名是目录里完整的一句，不在代码里拼接）。 */
const NEW_CONTAINER_LABELS: Readonly<Record<ViewLocation, DisplayText>> = {
    sidebar: workbenchText("viewCommands.newContainer.sidebar"),
    auxiliarybar: workbenchText("viewCommands.newContainer.auxiliarybar"),
    panel: workbenchText("viewCommands.newContainer.panel"),
};

const TEXT = {
    pickView: workbenchText("viewCommands.pickView"),
    pickOpen: workbenchText("viewCommands.pickOpen"),
    noOpenable: workbenchText("viewCommands.noOpenable"),
    unknownView: "没有这个视图（没有已接受的声明）：",
    unplaced: "视图不在布局里：",
    pickTarget: workbenchText("viewCommands.pickTarget"),
    noViews: workbenchText("viewCommands.noViews"),
    reset: workbenchText("views.resetLocation"),
    noLayout: "工作台布局没有打开（这个窗口没有显示外壳）",
    partial: "要么都不给，要么给 viewId、sourceContainerId 和 targetContainerId、newContainerIn 中的一个",
    stale: "视图已经不在发起时的容器里，没有移动",
} as const;

/** 选择项里“重置位置”与“新建容器（在 X）”的 id；容器 id 不会以它们开头。 */
const RESET_ITEM = "reset:";
const NEW_ITEM = "new:";

const DONE: CommandResult<null> = {ok: true, value: null};

/** “新建容器（在 X）”的标题，菜单与选择共用。 */
export function newContainerLabel(part: ViewLocation): DisplayText {
    return NEW_CONTAINER_LABELS[part];
}

type MoveTarget = {readonly targetContainerId: string} | {readonly newContainerIn: ViewLocation};

/** 移动意图：新建容器时在这里生成身份。 */
function moveIntent(viewId: string, sourceContainerId: string, target: MoveTarget): ViewIntent {
    if ("targetContainerId" in target) return {kind: "move-view", viewId, sourceContainerId, targetContainerId: target.targetContainerId};
    return {kind: "detach-view", viewId, sourceContainerId, containerId: customContainerId(crypto.randomUUID()), targetPart: target.newContainerIn};
}

/** 合成结果 → 命令结果。来源变了是过期的发起，其余拒绝是参数不对。 */
function resultOf(result: IntentResult): CommandResult<null> {
    if (result.kind !== "rejected") return DONE;
    if (result.code === "stale-source") return {ok: false, code: "stale-target", reason: TEXT.stale};
    return {ok: false, code: "invalid-args", reason: result.reason};
}

async function pickAndMove(store: LayoutStore, quickPick: QuickPick): Promise<CommandResult<null>> {
    const {catalog, placement, presentation} = store.state;
    const movable = [...catalog.keys()].filter((viewId) => {
        const targets = moveTargetsOf(presentation, placement, catalog, viewId);
        return targets !== null && (targets.groups.length > 0 || targets.canReset);
    });
    const containerTitle = (containerId: string): DisplayText | undefined => presentation.containers.get(containerId)?.title;
    const pickedView = await quickPick.pick({
        title: TEXT.pickView,
        placeholder: TEXT.pickView,
        empty: TEXT.noViews,
        items: movable.map((viewId) => {
            const source = placement.views.get(viewId)!.container;
            const title = containerTitle(source);
            return {id: viewId, label: catalog.get(viewId)!.title, ...(title === undefined ? {} : {detail: title})};
        }),
    });
    if (pickedView.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedView.reason};
    if (pickedView.kind !== "item") return DONE;
    // 第二步的目标表按第一步选完时的呈现求；来源随它一起记下，执行时再核对。
    const targets = moveTargetsOf(store.state.presentation, store.state.placement, store.state.catalog, pickedView.id);
    if (targets === null) return {ok: false, code: "stale-target", reason: TEXT.stale};
    const pickedTarget = await quickPick.pick({
        title: TEXT.pickTarget,
        placeholder: TEXT.pickTarget,
        items: [
            ...targets.groups.flatMap((group) => [
                ...group.targets.map((target) => ({id: target.containerId, label: target.title, detail: PART_LABELS[group.part]})),
                {id: `${NEW_ITEM}${group.part}`, label: newContainerLabel(group.part)},
            ]),
            ...(targets.canReset ? [{id: RESET_ITEM, label: TEXT.reset}] : []),
        ],
    });
    if (pickedTarget.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedTarget.reason};
    if (pickedTarget.kind !== "item") return DONE;
    if (store.state.placement.views.get(targets.viewId)?.container !== targets.sourceContainerId) return {ok: false, code: "stale-target", reason: TEXT.stale};
    if (pickedTarget.id === RESET_ITEM) return resultOf(store.actions.applyView({kind: "reset-view", viewId: targets.viewId}));
    const part = VIEW_LOCATIONS.find((location) => pickedTarget.id === `${NEW_ITEM}${location}`);
    return resultOf(store.actions.applyView(moveIntent(targets.viewId, targets.sourceContainerId, part === undefined ? {targetContainerId: pickedTarget.id} : {newContainerIn: part})));
}

/**
 * 打开一个视图：多视图容器里收起的先展开，再一次选中容器并显示所在区域（`reveal` 清掉隐藏、拖到零与面板收起）。
 * 不移动焦点：成功表示布局已改，视图在下一次渲染时出现。
 */
function openView(store: LayoutStore, viewId: string): CommandResult<null> {
    const {catalog, placement, presentation} = store.state;
    if (!catalog.has(viewId)) return {ok: false, code: "invalid-args", reason: `${TEXT.unknownView}${viewId}`};
    const containerId = placement.views.get(viewId)?.container;
    const part = containerId === undefined ? undefined : VIEW_LOCATIONS.find((location) => placement.parts[location].includes(containerId));
    if (containerId === undefined || part === undefined) return {ok: false, code: "invalid-args", reason: `${TEXT.unplaced}${viewId}`};
    const container = presentation.containers.get(containerId);
    if (container?.mode === "multiple" && container.views.some((view) => view.id === viewId && view.collapsed)) {
        const expanded = store.actions.applyView({kind: "set-view-collapsed", viewId, collapsed: false});
        if (expanded.kind === "rejected") return resultOf(expanded);
    }
    return resultOf(store.actions.applyView({kind: "select-container", part, containerId}, {reveal: part}));
}

async function pickAndOpen(store: LayoutStore, quickPick: QuickPick): Promise<CommandResult<null>> {
    const {catalog, placement, presentation} = store.state;
    const openable = [...catalog.keys()].filter((viewId) => placement.views.has(viewId));
    const picked = await quickPick.pick({
        title: TEXT.pickOpen,
        placeholder: TEXT.pickOpen,
        empty: TEXT.noOpenable,
        items: openable.map((viewId) => {
            const title = presentation.containers.get(placement.views.get(viewId)!.container)?.title;
            return {id: viewId, label: catalog.get(viewId)!.title, ...(title === undefined ? {} : {detail: title})};
        }),
    });
    if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
    if (picked.kind !== "item") return DONE;
    return openView(store, picked.id);
}

type ViewCommands = {readonly [K in keyof typeof VIEW_COMMAND_DECLARATIONS]: CommandImplementation};

export function viewCommands(layout: () => LayoutStore | null, quickPick: QuickPick): ViewCommands {
    return {
        [OPEN_VIEW_COMMAND]: {
            run: (raw) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const {viewId} = raw as {readonly viewId?: string};
                return viewId === undefined ? pickAndOpen(store, quickPick) : openView(store, viewId);
            },
        },
        [MOVE_VIEW_COMMAND]: {
            run: (raw) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const args = raw as {readonly viewId?: string; readonly sourceContainerId?: string; readonly targetContainerId?: string; readonly newContainerIn?: ViewLocation};
                const given = [args.viewId, args.sourceContainerId, args.targetContainerId, args.newContainerIn].filter((value) => value !== undefined).length;
                if (given === 0) return pickAndMove(store, quickPick);
                if (given !== 3 || args.viewId === undefined || args.sourceContainerId === undefined) return {ok: false, code: "invalid-args", reason: TEXT.partial};
                const target: MoveTarget = args.targetContainerId === undefined ? {newContainerIn: args.newContainerIn!} : {targetContainerId: args.targetContainerId};
                return resultOf(store.actions.applyView(moveIntent(args.viewId, args.sourceContainerId, target)));
            },
        },
    };
}
