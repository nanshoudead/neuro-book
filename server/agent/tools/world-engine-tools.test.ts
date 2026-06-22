import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBuiltinTools} from "nbook/server/agent/tools";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {WORLD_FOCUS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {SessionEntry} from "nbook/server/agent/session/types";
import {worldEngineFacade} from "nbook/server/world-engine";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";

describe("world engine agent tools", () => {
    let projectPath: string;
    let projectRoot: string;
    let context: ToolExecutionContext;
    const appendCustomState = vi.fn(async (_sessionId: number, key: string, value: JsonValue): Promise<SessionEntry> => ({
        id: `custom:${key}`,
        parentId: null,
        timestamp: 0,
        type: "custom",
        key,
        value,
    }));

    beforeEach(async () => {
        appendCustomState.mockClear();
        projectPath = await createProject();
        projectRoot = path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length));
        context = {
            harness: {appendCustomState} as Partial<ToolExecutionContext["harness"]> as ToolExecutionContext["harness"],
            sessionId: 1,
            profileKey: "test.world-engine-tools",
            workspaceRoot: resolveWorkspaceContainerRoot(),
            workspaceKey: "global",
        };
    });

    afterEach(async () => {
        await worldEngineFacade.closeProject(projectPath);
        await removeProjectRoot(projectRoot);
    });

    it("内置工具注册包含 world engine 工具", () => {
        const keys = createBuiltinTools().map((tool) => tool.key);

        expect(keys).toEqual(expect.arrayContaining([
            "get_world_state",
            "list_world_slices",
            "write_world_slice",
            "edit_world_slice",
            "delete_world_slice",
            "create_world_subject",
            "get_world_schema",
            "list_world_subjects",
        ]));
        const createSubjectDescription = createWorldEngineTools().find((tool) => tool.key === "create_world_subject")?.description;
        expect(createSubjectDescription).toContain("kind=init slice");
        expect(createSubjectDescription).toContain("only the subject identity is registered");
    });

    it("get_world_schema 拒绝带空白的 subject type", async () => {
        await fs.writeFile(path.join(projectRoot, "world-engine/schema.yaml"), [
            "subjectTypes:",
            "  \" player character \":",
            "    attrs: {}",
            "",
        ].join("\n"), "utf-8");

        await expect(executeTool("get_world_schema", context, {
            projectPath,
        })).rejects.toThrow("subject type 不能包含空白： player character ");
    });

    it("get_world_schema 拒绝包含点号的 attr 名", async () => {
        await fs.writeFile(path.join(projectRoot, "world-engine/schema.yaml"), [
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      \"memory.师门\": { kind: scalar, type: text }",
            "",
        ].join("\n"), "utf-8");

        await expect(executeTool("get_world_schema", context, {
            projectPath,
        })).rejects.toThrow("attr 名不能包含 .：memory.师门");
    });

    it("通过 Calendar 字符串创建 subject、写 slice 并查询状态", async () => {
        const created = await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "城北遭遇",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "add", value: -30},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "城北遭遇伏击"},
            ],
        });

        const result = await executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            attrs: ["hp", "events"],
            listLimit: 1,
        });

        expect(created.details).toEqual({subjectId: "erina", issues: []});
        expect(result.details).toEqual({
            subjects: [
                {subjectId: "erina", type: "character", attrs: {hp: 70, events: ["城北遭遇伏击"]}},
            ],
            issues: [],
        });
        expect(appendCustomState).toHaveBeenLastCalledWith(1, WORLD_FOCUS_STATE_KEY, expect.objectContaining({
            projectPath,
            subjectIds: ["erina"],
        }), "global");
    });

    it("delete_world_slice 删除切面并返回删除后的数据问题", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const written = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "受伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });
        const sliceId = (written.details as {sliceId: string}).sliceId;

        await expect(executeTool("delete_world_slice", context, {projectPath, sliceId: ` ${sliceId} `})).rejects.toThrow(`sliceId 不能包含前后空白： ${sliceId} `);
        const deleted = await executeTool("delete_world_slice", context, {projectPath, sliceId});
        expect(deleted.details).toEqual({issues: []});

        const slices = await executeTool("list_world_slices", context, {projectPath});
        expect((slices.details as Array<{id: string}>).some((slice) => slice.id === sliceId)).toBe(false);
    });

    it("create_world_subject 拒绝把默认初始化追加进同时间非 init 切面", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const slices = await executeTool("list_world_slices", context, {projectPath, withMutations: true});
        const initSlice = (slices.details as Array<{id: string; kind: string}>).find((slice) => slice.kind === "init");
        if (!initSlice) {
            throw new Error("测试没有拿到 init slice");
        }
        await expect(executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: ` ${initSlice.id} `,
            time: "复兴纪元1年 1月1日 00:00:00",
            title: "空白 sliceId",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 100}],
        })).rejects.toThrow(`sliceId 不能包含前后空白： ${initSlice.id} `);
        await executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: initSlice.id,
            time: "复兴纪元1年 1月1日 00:00:00",
            title: "误设为事件",
            kind: "event",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 100}],
        });

        await expect(executeTool("create_world_subject", context, {
            projectPath,
            id: "moran",
            type: "character",
            name: "莫然",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toThrow("目标时间已有非 init 切面");
    });

    it("edit_world_slice 删除旧绝对 mutation 时返回下游 base-shifted", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "轻伤与经历",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "警惕起来"},
            ],
        });
        const downstream = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: readSliceId(first.details),
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "只保留经历",
            mutations: [{subjectId: "erina", attr: "events", op: "listAppend", value: "警惕起来"}],
        });
        const state = await executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            attrs: ["hp"],
        });

        expect(edited.details).toMatchObject({
            sliceId: readSliceId(first.details),
            issues: [expect.objectContaining({code: "base-shifted", sliceId: readSliceId(downstream.details), subjectId: "erina", attr: "hp"})],
        });
        expect(state.details).toMatchObject({
            subjects: [expect.objectContaining({subjectId: "erina", attrs: {hp: 90}})],
            issues: [],
        });
    });

    it("edit_world_slice 纯重排相关 mutation 时返回下游 base-shifted", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "连续修正伤势",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
            ],
        });
        const downstream = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: readSliceId(first.details),
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "调换伤势修正顺序",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            attrs: ["hp"],
        });

        expect(edited.details).toMatchObject({
            sliceId: readSliceId(first.details),
            issues: [expect.objectContaining({code: "base-shifted", sliceId: readSliceId(downstream.details), subjectId: "erina", attr: "hp"})],
        });
        expect(state.details).toMatchObject({
            subjects: [expect.objectContaining({subjectId: "erina", attrs: {hp: 70}})],
            issues: [],
        });
    });

    it("edit_world_slice 新增无关 mutation 时仍检测保留 mutation 的相关重排", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "连续修正伤势",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
            ],
        });
        const downstream = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: readSliceId(first.details),
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "调换伤势修正顺序并补经历",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "警惕起来"},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            attrs: ["hp", "events"],
        });

        expect(edited.details).toMatchObject({
            sliceId: readSliceId(first.details),
            issues: [expect.objectContaining({code: "base-shifted", sliceId: readSliceId(downstream.details), subjectId: "erina", attr: "hp"})],
        });
        expect(state.details).toMatchObject({
            subjects: [expect.objectContaining({subjectId: "erina", attrs: {hp: 70, events: ["警惕起来"]}})],
            issues: [],
        });
    });

    it("get_world_state 拒绝没有 subjectIds/type 的裸全量查询", async () => {
        await expect(executeTool("get_world_state", context, {projectPath})).rejects.toThrow("必须提供 subjectIds 或 type");
    });

    it("get_world_state 按 type 查询时拒绝 schema 未声明的类型", async () => {
        await expect(executeTool("get_world_state", context, {
            projectPath,
            type: "creature",
        })).rejects.toThrow("schema 未声明 subject type：creature");
    });

    it("get_world_state 拒绝缺失的 subjectIds", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina", "ghost"],
            attrs: ["hp"],
        })).rejects.toThrow("subject 不存在或不匹配查询条件：ghost");
    });

    it("get_world_state 拒绝重复 subjectIds", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina", "erina"],
            attrs: ["hp"],
        })).rejects.toThrow("subjectIds 不能重复：erina");
    });

    it("get_world_state 拒绝重复 attrs", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            attrs: ["hp", "hp"],
        })).rejects.toThrow("attrs 不能重复：hp");
    });

    it("get_world_state 拒绝带首尾空白路径段的 attrs", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            attrs: ["profile. tags "],
        })).rejects.toThrow("attr 路径段不能包含前后空白：profile. tags ");
    });

    it("create_world_subject 拒绝带首尾空白的 subject id", async () => {
        await expect(executeTool("create_world_subject", context, {
            projectPath,
            id: " erina ",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toThrow("id 不能包含前后空白： erina ");
    });

    it("Agent 工具公开时间入参拒绝 raw instant 调试格式", async () => {
        await expect(executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "instant:0",
        })).rejects.toThrow("time 必须使用项目日历字符串，不能使用 instant:<number>");
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const written = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "合法切面",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });

        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "instant:11",
            title: "raw instant",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 70}],
        })).rejects.toThrow("time 必须使用项目日历字符串，不能使用 instant:<number>");
        await expect(executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: readSliceId(written.details),
            time: "instant:10",
            title: "raw instant edit",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 90}],
        })).rejects.toThrow("time 必须使用项目日历字符串，不能使用 instant:<number>");
        await expect(executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            at: "instant:10",
        })).rejects.toThrow("at 必须使用项目日历字符串，不能使用 instant:<number>");
        await expect(executeTool("list_world_slices", context, {
            projectPath,
            from: "instant:0",
        })).rejects.toThrow("from 必须使用项目日历字符串，不能使用 instant:<number>");
        await expect(executeTool("list_world_slices", context, {
            projectPath,
            to: "Instant:10",
        })).rejects.toThrow("to 必须使用项目日历字符串，不能使用 instant:<number>");
    });

    it("Agent 工具公开时间入参不静默裁剪空白", async () => {
        await expect(executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: " 复兴纪元1年 1月1日 00:00:00 ",
        })).rejects.toThrow("time 不能包含前后空白： 复兴纪元1年 1月1日 00:00:00 ");
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const written = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "合法切面",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });

        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: " 复兴纪元1年 1月1日 00:00:11 ",
            title: "空白时间",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 70}],
        })).rejects.toThrow("time 不能包含前后空白： 复兴纪元1年 1月1日 00:00:11 ");
        await expect(executeTool("edit_world_slice", context, {
            projectPath,
            sliceId: readSliceId(written.details),
            time: " 复兴纪元1年 1月1日 00:00:10 ",
            title: "空白时间编辑",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 90}],
        })).rejects.toThrow("time 不能包含前后空白： 复兴纪元1年 1月1日 00:00:10 ");
        await expect(executeTool("get_world_state", context, {
            projectPath,
            subjectIds: ["erina"],
            at: " 复兴纪元1年 1月1日 00:00:10 ",
        })).rejects.toThrow("at 不能包含前后空白： 复兴纪元1年 1月1日 00:00:10 ");
        await expect(executeTool("list_world_slices", context, {
            projectPath,
            from: " 复兴纪元1年 1月1日 00:00:00 ",
        })).rejects.toThrow("from 不能包含前后空白： 复兴纪元1年 1月1日 00:00:00 ");
        await expect(executeTool("list_world_slices", context, {
            projectPath,
            to: " 复兴纪元1年 1月1日 00:00:10 ",
        })).rejects.toThrow("to 不能包含前后空白： 复兴纪元1年 1月1日 00:00:10 ");
    });

    it("Agent 工具公开时间入参拒绝超出 SQLite 64 位范围的 instant", async () => {
        await expect(executeTool("get_world_state", context, {
            projectPath,
            type: "character",
            at: "复兴纪元999999999999年 1月1日 00:00:00",
        })).rejects.toThrow("at 超出 SQLite INTEGER 64 位范围");
    });

    it("create_world_subject 和 get_world_state 拒绝带空白的 subject type 入参", async () => {
        await expect(executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: " player character ",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toThrow("subject type 不能包含空白： player character ");
        await expect(executeTool("get_world_state", context, {
            projectPath,
            type: "player character",
        })).rejects.toThrow("subject type 不能包含空白：player character");
    });

    it("write_world_slice 拒绝带首尾空白的 mutation subjectId", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 subjectId",
            mutations: [{subjectId: " erina ", attr: "hp", op: "set", value: 80}],
        })).rejects.toThrow("subjectId 不能包含前后空白： erina ");
    });

    it("write_world_slice 拒绝会被 JSON 序列化静默改写的 mutation value", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "非法数字",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: Number.NaN}],
        })).rejects.toThrow("hp value 必须是 JSON 值");
        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "嵌套非法数字",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: {score: Number.POSITIVE_INFINITY}}],
        })).rejects.toThrow("hp value 必须是 JSON 值");
        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "嵌套 undefined",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: {score: undefined}}],
        })).rejects.toThrow("hp value 必须是 JSON 值");
        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "非普通对象",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: new Date("2026-06-20T00:00:00.000Z")}],
        })).rejects.toThrow("hp value 必须是 JSON 值");
    });

    it("write_world_slice 拒绝空白 kind", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 kind",
            kind: " event ",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        })).rejects.toThrow("kind 不能包含前后空白： event ");
    });

    it("write_world_slice 拒绝带首尾空白的 ref id", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "capital",
            type: "location",
            name: "王都",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 ref",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject:// capital "}],
        })).rejects.toThrow("location 引用 id 不能包含前后空白： capital ");
    });

    it("list_world_slices 输出格式化 time，不向 Agent 暴露 raw instant", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "十秒后",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -1}],
        });

        const result = await executeTool("list_world_slices", context, {projectPath, withMutations: true});

        expect(result.details).toEqual([
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:00"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:10"}),
        ]);
        expect(JSON.stringify(result.details)).not.toContain("\"instant\"");
    });

    it("list_world_slices 未传 limit 时默认只返回最近 5 个切面", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        for (let second = 1; second <= 6; second += 1) {
            await executeTool("write_world_slice", context, {
                projectPath,
                time: `复兴纪元1年 1月1日 00:00:0${second}`,
                title: `${second}秒后`,
                mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -1}],
            });
        }

        const result = await executeTool("list_world_slices", context, {projectPath});

        expect(result.details).toEqual([
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:02"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:03"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:04"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:05"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:06"}),
        ]);
    });

    it("list_world_slices 带时间范围时不默认截断为 5 个切面", async () => {
        await executeTool("create_world_subject", context, {
            projectPath,
            id: "erina",
            type: "character",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        for (let second = 1; second <= 6; second += 1) {
            await executeTool("write_world_slice", context, {
                projectPath,
                time: `复兴纪元1年 1月1日 00:00:0${second}`,
                title: `${second}秒后`,
                mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -1}],
            });
        }

        const result = await executeTool("list_world_slices", context, {
            projectPath,
            from: "复兴纪元1年 1月1日 00:00:01",
            to: "复兴纪元1年 1月1日 00:00:06",
        });

        expect(result.details).toEqual([
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:01"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:02"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:03"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:04"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:05"}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:06"}),
        ]);
    });
});

async function executeTool(key: string, context: ToolExecutionContext, input: unknown) {
    const tool = createWorldEngineTools().find((item) => item.key === key);
    if (!tool?.executeWithContext) {
        throw new Error(`missing world engine tool: ${key}`);
    }
    return tool.executeWithContext(context, `${key}-call`, input);
}

function readSliceId(input: unknown): string {
    if (typeof input === "object" && input !== null && "sliceId" in input && typeof input.sliceId === "string") {
        return input.sliceId;
    }
    throw new Error("测试没有拿到 sliceId");
}

async function createProject(): Promise<string> {
    const slug = `world-tools-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const root = path.join(resolveWorkspaceContainerRoot(), slug);
    await fs.mkdir(path.join(root, "world-engine"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: World Tools Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine/schema.yaml"), [
        "subjectTypes:",
        "  character:",
        "    attrs:",
        "      hp: { kind: scalar, type: int, default: 100 }",
        "      events: { kind: list, itemType: text, default: [] }",
        "      location: { kind: scalar, type: ref(location) }",
        "  location:",
        "    attrs: {}",
        "",
    ].join("\n"), "utf-8");
    return projectPath;
}

async function removeProjectRoot(root: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            await fs.rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}
