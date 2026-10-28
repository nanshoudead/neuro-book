/**
 * 资源管理器的命令（docs/specs/workbench/commands.md 的“命令目录（资源管理器）”与第二批的 `refresh-files`）：工具栏、
 * 右键菜单与树内快捷键只引用这些命令 id。实现经会话找到控制器与当前挂着的视图；资源管理器还没打开时为 `unavailable`，
 * 不静默成功。
 */

import {Type} from "typebox";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {RESOURCE_PATH_PATTERN} from "nbook/plugins/files/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";

import {explorerText} from "../shared/text";
import type {ActionResult, ExplorerController} from "./controller";
import {unavailableText} from "./feedback-text";
import type {ExplorerSession} from "./session";
import {explorerState} from "./state";

export const COLLAPSE_ALL_COMMAND = "nbook.files.collapse-all";
export const TOGGLE_MANIFESTS_COMMAND = "nbook.files.toggle-manifests";
export const REFRESH_FILES_COMMAND = "nbook.view.refresh-files";
export const NEW_FILE_COMMAND = "nbook.files.new-file";
export const NEW_FOLDER_COMMAND = "nbook.files.new-folder";
export const RENAME_COMMAND = "nbook.files.rename";
export const DELETE_COMMAND = "nbook.files.delete";
export const CREATE_CONTENT_COMMAND = "nbook.files.create-content";
export const CONVERT_COMMAND = "nbook.files.convert";
export const SET_DISPLAY_COMMAND = "nbook.files.set-display";
export const INCLUDE_COMMAND = "nbook.files.include";
export const DROP_ENTRY_COMMAND = "nbook.files.drop-entry";
export const MOVE_UP_COMMAND = "nbook.files.move-up";
export const MOVE_DOWN_COMMAND = "nbook.files.move-down";
export const COPY_COMMAND = "nbook.files.copy";
export const CUT_COMMAND = "nbook.files.cut";
export const PASTE_COMMAND = "nbook.files.paste";
export const CLEAR_CUT_COMMAND = "nbook.files.clear-cut";
export const REVEAL_COMMAND = "nbook.files.reveal";
export const RETRY_LIST_COMMAND = "nbook.files.retry-list";
export const OPEN_SELECTION_COMMAND = "nbook.files.open";
export const OPEN_TO_SIDE_COMMAND = "nbook.files.open-to-side";
export const COPY_PATH_COMMAND = "nbook.files.copy-path";
export const COPY_RELATIVE_PATH_COMMAND = "nbook.files.copy-relative-path";

const CATEGORY = explorerText("commands.category");
const NO_ARGS = Type.Object({}, {additionalProperties: false});
const requires = (...names: ReadonlyArray<keyof typeof explorerState.declarations & string>) => ({requires: names.map((name) => explorerState.key(name))});

/** 作用于选择的命令：参数为空，Agent 不可调用。标题省略，登记时补成约定键 `commands.<命令 id>.title`（`locales/`）。 */
const onSelection = (description: string, effect: "read" | "write", when: ReadonlyArray<keyof typeof explorerState.declarations & string>, destructive = false): WrittenCommandDeclaration => ({
    category: CATEGORY,
    description,
    args: NO_ARGS,
    effect,
    expose: destructive ? {agent: "never", hints: {destructive: true}} : {agent: "never"},
    when: requires(...when),
});

export const EXPLORER_COMMAND_DECLARATIONS = {
    [NEW_FILE_COMMAND]: onSelection("Start creating an empty file in the explorer's target folder; the user types the name inline.", "write", ["ready", "canCreate"]),
    [NEW_FOLDER_COMMAND]: onSelection("Start creating a folder in the explorer's target folder; the user types the name inline.", "write", ["ready", "canCreate"]),
    [COLLAPSE_ALL_COMMAND]: onSelection("Collapse every folder in this window's explorer except the roots.", "read", ["ready"]),
    [TOGGLE_MANIFESTS_COMMAND]: onSelection("Show or hide manifest files (content.xml) in this window's explorer. Only changes the display preference.", "write", ["ready"]),
    [RENAME_COMMAND]: onSelection("Rename the selected file or folder inline; the source identity is frozen when renaming starts.", "write", ["ready", "hasSelection"]),
    [DELETE_COMMAND]: onSelection("Delete the selected files and folders after the user confirms; cannot be undone.", "write", ["ready", "hasSelection"], true),
    [CREATE_CONTENT_COMMAND]: onSelection("Create an empty index.md for the selected content node that has none.", "write", ["ready", "canCreateContent"]),
    [CONVERT_COMMAND]: onSelection("Convert the selected folder between a plain folder and a content folder.", "write", ["ready", "canConvert"]),
    [SET_DISPLAY_COMMAND]: onSelection("Edit the display name and icon of the selected item in its content folder's manifest.", "write", ["ready", "canEditManifest"]),
    [INCLUDE_COMMAND]: onSelection("Add the selected unlisted item to its content folder's manifest.", "write", ["ready", "canEditManifest"]),
    [DROP_ENTRY_COMMAND]: onSelection("Remove the selected missing entry from its content folder's manifest.", "write", ["ready", "canEditManifest"]),
    [MOVE_UP_COMMAND]: onSelection("Move the selected items up by one in their content folder's manifest order.", "write", ["ready", "canReorder"]),
    [MOVE_DOWN_COMMAND]: onSelection("Move the selected items down by one in their content folder's manifest order.", "write", ["ready", "canReorder"]),
    [COPY_COMMAND]: onSelection("Put the selected files and folders on this window's file clipboard for copying; their identity is frozen now.", "read", ["ready", "hasSelection"]),
    [CUT_COMMAND]: onSelection("Put the selected files and folders on this window's file clipboard for moving; their identity is frozen now.", "read", ["ready", "hasSelection"]),
    [PASTE_COMMAND]: onSelection("Copy or move the clipboard items into the explorer's target folder, asking about name collisions.", "write", ["ready", "canPaste"]),
    [CLEAR_CUT_COMMAND]: onSelection("Clear the cut items from this window's file clipboard.", "read", ["ready"]),
    [RETRY_LIST_COMMAND]: onSelection("List again the focused folder whose listing failed.", "read", ["ready"]),
    [OPEN_SELECTION_COMMAND]: onSelection("Open the selected files (and content nodes with a body) as permanent tabs in the active editor group.", "read", ["ready", "hasSelection"]),
    [OPEN_TO_SIDE_COMMAND]: onSelection("Open the selected files in the editor group to the right of the active one, splitting right when there is none.", "read", ["ready", "hasSelection"]),
    [COPY_PATH_COMMAND]: onSelection("Copy the absolute paths (on the server machine) of the selected items to the system clipboard, one per line.", "read", ["ready", "hasSelection"]),
    [COPY_RELATIVE_PATH_COMMAND]: onSelection("Copy the paths of the selected items relative to their root to the system clipboard, one per line.", "read", ["ready", "hasSelection"]),
    [REFRESH_FILES_COMMAND]: {
        category: CATEGORY,
        description: "Re-list every loaded folder of the explorer view instance given by viewId and generation.",
        args: Type.Object({viewId: Type.String(), generation: Type.Integer({minimum: 1})}, {additionalProperties: false}),
        effect: "read",
        // 视图动作：参数是实例的代次，从命令面板执行没有意义。
        expose: {human: false, agent: "never"},
        when: requires("ready"),
    },
    // 欢迎页的快捷入口用它揭示文件夹（docs/specs/workbench/files-explorer.md 的“打开作品时揭示活动文件”同一套揭示）。
    [REVEAL_COMMAND]: {
        category: CATEGORY,
        description: "Reveal a resource in this window's explorer: expand its parent folders, then select it and scroll it into view; with expand, also expand the folder itself.",
        args: Type.Object({address: Type.String({pattern: `^(?:project|user)://${RESOURCE_PATH_PATTERN.slice(1)}`}), expand: Type.Optional(Type.Boolean())}, {additionalProperties: false}),
        effect: "read",
        expose: {human: false, agent: "auto"},
        when: requires("ready"),
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

/** 需要界面输入（内联输入或确认框）的命令：视图要挂着且可见。 */
const NEEDS_VIEW = new Set<string>([NEW_FILE_COMMAND, NEW_FOLDER_COMMAND, RENAME_COMMAND, DELETE_COMMAND, SET_DISPLAY_COMMAND, PASTE_COMMAND]);

export function explorerCommands(session: ExplorerSession, text: TextResolver): Record<string, CommandImplementation> {
    const unavailable = (reason: string): CommandResult<unknown> => ({ok: false, code: "unavailable", reason});
    const action = (id: string, run: (controller: ExplorerController) => ActionResult | Promise<ActionResult>): CommandImplementation => ({
        run: async () => {
            const controller = session.controller.value;
            if (controller === null) return unavailable(text.t(explorerText("unavailable.notReady")));
            if (NEEDS_VIEW.has(id) && session.view.value?.visible.value !== true) return unavailable(text.t(explorerText("unavailable.notVisible")));
            const result = await run(controller);
            return result.ok ? {ok: true, value: null} : unavailable(unavailableText(text, result.reason));
        },
    });
    const done: ActionResult = {ok: true};
    return {
        [NEW_FILE_COMMAND]: action(NEW_FILE_COMMAND, (controller) => controller.create("file")),
        [NEW_FOLDER_COMMAND]: action(NEW_FOLDER_COMMAND, (controller) => controller.create("directory")),
        [COLLAPSE_ALL_COMMAND]: action(COLLAPSE_ALL_COMMAND, (controller) => {
            controller.model.collapseAll();
            return done;
        }),
        [TOGGLE_MANIFESTS_COMMAND]: action(TOGGLE_MANIFESTS_COMMAND, (controller) => {
            session.setShowManifests(!controller.showManifests.value);
            return done;
        }),
        [RENAME_COMMAND]: action(RENAME_COMMAND, (controller) => controller.rename()),
        [DELETE_COMMAND]: action(DELETE_COMMAND, (controller) => controller.delete()),
        [CREATE_CONTENT_COMMAND]: action(CREATE_CONTENT_COMMAND, (controller) => controller.createContent()),
        [CONVERT_COMMAND]: action(CONVERT_COMMAND, (controller) => controller.convert()),
        [SET_DISPLAY_COMMAND]: action(SET_DISPLAY_COMMAND, (controller) => controller.editDisplay()),
        [INCLUDE_COMMAND]: action(INCLUDE_COMMAND, (controller) => controller.include()),
        [DROP_ENTRY_COMMAND]: action(DROP_ENTRY_COMMAND, (controller) => controller.drop()),
        [MOVE_UP_COMMAND]: action(MOVE_UP_COMMAND, (controller) => controller.move("up")),
        [MOVE_DOWN_COMMAND]: action(MOVE_DOWN_COMMAND, (controller) => controller.move("down")),
        [COPY_COMMAND]: action(COPY_COMMAND, (controller) => controller.copy()),
        [CUT_COMMAND]: action(CUT_COMMAND, (controller) => controller.cut()),
        [PASTE_COMMAND]: action(PASTE_COMMAND, (controller) => controller.paste()),
        [CLEAR_CUT_COMMAND]: action(CLEAR_CUT_COMMAND, (controller) => controller.clearCut()),
        [OPEN_SELECTION_COMMAND]: action(OPEN_SELECTION_COMMAND, (controller) => controller.openSelection(false)),
        [OPEN_TO_SIDE_COMMAND]: action(OPEN_TO_SIDE_COMMAND, (controller) => controller.openSelection(true)),
        [COPY_PATH_COMMAND]: action(COPY_PATH_COMMAND, (controller) => controller.copyPaths(false)),
        [COPY_RELATIVE_PATH_COMMAND]: action(COPY_RELATIVE_PATH_COMMAND, (controller) => controller.copyPaths(true)),
        // 读取失败挂在目录行上（行尾的标记点了也是重新列出）：作用于焦点行。
        [RETRY_LIST_COMMAND]: action(RETRY_LIST_COMMAND, (controller) => {
            const focus = controller.selection.value.focus;
            const row = focus === null ? undefined : controller.rows.value.find((candidate) => candidate.id === focus);
            if (row === undefined || row.kind === "edit" || row.problem?.kind !== "error") return {ok: false, reason: "not-applicable"};
            controller.model.retry(row.id);
            return done;
        }),
        [REVEAL_COMMAND]: {
            run: (args) => {
                const {address, expand} = args as {address: string; expand?: boolean};
                const controller = session.controller.value;
                if (controller === null) return unavailable(text.t(explorerText("unavailable.notReady")));
                controller.reveal(address);
                if (expand === true) controller.model.expand(address);
                return {ok: true, value: null};
            },
        },
        [REFRESH_FILES_COMMAND]: {
            run: (args) => {
                const {viewId, generation} = args as {viewId: string; generation: number};
                const controller = session.controller.value;
                const view = session.view.value;
                if (controller === null) return unavailable(text.t(explorerText("unavailable.notReady")));
                if (view === null || view.id !== viewId || view.generation !== generation) return {ok: false, code: "stale-target", reason: text.t(explorerText("unavailable.staleView"))};
                controller.model.refresh();
                return {ok: true, value: null};
            },
        },
    };
}
