/**
 * 编辑器会话记录（docs/specs/workbench/editor.md 输出 5、30 与“副作用与数据”）：绑定项目的窗口把组的布局、每组的标签
 * （含上次的光标）与活动项存进 project/local 记录 `editor.session`，不存正文。地址按资源地址的规则校验，外部改坏的记录由 Storage 判为
 * 损坏并保护，编辑器从一个空组开始。
 */

import {Type} from "typebox";

import {RESOURCE_PATH_PATTERN} from "nbook/plugins/files/shared/contracts";
import {defineRecord, MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {CODE_EDITOR, LANGUAGE_ID_PATTERN, MARKDOWN_EDITOR} from "../shared/contracts";
import type {GroupsSnapshot} from "./groups/groups";

/** 每组最多这么多个标签、最多这么多组：只为记录有界，界面上不限制。 */
const MAX_TABS = 200;
const MAX_GROUPS = 16;

const ADDRESS_PATTERN = `^(?:project|user)://${RESOURCE_PATH_PATTERN.slice(1)}`;

const SessionSchema = Type.Object({
    // grid 快照的结构由 nb-ui 的恢复逐项校验；对不上时从空组开始，不覆盖记录。
    layout: Type.Unknown(),
    groups: Type.Array(Type.Object({
        id: Type.String({minLength: 1, maxLength: 64}),
        tabs: Type.Array(Type.Object({
            address: Type.String({pattern: ADDRESS_PATTERN}),
            // 编辑器 id（docs/specs/workbench/editor.md 的“副作用与数据”）；旧记录里的 `markdown`、`code` 读出时换成内置 id。
            editor: Type.String({pattern: "^(?:markdown|code|[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+)$"}),
            preview: Type.Boolean(),
            // 固定（输出 50）；可选字段，没有它的旧记录为不固定，记录版本不变。
            pinned: Type.Optional(Type.Literal(true)),
            // 上次的光标（输出 30）；可选字段，没有它的旧记录照样合法，记录版本不变。
            cursor: Type.Optional(Type.Union([
                Type.Object({offset: Type.Integer({minimum: 0})}, {additionalProperties: false}),
                Type.Object({line: Type.Integer({minimum: 1}), column: Type.Integer({minimum: 1})}, {additionalProperties: false}),
            ])),
            // 选定的语言（输出 45）；可选字段，版本不变。
            language: Type.Optional(Type.String({pattern: LANGUAGE_ID_PATTERN})),
        }, {additionalProperties: false}), {maxItems: MAX_TABS}),
        active: Type.Union([Type.Integer({minimum: 0}), Type.Null()]),
    }, {additionalProperties: false}), {maxItems: MAX_GROUPS}),
    activeGroup: Type.String(),
}, {additionalProperties: false});

export const EDITOR_SESSION_RECORD = defineRecord({key: "editor.session", scope: "project", locality: "local", version: 1, schema: SessionSchema, maxBytes: MAX_RECORD_MAX_BYTES});

/** 还没有记录时的显示：没有组，编辑器从一个空组开始。 */
const EMPTY = {layout: null, groups: [], activeGroup: ""};

export const editorSessionStore = defineStore("editor", ({persist}) => {
    const session = persist(EDITOR_SESSION_RECORD, {initial: EMPTY});
    /** 保存暂停期间只记下最后一份：恢复保存后只提交它。 */
    let latest: GroupsSnapshot | null = null;
    return {
        state: {session},
        actions: {
            save: (snapshot: GroupsSnapshot): void => {
                if (session.save.state === "failed" || session.save.state === "unknown") {
                    latest = snapshot;
                    return;
                }
                latest = null;
                void session.commit(() => JSON.parse(JSON.stringify(snapshot)));
            },
            /** 暂停的保存恢复后提交最后一份。 */
            retry: async (): Promise<void> => {
                await session.retry();
                const pending = latest;
                if (pending !== null && session.save.state !== "failed" && session.save.state !== "unknown") {
                    latest = null;
                    void session.commit(() => JSON.parse(JSON.stringify(pending)));
                }
            },
        },
    };
});

export type EditorSessionStore = ReturnType<typeof editorSessionStore.create>;

/** 第一版记录里的编辑器名。 */
const LEGACY_EDITORS: Readonly<Record<string, string>> = {markdown: MARKDOWN_EDITOR, code: CODE_EDITOR};

/** 记录里的值转成组模型的快照；空记录为 null。 */
export function snapshotOf(value: {readonly layout: unknown; readonly groups: ReadonlyArray<unknown>; readonly activeGroup: string}): GroupsSnapshot | null {
    if (value.groups.length === 0) return null;
    const snapshot = value as unknown as GroupsSnapshot;
    return {...snapshot, groups: snapshot.groups.map((group) => ({...group, tabs: group.tabs.map((tab) => ({...tab, editor: LEGACY_EDITORS[tab.editor] ?? tab.editor}))}))};
}
