import fs from "node:fs/promises";
import path from "node:path";
import {consola} from "consola";
import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {worldEngineFacade} from "nbook/server/world-engine";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";

const createdProjects: string[] = [];

describe("/api/projects/world-engine", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", (event: {body?: unknown}) => event.body);
        vi.stubGlobal("getQuery", (event: {query?: Record<string, unknown>}) => event.query ?? {});
        vi.stubGlobal("createError", (input: {statusCode?: number; message?: string}) => {
            const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
            error.statusCode = input.statusCode;
            return error;
        });
    });

    afterAll(async () => {
        for (const projectPath of createdProjects) {
            await worldEngineFacade.closeProject(projectPath);
            await removeProjectRoot(path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length)));
        }
        createdProjects.splice(0);
    });

    it("HTTP path segment 编码不合法时返回稳定 400", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "slices/%E0%A4%A")).rejects.toMatchObject({
            statusCode: 400,
            message: "API path 编码不合法：%E0%A4%A",
        });
    });

    it("通过 HTTP 边界使用日历字符串创建 subject、写/编辑/删除切面并查询", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        const created = await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "轻伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });
        const second = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const stateBeforeEdit = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["hp"],
        });
        const edited = await callApi(handler, projectPath, "POST", `slices/${readSliceId(first)}/edit`, {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "伤势修正",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 90}],
        });
        const slices = await callApi(handler, projectPath, "GET", "slices", undefined, {withMutations: "true"});
        const worldState = await callApi(handler, projectPath, "GET", "state", undefined, {at: "复兴纪元1年 1月1日 00:00:20"});
        const deleted = await callApi(handler, projectPath, "POST", `slices/${readSliceId(second)}/delete`);
        const stateAfterDelete = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["hp"],
        });

        expect(created).toEqual({subjectId: "erina", issues: []});
        expect(readSubjectState(stateBeforeEdit, "erina")).toMatchObject({attrs: {hp: 70}});
        expect(edited).toMatchObject({
            sliceId: readSliceId(first),
            issues: [expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "hp"})],
        });
        expect(slices).toEqual(expect.arrayContaining([
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:10", title: "伤势修正", mutations: expect.any(Array)}),
        ]));
        expect(worldState).toMatchObject({
            time: "复兴纪元1年 1月1日 00:00:20",
            subjects: [expect.objectContaining({subjectId: "erina", attrs: expect.objectContaining({hp: 80})})],
        });
        expect(deleted).toEqual({issues: []});
        expect(readSubjectState(stateAfterDelete, "erina")).toMatchObject({attrs: {hp: 90}});
    });

    it("HTTP subjects 支持初始化 schema 声明 attrs", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      sourcePath: { kind: scalar, type: text }",
            "      subjectFiles: { kind: object, itemType: text }",
            "      eventCount: { kind: scalar, type: int, default: 0 }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "player",
            type: "character",
            name: "薇洛丝",
            time: "复兴纪元1年 1月1日 00:00:00",
            attrs: {
                eventCount: 7,
                sourcePath: "simulation/subjects/player",
                subjectFiles: {
                    events: "simulation/subjects/player/events.jsonl",
                    subject: "simulation/subjects/player/subject.md",
                },
            },
        });
        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["player"],
            attrs: ["sourcePath", "subjectFiles", "eventCount"],
        });

        expect(readSubjectState(state, "player")).toMatchObject({
            attrs: {
                eventCount: 7,
                sourcePath: "simulation/subjects/player",
                subjectFiles: {
                    events: "simulation/subjects/player/events.jsonl",
                    subject: "simulation/subjects/player/subject.md",
                },
            },
        });
    });

    it("subject-file proposal event commit 只追加一次并拒绝错误目标文件", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;
        const projectRoot = path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length));
        const subjectPath = "simulation/subjects/player";
        const eventsPath = `${subjectPath}/events.jsonl`;
        const subjectRoot = path.join(projectRoot, "simulation", "subjects", "player");
        await fs.mkdir(subjectRoot, {recursive: true});
        await fs.writeFile(path.join(subjectRoot, "events.jsonl"), "{\"text\":\"旧经历\",\"time\":\"复兴纪元1年 1月1日 00:00:00\"}\n", "utf-8");

        const body = {
            subjectId: "player",
            subjectPath,
            eventsPath,
            sliceId: "slice-demo",
            eventJsonLine: "{\"text\":\"我经历了新的世界变化。\",\"time\":\"复兴纪元1年 1月1日 00:00:10\"}",
        };
        const appended = await callApi(handler, projectPath, "POST", "subject-file-proposals/events/commit", body);
        const duplicated = await callApi(handler, projectPath, "POST", "subject-file-proposals/events/commit", body);
        const eventsText = await fs.readFile(path.join(subjectRoot, "events.jsonl"), "utf-8");
        const dirtyText = await fs.readFile(path.join(projectRoot, ".nbook", "subject-rag-dirty.json"), "utf-8");

        expect(appended).toMatchObject({status: "appended", subjectId: "player", subjectPath, eventsPath, dirty: true});
        expect(duplicated).toMatchObject({status: "already-exists", subjectId: "player", subjectPath, eventsPath, dirty: false});
        expect(eventsText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as unknown)).toEqual([
            {text: "旧经历", time: "复兴纪元1年 1月1日 00:00:00"},
            {text: "我经历了新的世界变化。", time: "复兴纪元1年 1月1日 00:00:10"},
        ]);
        expect(dirtyText).toContain("\"events\"");
        await expect(callApi(handler, projectPath, "POST", "subject-file-proposals/events/commit", {
            ...body,
            eventsPath: `${subjectPath}/memory.jsonl`,
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "eventsPath 必须匹配 subjectPath/events.jsonl",
        });
    });

    it("GET slices 支持按 subjectIds 过滤作者查看的 subject 时间线", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await callApi(handler, projectPath, "POST", "subjects", {
            id: "moran",
            type: "character",
            name: "莫然",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "艾莉娜受伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });
        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "莫然行动",
            mutations: [{subjectId: "moran", attr: "hp", op: "set", value: 95}],
        });
        const shared = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:30",
            title: "两人联手",
            mutations: [
                {subjectId: "erina", attr: "events", op: "listAppend", value: "与莫然联手"},
                {subjectId: "moran", attr: "events", op: "listAppend", value: "与艾莉娜联手"},
            ],
        });

        const erinaSlices = await callApi(handler, projectPath, "GET", "slices", undefined, {subjectIds: "erina", withMutations: "true"});
        const anySlices = await callApi(handler, projectPath, "GET", "slices", undefined, {subjectIds: "erina,moran", subjectMode: "any"});
        const allSlices = await callApi(handler, projectPath, "GET", "slices", undefined, {subjectIds: "erina,moran", subjectMode: "all"});
        const fetchedShared = await callApi(handler, projectPath, "GET", `slices/${readSliceId(shared)}`);

        expect(sliceTitles(erinaSlices)).toEqual(expect.arrayContaining(["创建 艾莉娜", "艾莉娜受伤", "两人联手"]));
        expect(sliceTitles(erinaSlices)).not.toContain("莫然行动");
        expect(sliceTitles(anySlices)).toEqual(expect.arrayContaining(["艾莉娜受伤", "莫然行动", "两人联手"]));
        expect(sliceTitles(allSlices)).toEqual(["创建 艾莉娜", "两人联手"]);
        expect(fetchedShared).toMatchObject({
            id: readSliceId(shared),
            previousTime: "复兴纪元1年 1月1日 00:00:20",
            title: "两人联手",
            mutations: [
                expect.objectContaining({subjectId: "erina", attr: "events"}),
                expect.objectContaining({subjectId: "moran", attr: "events"}),
            ],
        });
    });

    it("HTTP editSlice 允许原样保存 createSubject 生成的 init list/collection set", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const slices = await callApi(handler, projectPath, "GET", "slices", undefined, {withMutations: "true"});
        const initSlice = readSingleSliceWithMutations(slices);

        const edited = await callApi(handler, projectPath, "POST", `slices/${initSlice.id}/edit`, {
            time: initSlice.time,
            title: "初始化确认",
            summary: initSlice.summary,
            kind: initSlice.kind,
            mutations: initSlice.mutations,
        });
        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["events", "inventory", "badges", "notes"],
        });

        expect(initSlice.mutations).toEqual(expect.arrayContaining([
            expect.objectContaining({subjectId: "erina", attr: "events", op: "set", value: []}),
            expect.objectContaining({subjectId: "erina", attr: "inventory", op: "set", value: []}),
            expect.objectContaining({subjectId: "erina", attr: "badges", op: "set", value: []}),
            expect.objectContaining({subjectId: "erina", attr: "notes", op: "set", value: []}),
        ]));
        expect(edited).toEqual({sliceId: initSlice.id, issues: []});
        expect(readSubjectState(state, "erina")).toMatchObject({
            attrs: {
                events: [],
                inventory: [],
                badges: [],
                notes: [],
            },
        });
    });

    it("HTTP editSlice 删除旧绝对 mutation 时返回下游 base-shifted", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "轻伤与经历",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "警惕起来"},
            ],
        });
        const downstream = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await callApi(handler, projectPath, "POST", `slices/${readSliceId(first)}/edit`, {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "只保留经历",
            mutations: [{subjectId: "erina", attr: "events", op: "listAppend", value: "警惕起来"}],
        });
        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["hp"],
        });

        expect(edited).toMatchObject({
            sliceId: readSliceId(first),
            issues: [expect.objectContaining({code: "base-shifted", sliceId: readSliceId(downstream), subjectId: "erina", attr: "hp"})],
        });
        expect(readSubjectState(state, "erina")).toMatchObject({attrs: {hp: 90}});
    });

    it("HTTP editSlice 纯重排相关 mutation 时返回下游 base-shifted", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "连续修正伤势",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
            ],
        });
        const downstream = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await callApi(handler, projectPath, "POST", `slices/${readSliceId(first)}/edit`, {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "调换伤势修正顺序",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["hp"],
        });

        expect(edited).toMatchObject({
            sliceId: readSliceId(first),
            issues: [expect.objectContaining({code: "base-shifted", sliceId: readSliceId(downstream), subjectId: "erina", attr: "hp"})],
        });
        expect(readSubjectState(state, "erina")).toMatchObject({attrs: {hp: 70}});
    });

    it("HTTP editSlice 新增无关 mutation 时仍检测保留 mutation 的相关重排", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const first = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "连续修正伤势",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
            ],
        });
        const downstream = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:20",
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await callApi(handler, projectPath, "POST", `slices/${readSliceId(first)}/edit`, {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "调换伤势修正顺序并补心境",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "警惕起来"},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["hp", "events"],
        });

        expect(edited).toMatchObject({
            sliceId: readSliceId(first),
            issues: [expect.objectContaining({code: "base-shifted", sliceId: readSliceId(downstream), subjectId: "erina", attr: "hp"})],
        });
        expect(readSubjectState(state, "erina")).toMatchObject({attrs: {hp: 70, events: ["警惕起来"]}});
    });

    it("HTTP edit/delete slice 拒绝带首尾空白的 sliceId path", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const slice = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "受伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });
        const sliceId = readSliceId(slice);

        await expect(callApi(handler, projectPath, "POST", `slices/%20${sliceId}%20/edit`, {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 sliceId",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: `sliceId 不能包含前后空白： ${sliceId} `,
        });
        await expect(callApi(handler, projectPath, "DELETE", `slices/%20${sliceId}%20`)).rejects.toMatchObject({
            statusCode: 400,
            message: `sliceId 不能包含前后空白： ${sliceId} `,
        });
    });

    it("state/query 拒绝未收窄的全量查询", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "state/query", {})).rejects.toMatchObject({
            statusCode: 400,
            message: "state/query 必须提供 subjectIds 或 type",
        });
    });

    it("state/query 拒绝缺失的 subjectIds", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina", "ghost"],
            attrs: ["hp"],
        })).rejects.toMatchObject({
            statusCode: 404,
            message: "subject 不存在或不匹配查询条件：ghost",
        });
    });

    it("state/query 拒绝重复 subjectIds", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina", "erina"],
            attrs: ["hp"],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "subjectIds 不能重复：erina",
        });
    });

    it("state/query 拒绝重复 attrs", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["hp", "hp"],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "attrs 不能重复：hp",
        });
    });

    it("state/query 拒绝带首尾空白路径段的 attrs", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["profile. tags "],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "attr 路径段不能包含前后空白：profile. tags ",
        });
    });

    it("按 type 查询时拒绝 schema 未声明的类型", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "state/query", {
            type: "creature",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "schema 未声明 subject type：creature",
        });
        await expect(callApi(handler, projectPath, "GET", "subjects", undefined, {type: "creature"})).rejects.toMatchObject({
            statusCode: 400,
            message: "schema 未声明 subject type：creature",
        });
    });

    it("HTTP query 参数不静默裁剪空白", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "subjects", undefined, {type: " character "})).rejects.toMatchObject({
            statusCode: 400,
            message: "subject type 不能包含空白： character ",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {limit: " 1 "})).rejects.toMatchObject({
            statusCode: 400,
            message: "limit 必须是正整数",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {withMutations: " true "})).rejects.toMatchObject({
            statusCode: 400,
            message: "withMutations 必须是 true 或 false",
        });
        await expect(callApi(handler, projectPath, "GET", "state", undefined, {at: " 复兴纪元1年 1月1日 00:00:00 "})).rejects.toMatchObject({
            statusCode: 400,
            message: "at 不能包含前后空白： 复兴纪元1年 1月1日 00:00:00 ",
        });
    });

    it("HTTP query 参数拒绝重复值数组", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "subjects", undefined, {type: ["character", "item"]})).rejects.toMatchObject({
            statusCode: 400,
            message: "type 只能传一个值",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {limit: ["1", "2"]})).rejects.toMatchObject({
            statusCode: 400,
            message: "limit 只能传一个值",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {withMutations: ["true", "false"]})).rejects.toMatchObject({
            statusCode: 400,
            message: "withMutations 只能传一个值",
        });
        await expect(callApi(handler, projectPath, "GET", "state", undefined, {at: ["复兴纪元1年 1月1日 00:00:00", "复兴纪元1年 1月1日 00:00:01"]})).rejects.toMatchObject({
            statusCode: 400,
            message: "at 只能传一个值",
        });
    });

    it("HTTP 公开时间入参拒绝 raw instant 调试格式", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            time: "instant:0",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "time 必须使用项目日历字符串，不能使用 instant:<number>",
        });
        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "instant:10",
            title: "raw instant",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "time 必须使用项目日历字符串，不能使用 instant:<number>",
        });
        await expect(callApi(handler, projectPath, "POST", "state/query", {
            type: "character",
            at: "instant:0",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "at 必须使用项目日历字符串，不能使用 instant:<number>",
        });
        await expect(callApi(handler, projectPath, "GET", "state", undefined, {at: "instant:0"})).rejects.toMatchObject({
            statusCode: 400,
            message: "at 必须使用项目日历字符串，不能使用 instant:<number>",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {from: "instant:0"})).rejects.toMatchObject({
            statusCode: 400,
            message: "from 必须使用项目日历字符串，不能使用 instant:<number>",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {to: "Instant:1"})).rejects.toMatchObject({
            statusCode: 400,
            message: "to 必须使用项目日历字符串，不能使用 instant:<number>",
        });
    });

    it("HTTP body 时间入参不静默裁剪空白", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            time: " 复兴纪元1年 1月1日 00:00:00 ",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "time 不能包含前后空白： 复兴纪元1年 1月1日 00:00:00 ",
        });
        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: " 复兴纪元1年 1月1日 00:00:10 ",
            title: "空白时间",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "time 不能包含前后空白： 复兴纪元1年 1月1日 00:00:10 ",
        });
        await expect(callApi(handler, projectPath, "POST", "state/query", {
            type: "character",
            at: " 复兴纪元1年 1月1日 00:00:00 ",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "at 不能包含前后空白： 复兴纪元1年 1月1日 00:00:00 ",
        });
    });

    it("HTTP 公开时间入参拒绝超出 SQLite 64 位范围的 instant", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "state/query", {
            type: "character",
            at: "复兴纪元999999999999年 1月1日 00:00:00",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("at 超出 SQLite INTEGER 64 位范围"),
        });
    });

    it("HTTP 公开日历时间支持零点前 instant", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元0年 12月30日 23:59:59",
        })).resolves.toMatchObject({subjectId: "erina", issues: []});

        await expect(callApi(handler, projectPath, "GET", "slices")).resolves.toEqual([
            expect.objectContaining({time: "复兴纪元0年 12月30日 23:59:59", kind: "init"}),
        ]);
    });

    it("slices limit query 必须是严格正整数", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {limit: "12abc"})).rejects.toMatchObject({
            statusCode: 400,
            message: "limit 必须是正整数",
        });
        await expect(callApi(handler, projectPath, "GET", "slices", undefined, {limit: "9007199254740992"})).rejects.toMatchObject({
            statusCode: 400,
            message: "limit 必须是安全正整数",
        });
    });

    it("HTTP slices 写入拒绝超过 100 条 mutations", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;
        const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);

        try {
            await expect(callApi(handler, projectPath, "POST", "slices", {
                time: "复兴纪元1年 1月1日 00:00:10",
                title: "过大切面",
                mutations: Array.from({length: 101}, (_, index) => ({
                    subjectId: "erina",
                    attr: "events",
                    op: "listAppend",
                    value: `事件 ${index}`,
                })),
            })).rejects.toMatchObject({
                statusCode: 400,
                message: "mutations 不能超过 100 条",
            });
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("HTTP subjects 创建 default 超过 100 条 mutation 时返回 400", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            ...Array.from({length: 101}, (_, index) => `      attr${index}: { kind: scalar, type: text, default: value${index} }`),
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "mutations 不能超过 100 条",
        });
    });

    it("HTTP subjects 不会把 init mutations 自动追加进非 init 切面", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  marker:",
            "    attrs:",
            "      note: { kind: scalar, type: text }",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: 100 }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;
        const initTime = "复兴纪元1年 1月1日 00:00:00";

        await callApi(handler, projectPath, "POST", "subjects", {id: "marker", type: "marker", name: "标记", time: initTime});
        await callApi(handler, projectPath, "POST", "slices", {
            time: initTime,
            title: "已有事件",
            kind: "event",
            mutations: [{subjectId: "marker", attr: "note", op: "set", value: "已发生"}],
        });

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: initTime,
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining("目标时间已有非 init 切面"),
        });
    });

    it("subjects 创建重复 id 时返回稳定 409", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "location",
            name: "同名地点",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toMatchObject({
            statusCode: 409,
            message: "subject 已存在：erina（当前 type=character, name=艾莉娜）",
        });
    });

    it("HTTP subjects 拒绝带首尾空白的 id", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: " erina ",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "id 不能包含前后空白： erina ",
        });
    });

    it("HTTP subjects 和 state/query 拒绝带空白的 subject type 入参", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: " player character ",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "subject type 不能包含空白： player character ",
        });
        await expect(callApi(handler, projectPath, "POST", "state/query", {
            type: "player character",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "subject type 不能包含空白：player character",
        });
    });

    it("HTTP slices 写入拒绝带首尾空白的 mutation subjectId", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 subjectId",
            mutations: [{subjectId: " erina ", attr: "hp", op: "set", value: 80}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "subjectId 不能包含前后空白： erina ",
        });
    });

    it("HTTP slices 写入拒绝空白 kind", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 kind",
            kind: " event ",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "kind 不能包含前后空白： event ",
        });
    });

    it("HTTP slices 写入拒绝不安全 int", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });

        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "不安全 int",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: Number.MAX_SAFE_INTEGER + 1}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "hp 必须是安全整数",
        });
    });

    it("HTTP slices 写入返回 int add 溢出的 broken-relative issue", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: 9007199254740991 }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        const result = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "溢出增量",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: 1}],
        });

        expect(result).toMatchObject({
            issues: [expect.objectContaining({code: "broken-relative", subjectId: "erina", attr: "hp", message: "add hp 结果超出安全整数范围"})],
        });
    });

    it("HTTP slices 写入返回 add 非有限结果的 broken-relative issue", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      score: { kind: scalar, type: float, default: 0 }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "极大分数",
            mutations: [{subjectId: "erina", attr: "score", op: "set", value: Number.MAX_VALUE}],
        });
        const result = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:11",
            title: "溢出分数",
            mutations: [{subjectId: "erina", attr: "score", op: "add", value: Number.MAX_VALUE}],
        });

        expect(result).toMatchObject({
            issues: [expect.objectContaining({code: "broken-relative", subjectId: "erina", attr: "score", message: "add score 结果不是有限数"})],
        });
    });

    it("HTTP slices 写入拒绝带首尾空白的 ref id", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;
        const initTime = "复兴纪元1年 1月1日 00:00:00";

        await callApi(handler, projectPath, "POST", "subjects", {id: "erina", type: "character", name: "艾莉娜", time: initTime});
        await callApi(handler, projectPath, "POST", "subjects", {id: "capital", type: "location", name: "王都", time: initTime});

        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:10",
            title: "空白 ref",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject:// capital "}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "location 引用 id 不能包含前后空白： capital ",
        });
    });

    it("跑通 preview 一键示例世界背后的真实 API 链路", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;
        const initTime = "复兴纪元1年 1月1日 00:00:00";

        const worldCreated = await callApi(handler, projectPath, "POST", "subjects", {id: "world", type: "world", name: "世界", time: initTime});
        const capitalCreated = await callApi(handler, projectPath, "POST", "subjects", {id: "capital", type: "location", name: "王都", time: initTime});
        const erinaCreated = await callApi(handler, projectPath, "POST", "subjects", {id: "erina", type: "character", name: "艾莉娜", time: initTime});
        const swordCreated = await callApi(handler, projectPath, "POST", "subjects", {id: "old-sword", type: "item", name: "旧剑", time: initTime});

        const writeResult = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:01",
            title: "示例：艾莉娜抵达王都",
            summary: "一键示例世界生成的第一条事件切面。",
            kind: "event",
            mutations: [
                {subjectId: "world", attr: "events", op: "listAppend", value: "世界引擎示例启动"},
                {subjectId: "capital", attr: "name", op: "set", value: "王都"},
                {subjectId: "capital", attr: "events", op: "listAppend", value: "艾莉娜抵达王都"},
                {subjectId: "erina", attr: "location", op: "set", value: "subject://capital"},
                {subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://old-sword"},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "抵达王都并拾起旧剑"},
                {subjectId: "old-sword", attr: "name", op: "set", value: "旧剑"},
                {subjectId: "old-sword", attr: "durability", op: "add", value: -5},
                {subjectId: "old-sword", attr: "events", op: "listAppend", value: "被艾莉娜拾起，剑身多了一道裂纹"},
            ],
        });
        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina", "old-sword", "world"],
            attrs: ["hp", "location", "inventory", "events", "durability", "era"],
            listLimit: 10,
        });
        const slices = await callApi(handler, projectPath, "GET", "slices", undefined, {withMutations: "true"});

        expect([worldCreated, capitalCreated, erinaCreated, swordCreated]).toEqual([
            {subjectId: "world", issues: []},
            {subjectId: "capital", issues: []},
            {subjectId: "erina", issues: []},
            {subjectId: "old-sword", issues: []},
        ]);
        expect(writeResult).toMatchObject({issues: []});
        expect(readSubjectState(state, "erina")).toMatchObject({
            subjectId: "erina",
            type: "character",
            attrs: {
                hp: 100,
                location: "subject://capital",
                inventory: ["subject://old-sword"],
                events: ["抵达王都并拾起旧剑"],
            },
        });
        expect(readSubjectState(state, "old-sword")).toMatchObject({
            subjectId: "old-sword",
            type: "item",
            attrs: {
                durability: 95,
                events: ["被艾莉娜拾起，剑身多了一道裂纹"],
            },
        });
        expect(readSubjectState(state, "world")).toMatchObject({
            subjectId: "world",
            type: "world",
            attrs: {
                era: "复兴纪元",
                events: ["世界引擎示例启动"],
            },
        });
        expect(slices).toEqual(expect.arrayContaining([
            expect.objectContaining({time: initTime, kind: "init", mutations: expect.any(Array)}),
            expect.objectContaining({time: "复兴纪元1年 1月1日 00:00:01", title: "示例：艾莉娜抵达王都", mutations: expect.any(Array)}),
        ]));
    });

    it("HTTP schema 拒绝带空白的 subject type", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  \" player character \":",
            "    attrs: {}",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "schema")).rejects.toMatchObject({
            statusCode: 400,
            message: "世界 schema 解析失败：subject type 不能包含空白： player character ",
        });
    });

    it("HTTP schema 拒绝非 object 根配置", async () => {
        const projectPath = await createProject([
            "- subjectTypes",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "schema")).rejects.toMatchObject({
            statusCode: 400,
            message: "世界 schema 解析失败：schema 配置必须是 object",
        });
    });

    it("HTTP schema 拒绝包含点号的 attr 名", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      \"memory.师门\": { kind: scalar, type: text }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "schema")).rejects.toMatchObject({
            statusCode: 400,
            message: "世界 schema 解析失败：attr 名不能包含 .：memory.师门",
        });
    });

    it("HTTP schema 拒绝非字符串 desc", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, desc: 123 }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "schema")).rejects.toMatchObject({
            statusCode: 400,
            message: "世界 schema 解析失败：desc 必须是字符串：hp.desc",
        });
    });

    it("HTTP 边界支持 object itemType 的写入、删除和查询", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        const schema = await callApi(handler, projectPath, "GET", "schema");
        await callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        });
        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:30",
            title: "对象项记录",
            mutations: [
                {subjectId: "erina", attr: "badges", op: "collectionAdd", value: {label: "north", score: 1}},
                {subjectId: "erina", attr: "badges", op: "collectionAdd", value: {score: 1, label: "north"}},
                {subjectId: "erina", attr: "badges", op: "collectionAdd", value: {label: "south", score: 2}},
                {subjectId: "erina", attr: "badges", op: "collectionRemove", value: {score: 1, label: "north"}},
                {subjectId: "erina", attr: "notes", op: "listAppend", value: {text: "抵达王都", mood: "calm"}},
                {subjectId: "erina", attr: "memories.second", op: "set", value: {text: "拿到旧剑"}},
            ],
        });

        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1年 1月1日 00:00:31",
            title: "错误对象项",
            mutations: [{subjectId: "erina", attr: "notes", op: "listAppend", value: "不是对象"}],
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "notes 必须是 object",
        });

        const state = await callApi(handler, projectPath, "POST", "state/query", {
            subjectIds: ["erina"],
            attrs: ["badges", "notes", "memories"],
        });

        expect(readSchemaAttr(schema, "character", "badges")).toMatchObject({kind: "collection", itemType: "object"});
        expect(readSubjectState(state, "erina")).toMatchObject({
            subjectId: "erina",
            type: "character",
            attrs: {
                badges: [{label: "south", score: 2}],
                notes: [{text: "抵达王都", mood: "calm"}],
                memories: {
                    first: {text: "初见王都"},
                    second: {text: "拿到旧剑"},
                },
            },
        });
    });

    it("HTTP 加载 schema 时校验 itemType object 的 schema default", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      notes: { kind: list, itemType: object, default: [bad] }",
            "",
        ]);
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "POST", "subjects", {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            time: "复兴纪元1年 1月1日 00:00:00",
        })).rejects.toMatchObject({
            statusCode: 400,
            message: "世界 schema 解析失败：notes[0] default 必须是 object",
        });
    });
});

async function createProject(schemaLines?: string[]): Promise<string> {
    const slug = `world-engine-api-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const projectRoot = path.join(resolveWorkspaceContainerRoot(), slug);
    await fs.mkdir(path.join(projectRoot, "world-engine"), {recursive: true});
    await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: World Engine API Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(projectRoot, "world-engine/schema.yaml"), (schemaLines ?? [
        "subjectTypes:",
        "  character:",
        "    attrs:",
        "      hp: { kind: scalar, type: int, default: 100 }",
        "      events: { kind: list, itemType: text, default: [] }",
        "      location: { kind: scalar, type: ref(location) }",
        "      inventory: { kind: collection, itemType: ref(item), default: [] }",
        "      badges: { kind: collection, itemType: object, default: [] }",
        "      notes: { kind: list, itemType: object, default: [] }",
        "      memories: { kind: object, itemType: object, default: { first: { text: 初见王都 } } }",
        "  item:",
        "    attrs:",
        "      name: { kind: scalar, type: text }",
        "      durability: { kind: scalar, type: int, default: 100 }",
        "      events: { kind: list, itemType: text, default: [] }",
        "  location:",
        "    attrs:",
        "      name: { kind: scalar, type: text }",
        "      events: { kind: list, itemType: text, default: [] }",
        "  world:",
        "    attrs:",
        "      era: { kind: scalar, type: text, default: 复兴纪元 }",
        "      events: { kind: list, itemType: text, default: [] }",
        "",
    ]).join("\n"), "utf-8");
    createdProjects.push(projectPath);
    return projectPath;
}

async function callApi(
    handler: (event: unknown) => Promise<unknown>,
    projectPath: string,
    method: string,
    segments: string,
    body?: unknown,
    query: Record<string, unknown> = {},
): Promise<unknown> {
    return handler({
        method,
        path: `/api/projects/world-engine/${segments}`,
        query: {projectPath, ...query},
        body,
        context: {params: {segments}},
    });
}

function readSliceId(input: unknown): string {
    if (typeof input === "object" && input !== null && "sliceId" in input && typeof input.sliceId === "string") {
        return input.sliceId;
    }
    throw new Error("测试没有拿到 sliceId");
}

type TestSliceMutation = {
    subjectId: string;
    attr: string;
    op: string;
    value?: unknown;
};

type TestSliceWithMutations = {
    id: string;
    time: string;
    title: string;
    summary: string;
    kind: string;
    mutations: TestSliceMutation[];
};

function readSingleSliceWithMutations(input: unknown): TestSliceWithMutations {
    if (!Array.isArray(input) || input.length !== 1) {
        throw new Error("测试没有拿到唯一 init slice");
    }
    const slice = input[0];
    if (typeof slice !== "object" || slice === null) {
        throw new Error("测试没有拿到 slice 对象");
    }
    const record = slice as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.time !== "string" || typeof record.title !== "string" || typeof record.summary !== "string" || typeof record.kind !== "string") {
        throw new Error("测试没有拿到完整 slice metadata");
    }
    if (!Array.isArray(record.mutations)) {
        throw new Error("测试没有拿到 slice mutations");
    }
    return {
        id: record.id,
        time: record.time,
        title: record.title,
        summary: record.summary,
        kind: record.kind,
        mutations: record.mutations.map(readTestSliceMutation),
    };
}

function readTestSliceMutation(input: unknown): TestSliceMutation {
    if (typeof input !== "object" || input === null) {
        throw new Error("测试没有拿到 mutation 对象");
    }
    const record = input as Record<string, unknown>;
    if (typeof record.subjectId !== "string" || typeof record.attr !== "string" || typeof record.op !== "string") {
        throw new Error("测试没有拿到完整 mutation");
    }
    return {
        subjectId: record.subjectId,
        attr: record.attr,
        op: record.op,
        ...("value" in record ? {value: record.value} : {}),
    };
}

function readSubjectState(input: unknown, subjectId: string): Record<string, unknown> {
    const subjects = typeof input === "object" && input !== null && "subjects" in input && Array.isArray((input as {subjects: unknown}).subjects)
        ? (input as {subjects: unknown[]}).subjects
        : null;
    if (!subjects) {
        throw new Error("测试没有拿到 state.subjects 数组");
    }
    const state = subjects.find((item) => typeof item === "object" && item !== null && "subjectId" in item && item.subjectId === subjectId);
    if (!state || typeof state !== "object") {
        throw new Error(`测试没有拿到 subject state：${subjectId}`);
    }
    return state as Record<string, unknown>;
}

function sliceTitles(input: unknown): string[] {
    if (!Array.isArray(input)) {
        throw new Error("测试没有拿到 slices 数组");
    }
    return input.map((slice) => {
        if (typeof slice !== "object" || slice === null || !("title" in slice) || typeof slice.title !== "string") {
            throw new Error("测试没有拿到 slice.title");
        }
        return slice.title;
    });
}

function readSchemaAttr(input: unknown, subjectType: string, attrName: string): Record<string, unknown> {
    if (typeof input !== "object" || input === null || !("subjectTypes" in input) || !Array.isArray(input.subjectTypes)) {
        throw new Error("测试没有拿到 schema subjectTypes");
    }
    const subject = input.subjectTypes.find((item) => typeof item === "object" && item !== null && "type" in item && item.type === subjectType);
    if (typeof subject !== "object" || subject === null || !("attrs" in subject) || !Array.isArray(subject.attrs)) {
        throw new Error(`测试没有拿到 schema subject：${subjectType}`);
    }
    const attr = subject.attrs.find((item) => typeof item === "object" && item !== null && "name" in item && item.name === attrName);
    if (typeof attr !== "object" || attr === null) {
        throw new Error(`测试没有拿到 schema attr：${subjectType}.${attrName}`);
    }
    return attr as Record<string, unknown>;
}

async function removeProjectRoot(projectRoot: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            await fs.rm(projectRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}
