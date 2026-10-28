/**
 * 资源管理器的右键菜单（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：固定的动作，每一项执行
 * 一条命令。按右键的那一行与此刻的可用性决定有哪些项、哪些禁用；根行只有合法的根级动作（新建与粘贴）。
 */

import type {TextResolver} from "nbook/shared/localized-text";

import {explorerText} from "../shared/text";
import type {ExplorerTextKey} from "../shared/text";
import {CONVERT_COMMAND, COPY_COMMAND, COPY_PATH_COMMAND, COPY_RELATIVE_PATH_COMMAND, CREATE_CONTENT_COMMAND, CUT_COMMAND, DELETE_COMMAND, DROP_ENTRY_COMMAND, INCLUDE_COMMAND, MOVE_DOWN_COMMAND, MOVE_UP_COMMAND, NEW_FILE_COMMAND, NEW_FOLDER_COMMAND, OPEN_SELECTION_COMMAND, OPEN_TO_SIDE_COMMAND, PASTE_COMMAND, RENAME_COMMAND, SET_DISPLAY_COMMAND} from "./commands";
import type {Availability} from "./controller";
import type {Row} from "./tree/rows";

export const MENU_COMMANDS = {
    newFile: NEW_FILE_COMMAND,
    newFolder: NEW_FOLDER_COMMAND,
    rename: RENAME_COMMAND,
    delete: DELETE_COMMAND,
    createContent: CREATE_CONTENT_COMMAND,
    convert: CONVERT_COMMAND,
    setDisplay: SET_DISPLAY_COMMAND,
    include: INCLUDE_COMMAND,
    drop: DROP_ENTRY_COMMAND,
    moveUp: MOVE_UP_COMMAND,
    moveDown: MOVE_DOWN_COMMAND,
    cut: CUT_COMMAND,
    copy: COPY_COMMAND,
    paste: PASTE_COMMAND,
    open: OPEN_SELECTION_COMMAND,
    openToSide: OPEN_TO_SIDE_COMMAND,
    copyPath: COPY_PATH_COMMAND,
    copyRelativePath: COPY_RELATIVE_PATH_COMMAND,
} as const;

/**
 * 菜单的一项：`key` 是点了以后交回宿主的身份——固定动作就是它的命令 id，别的插件贡献的是 `menu:<贡献 id>`（宿主据此带上
 * 选择执行）；分隔线没有。`reason` 是不可用的原因，`checked` 为 null 时不是勾选项。
 */
export type MenuEntry =
    | {readonly kind: "item"; readonly key: string; readonly label: string; readonly disabled: boolean; readonly reason: string | null; readonly checked: boolean | null; readonly danger: boolean; readonly shortcut: string | null}
    | {readonly kind: "separator"};

export function menuEntries(row: Row, available: Availability, text: TextResolver): MenuEntry[] {
    const item = (command: string, label: ExplorerTextKey, enabled: boolean, extra: {danger?: boolean; shortcut?: string} = {}): MenuEntry => ({kind: "item", key: command, label: text.t(explorerText(label)), disabled: !enabled, reason: null, checked: null, danger: extra.danger ?? false, shortcut: extra.shortcut ?? null});
    const separator: MenuEntry = {kind: "separator"};
    const create = [item(MENU_COMMANDS.newFile, "menu.newFile", available.create), item(MENU_COMMANDS.newFolder, "menu.newFolder", available.create)];
    const paste = item(MENU_COMMANDS.paste, "menu.paste", available.paste, {shortcut: "Ctrl+V"});
    if (row.kind !== "entry") return [...create, separator, paste];
    // 能打开的行（文件与有正文的节点）才有“打开”“在侧边打开”；目录行没有。
    const opening = row.opens === null ? [] : [item(MENU_COMMANDS.open, "menu.open", true, {shortcut: "Enter"}), item(MENU_COMMANDS.openToSide, "menu.openToSide", true, {shortcut: "Ctrl+Enter"}), separator];
    const entries: MenuEntry[] = [
        ...opening,
        ...create,
        separator,
        item(MENU_COMMANDS.cut, "menu.cut", available.cut, {shortcut: "Ctrl+X"}),
        item(MENU_COMMANDS.copy, "menu.copy", available.copy, {shortcut: "Ctrl+C"}),
        paste,
        separator,
        // 缺失条目在磁盘上没有，没有路径可复制。
        ...(row.type === "missing" ? [] : [item(MENU_COMMANDS.copyPath, "menu.copyPath", true), item(MENU_COMMANDS.copyRelativePath, "menu.copyRelativePath", true), separator]),
        item(MENU_COMMANDS.rename, "menu.rename", available.rename, {shortcut: "F2"}),
    ];
    if (row.node && !row.body) entries.push(item(MENU_COMMANDS.createContent, "menu.createContent", available.createContent));
    if (row.type === "directory" && !row.content && !row.binder) entries.push(item(MENU_COMMANDS.convert, row.folder === "content" ? "menu.convertToPlain" : "menu.convertToContent", available.convert));
    if (row.content) {
        entries.push(separator);
        if (row.listed === false) entries.push(item(MENU_COMMANDS.include, "menu.include", available.include));
        else if (row.type === "missing") entries.push(item(MENU_COMMANDS.drop, "menu.drop", available.drop));
        else entries.push(item(MENU_COMMANDS.setDisplay, "menu.setDisplay", available.display));
        if (row.listed === true) entries.push(item(MENU_COMMANDS.moveUp, "menu.moveUp", available.moveUp, {shortcut: "Alt+↑"}), item(MENU_COMMANDS.moveDown, "menu.moveDown", available.moveDown, {shortcut: "Alt+↓"}));
    }
    entries.push(separator, item(MENU_COMMANDS.delete, "menu.delete", available.delete, {danger: true, shortcut: "Delete"}));
    return entries;
}
