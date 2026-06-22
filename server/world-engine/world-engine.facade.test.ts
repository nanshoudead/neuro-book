import fs from "node:fs/promises";
import path from "node:path";
import {PrismaLibSql} from "@prisma/adapter-libsql";
import {afterAll, afterEach, describe, expect, it} from "vitest";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {WorldEngineFacade, type JsonValue} from "nbook/server/world-engine";
import {resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";

const createdProjects: string[] = [];
const createdFacades: WorldEngineFacade[] = [];

describe("WorldEngineFacade", () => {
    afterEach(async () => {
        for (const facade of createdFacades.splice(0)) {
            await Promise.all(createdProjects.map((projectPath) => facade.closeProject(projectPath)));
        }
    });

    afterAll(async () => {
        for (const projectPath of createdProjects) {
            const projectRoot = path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length));
            await removeProjectRoot(projectRoot);
        }
        createdProjects.splice(0);
    }, 30_000);

    it("创建 subject、写切面并按需查询状态", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const createdSubject = await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const result = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "城北遭遇战",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "add", value: -20},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "被伏击"},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "捡到旧剑"},
            ],
        });

        expect(createdSubject).toEqual({subjectId: "erina", issues: []});
        expect(result.issues).toEqual([]);
        await expect(facade.writeSlice(projectPath, {instant: 10n, title: "重复", mutations: []})).rejects.toThrow("existingSliceId=");

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "events"], listLimit: 1});
        expect(state.subjects).toEqual([
            {subjectId: "erina", type: "character", attrs: {hp: 80, events: ["捡到旧剑"]}},
        ]);
        expect(state.issues).toEqual([]);

    });

    it("queryState 的 listLimit 只裁剪 schema 声明的 list 和 collection", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "记录履历",
            mutations: [
                {subjectId: "erina", attr: "events", op: "listAppend", value: "出发"},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "抵达"},
                {subjectId: "erina", attr: "profile", op: "set", value: {aliases: ["见习骑士", "旧剑持有者"], tags: ["north", "capital"]}},
            ],
        });

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["events", "profile"], listLimit: 1});

        expect(state.subjects).toEqual([
            {
                subjectId: "erina",
                type: "character",
                attrs: {
                    events: ["抵达"],
                    profile: {aliases: ["见习骑士", "旧剑持有者"], tags: ["north", "capital"]},
                },
            },
        ]);
    });

    it("queryState 拒绝重复 subjectIds", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.queryState(projectPath, {
            subjectIds: [],
            attrs: ["hp"],
        })).rejects.toThrow("subjectIds 不能为空");
        await expect(facade.queryState(projectPath, {
            subjectIds: ["erina", "erina"],
            attrs: ["hp"],
        })).rejects.toThrow("subjectIds 不能重复：erina");
    });

    it("queryState 拒绝重复 attrs 投影", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.queryState(projectPath, {
            subjectIds: ["erina"],
            attrs: [],
        })).rejects.toThrow("attrs 不能为空");
        await expect(facade.queryState(projectPath, {
            subjectIds: ["erina"],
            attrs: ["hp", "hp"],
        })).rejects.toThrow("attrs 不能重复：hp");
    });

    it("collectionAdd 会去重且 collectionRemove 会删除已有 ref 项", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      inventory: { kind: collection, itemType: ref(item), default: [] }",
            "  item:",
            "    attrs:",
            "      name: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.createSubject(projectPath, {id: "old-sword", type: "item", name: "旧剑", at: 0n});
        await facade.createSubject(projectPath, {id: "key", type: "item", name: "钥匙", at: 0n});

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "整理背包",
            mutations: [
                {subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://old-sword"},
                {subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://old-sword"},
                {subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://key"},
                {subjectId: "erina", attr: "inventory", op: "collectionRemove", value: "subject://old-sword"},
            ],
        });

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["inventory"]});

        expect(state.subjects).toEqual([
            {
                subjectId: "erina",
                type: "character",
                attrs: {
                    inventory: ["subject://key"],
                },
            },
        ]);
    });

    it("list/collection 支持 object itemType 并按稳定 JSON 处理 collection", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      badges: { kind: collection, itemType: object, default: [] }",
            "      notes: { kind: list, itemType: object, default: [] }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const schema = await facade.getWorldSchema(projectPath);
        expect(schema.subjectTypes[0].attrs).toEqual([
            {name: "badges", kind: "collection", type: "object", itemType: "object", enum: undefined, default: [], desc: undefined},
            {name: "notes", kind: "list", type: "object", itemType: "object", enum: undefined, default: [], desc: undefined},
        ]);

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "记录对象项",
            mutations: [
                {subjectId: "erina", attr: "badges", op: "collectionAdd", value: {label: "north", score: 1}},
                {subjectId: "erina", attr: "badges", op: "collectionAdd", value: {score: 1, label: "north"}},
                {subjectId: "erina", attr: "badges", op: "collectionAdd", value: {label: "south", score: 2}},
                {subjectId: "erina", attr: "badges", op: "collectionRemove", value: {score: 1, label: "north"}},
                {subjectId: "erina", attr: "notes", op: "listAppend", value: {text: "抵达王都", mood: "calm"}},
            ],
        });

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "错误对象项",
            mutations: [{subjectId: "erina", attr: "notes", op: "listAppend", value: "不是对象"}],
        })).rejects.toThrow("notes 必须是 object");

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["badges", "notes"]});
        expect(state.subjects).toEqual([
            {
                subjectId: "erina",
                type: "character",
                attrs: {
                    badges: [{label: "south", score: 2}],
                    notes: [{text: "抵达王都", mood: "calm"}],
                },
            },
        ]);
    });

    it("queryState 在 service 层拒绝非法 listLimit", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], listLimit: 0})).rejects.toThrow("listLimit 必须是 1..100 的整数");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], listLimit: -1})).rejects.toThrow("listLimit 必须是 1..100 的整数");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], listLimit: 1.5})).rejects.toThrow("listLimit 必须是 1..100 的整数");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], listLimit: 101})).rejects.toThrow("listLimit 必须是 1..100 的整数");
    });

    it("writeSlice 和 editSlice 拒绝空 mutations", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await expect(facade.writeSlice(projectPath, {instant: 10n, title: "空切面", mutations: []})).rejects.toThrow("mutations 不能为空");
        const slice = await facade.writeSlice(projectPath, {
            instant: 11n,
            title: "有效切面",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -1}],
        });
        await expect(facade.editSlice(projectPath, slice.sliceId, {instant: 11n, title: "编辑为空", mutations: []})).rejects.toThrow("mutations 不能为空");
    });

    it("writeSlice 和 editSlice 拒绝不可稳定过滤的 kind", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "空 kind",
            kind: "",
            mutations: [{subjectId: "erina", attr: "events", op: "listAppend", value: "记录"}],
        })).rejects.toThrow("kind 不能为空");
        const slice = await facade.writeSlice(projectPath, {
            instant: 11n,
            title: "有效切面",
            kind: "backstory",
            mutations: [{subjectId: "erina", attr: "events", op: "listAppend", value: "有效"}],
        });

        await expect(facade.editSlice(projectPath, slice.sliceId, {
            instant: 11n,
            title: "空白 kind",
            kind: " event ",
            mutations: [{subjectId: "erina", attr: "events", op: "listAppend", value: "有效"}],
        })).rejects.toThrow("kind 不能包含前后空白： event ");
    });

    it("writeSlice 和 editSlice 在 service 层拒绝超过 100 条 mutations", async () => {
        const projectPath = await createProject();
        const facade = createFacade();
        const tooManyMutations = Array.from({length: 101}, (_, index) => ({
            subjectId: "erina",
            attr: "events",
            op: "listAppend" as const,
            value: `事件 ${index}`,
        }));

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "过大切面",
            mutations: tooManyMutations,
        })).rejects.toThrow("mutations 不能超过 100 条");
        const slice = await facade.writeSlice(projectPath, {
            instant: 11n,
            title: "有效切面",
            mutations: [{subjectId: "erina", attr: "events", op: "listAppend", value: "有效"}],
        });

        await expect(facade.editSlice(projectPath, slice.sliceId, {
            instant: 11n,
            title: "编辑为过大切面",
            mutations: tooManyMutations,
        })).rejects.toThrow("mutations 不能超过 100 条");
    });

    it("createSubject 的 default mutations 也遵守单切面 100 条上限", async () => {
        const attrs = Array.from({length: 101}, (_, index) => `      attr${index}: { kind: scalar, type: text, default: value${index} }`);
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            ...attrs,
            "",
        ]);
        const facade = createFacade();

        await expect(facade.createSubject(projectPath, {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            at: 0n,
        })).rejects.toThrow("mutations 不能超过 100 条");
    });

    it("createSubject 追加 init mutations 时拒绝让已有切面超过 100 条", async () => {
        const seedDefaults = Array.from({length: 99}, (_, index) => `      attr${index}: { kind: scalar, type: text, default: value${index} }`);
        const projectPath = await createProject([
            "subjectTypes:",
            "  seed:",
            "    attrs:",
            ...seedDefaults,
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: 100 }",
            "      events: { kind: list, itemType: text, default: [] }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "seed", type: "seed", name: "种子", at: 0n});

        await expect(facade.createSubject(projectPath, {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            at: 0n,
        })).rejects.toThrow("mutations 不能超过 100 条");
    });

    it("createSubject 拒绝把 init mutations 自动追加进非 init 切面", async () => {
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
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "marker", type: "marker", name: "标记", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 0n,
            title: "已有事件",
            kind: "event",
            mutations: [{subjectId: "marker", attr: "note", op: "set", value: "已发生"}],
        });

        await expect(facade.createSubject(projectPath, {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            at: 0n,
        })).rejects.toThrow("目标时间已有非 init 切面");
        await expect(facade.listWorldSubjects(projectPath)).resolves.toEqual([{id: "marker", type: "marker", name: "标记"}]);
    });

    it("createSubject 允许把 init mutations 追加进同 instant 已有切面", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const world = await facade.createSubject(projectPath, {id: "world", type: "world", name: "世界", at: 0n});
        const erina = await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        const slices = await facade.listSlices(projectPath, {withMutations: true});
        const orderedStates = await facade.queryState(projectPath, {subjectIds: ["erina", "world"], attrs: ["hp", "era"]});
        expect(slices).toHaveLength(1);
        expect(world).toEqual({subjectId: "world", issues: []});
        expect(erina).toEqual({subjectId: "erina", issues: []});
        expect(slices[0].mutations?.map((mutation) => mutation.subjectId).sort()).toEqual(["erina", "erina", "world"]);
        expect(orderedStates.subjects.map((state) => state.subjectId)).toEqual(["erina", "world"]);

    });

    it("createSubject 在没有 default mutation 时不创建空切面", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  marker:",
            "    attrs:",
            "      name: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        const created = await facade.createSubject(projectPath, {id: "marker-1", type: "marker", name: "标记", at: 0n});
        const subjects = await facade.listWorldSubjects(projectPath);
        const slices = await facade.listSlices(projectPath, {withMutations: true});
        const state = await facade.queryState(projectPath, {subjectIds: ["marker-1"]});

        expect(created).toEqual({subjectId: "marker-1", issues: []});
        expect(subjects).toEqual([{id: "marker-1", type: "marker", name: "标记"}]);
        expect(slices).toEqual([]);
        expect(state.subjects).toEqual([{subjectId: "marker-1", type: "marker", attrs: {}}]);
        expect(state.issues).toEqual([]);
    });

    it("createSubject 拒绝重复 subject id 并返回业务错误", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.createSubject(projectPath, {id: "erina", type: "location", name: "同名地点", at: 0n})).rejects.toMatchObject({
            statusCode: 409,
            message: "subject 已存在：erina（当前 type=character, name=艾莉娜）",
        });
    });

    it("createSubject 在 service 层拒绝空白或带首尾空白的 subject id", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.createSubject(projectPath, {id: "", type: "character", name: "空", at: 0n})).rejects.toThrow("id 不能为空");
        await expect(facade.createSubject(projectPath, {id: "   ", type: "character", name: "空白", at: 0n})).rejects.toThrow("id 不能为空");
        await expect(facade.createSubject(projectPath, {id: " erina ", type: "character", name: "艾莉娜", at: 0n})).rejects.toThrow("id 不能包含前后空白： erina ");
    });

    it("createSubject 和按 type 查询拒绝不可稳定引用的 subject type 入参", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.createSubject(projectPath, {id: "erina", type: "", name: "空类型", at: 0n})).rejects.toThrow("subject type 不能为空");
        await expect(facade.createSubject(projectPath, {id: "erina", type: " player character ", name: "空白类型", at: 0n})).rejects.toThrow("subject type 不能包含空白： player character ");
        await expect(facade.createSubject(projectPath, {id: "erina", type: "player(character", name: "括号类型", at: 0n})).rejects.toThrow("subject type 不能包含括号：player(character");
        await expect(facade.queryState(projectPath, {type: ""})).rejects.toThrow("subject type 不能为空");
        await expect(facade.queryState(projectPath, {type: "player character"})).rejects.toThrow("subject type 不能包含空白：player character");
        await expect(facade.queryState(projectPath, {type: "player)character"})).rejects.toThrow("subject type 不能包含括号：player)character");
        await expect(facade.listWorldSubjects(projectPath, {type: ""})).rejects.toThrow("subject type 不能为空");
        await expect(facade.listWorldSubjects(projectPath, {type: "player\tcharacter"})).rejects.toThrow("subject type 不能包含空白：player\tcharacter");
        await expect(facade.listWorldSubjects(projectPath, {type: "player(character"})).rejects.toThrow("subject type 不能包含括号：player(character");
    });

    it("writeSlice 在 service 层拒绝带首尾空白的 mutation subjectId", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "空白 subjectId",
            mutations: [{subjectId: " erina ", attr: "hp", op: "set", value: 80}],
        })).rejects.toThrow("subjectId 不能包含前后空白： erina ");
    });

    it("listSlices 在 service 层拒绝非法 limit", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.listSlices(projectPath, {limit: 0})).rejects.toThrow("limit 必须是安全正整数");
        await expect(facade.listSlices(projectPath, {limit: -1})).rejects.toThrow("limit 必须是安全正整数");
        await expect(facade.listSlices(projectPath, {limit: 1.5})).rejects.toThrow("limit 必须是安全正整数");
        await expect(facade.listSlices(projectPath, {limit: Number.MAX_SAFE_INTEGER + 1})).rejects.toThrow("limit 必须是安全正整数");
    });

    it("service 层拒绝超出 SQLite 64 位范围的 instant", async () => {
        const projectPath = await createProject();
        const facade = createFacade();
        const tooLarge = BigInt("9223372036854775808");
        const tooSmall = BigInt("-9223372036854775809");

        await expect(facade.createSubject(projectPath, {id: "ghost", type: "character", name: "幽影", at: tooLarge})).rejects.toThrow("at 超出 SQLite INTEGER 64 位范围");

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await expect(facade.writeSlice(projectPath, {
            instant: tooLarge,
            title: "过远未来",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        })).rejects.toThrow("instant 超出 SQLite INTEGER 64 位范围");
        await expect(facade.getWorldState(projectPath, tooLarge)).rejects.toThrow("at 超出 SQLite INTEGER 64 位范围");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], at: tooLarge})).rejects.toThrow("at 超出 SQLite INTEGER 64 位范围");
        await expect(facade.listSlices(projectPath, {from: tooSmall})).rejects.toThrow("from 超出 SQLite INTEGER 64 位范围");
    });

    it("listSlices 拒绝 from 晚于 to 的时间范围", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.listSlices(projectPath, {from: 20n, to: 10n})).rejects.toThrow("from 不能晚于 to");
    });

    it("queryState 显式拒绝缺失的 subjectIds", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.queryState(projectPath, {})).rejects.toThrow("queryState 必须提供 subjectIds 或 type");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina", "ghost"], attrs: ["hp"]})).rejects.toThrow("subject 不存在或不匹配查询条件：ghost");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], type: "world", attrs: ["hp"]})).rejects.toThrow("subject 不存在或不匹配查询条件：erina");
        await expect(facade.queryState(projectPath, {subjectIds: [" erina "], attrs: ["hp"]})).rejects.toThrow("subjectId 不能包含前后空白： erina ");

        const worldState = await facade.getWorldState(projectPath);
        expect(worldState.subjects.map((subject) => subject.subjectId)).toContain("erina");
    });

    it("按 type 查询时拒绝 schema 未声明的类型", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.queryState(projectPath, {type: "creature"})).rejects.toThrow("schema 未声明 subject type：creature");
        await expect(facade.listWorldSubjects(projectPath, {type: "creature"})).rejects.toThrow("schema 未声明 subject type：creature");
    });

    it("queryState 拒绝带空段的 attrs 投影路径", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["profile..tags"]})).rejects.toThrow("attr 路径不能包含空段：profile..tags");
        await expect(facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["profile. tags "]})).rejects.toThrow("attr 路径段不能包含前后空白：profile. tags ");
    });

    it("createSubject 校验 schema default，失败时事务回滚 subject 身份", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      location: { kind: scalar, type: ref(location), default: subject://capital }",
            "      events: { kind: list, itemType: text, default: [] }",
            "  location:",
            "    attrs:",
            "      name: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n})).rejects.toThrow("引用目标不存在：subject://capital");
        await expect(facade.listWorldSubjects(projectPath)).resolves.toEqual([]);
        await expect(facade.listSlices(projectPath, {withMutations: true})).resolves.toEqual([]);
    });

    it("schema loader 拒绝非法 attr kind", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: numberish, type: int, default: 100 }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(projectPath)).rejects.toThrow("属性 kind 不合法：hp=numberish");
    });

    it("schema loader 拒绝不可稳定寻址的 attr 名", async () => {
        const dottedAttrProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      \"memory.师门\": { kind: scalar, type: text }",
            "",
        ]);
        const whitespaceAttrProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      \" hp \": { kind: scalar, type: int }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(dottedAttrProject)).rejects.toThrow("attr 名不能包含 .：memory.师门");
        await expect(facade.getWorldSchema(whitespaceAttrProject)).rejects.toThrow("attr 名不能包含前后空白： hp ");
    });

    it("schema loader 拒绝非法 subject type 与 attrs 结构", async () => {
        const invalidRootProject = await createProject([
            "- subjectTypes",
            "",
        ]);
        const emptyTypeProject = await createProject([
            "subjectTypes:",
            "  \"\":",
            "    attrs: {}",
            "",
        ]);
        const whitespaceTypeProject = await createProject([
            "subjectTypes:",
            "  \" player character \":",
            "    attrs: {}",
            "",
        ]);
        const bracketTypeProject = await createProject([
            "subjectTypes:",
            "  \"player(character\":",
            "    attrs: {}",
            "",
        ]);
        const whitespaceRefTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      friend: { kind: scalar, type: \"ref(player character)\" }",
            "",
        ]);
        const bracketRefTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      friend: { kind: scalar, type: \"ref(player(character)\" }",
            "",
        ]);
        const unknownRefTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      friend: { kind: scalar, type: ref(creature) }",
            "",
        ]);
        const invalidSubjectTypeProject = await createProject([
            "subjectTypes:",
            "  character: nope",
            "",
        ]);
        const invalidAttrsProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs: []",
            "",
        ]);
        const invalidSubjectDescProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    desc: 123",
            "    attrs: {}",
            "",
        ]);
        const invalidAttrDescProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, desc: 123 }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(invalidRootProject)).rejects.toThrow("schema 配置必须是 object");
        await expect(facade.getWorldSchema(emptyTypeProject)).rejects.toThrow("subject type 不能为空");
        await expect(facade.getWorldSchema(whitespaceTypeProject)).rejects.toThrow("subject type 不能包含空白： player character ");
        await expect(facade.getWorldSchema(bracketTypeProject)).rejects.toThrow("subject type 不能包含括号：player(character");
        await expect(facade.getWorldSchema(whitespaceRefTypeProject)).rejects.toThrow("subject type 不能包含空白：player character");
        await expect(facade.getWorldSchema(bracketRefTypeProject)).rejects.toThrow("subject type 不能包含括号：player(character");
        await expect(facade.getWorldSchema(unknownRefTypeProject)).rejects.toThrow("schema ref 指向未声明 subject type：subjectTypes.character.attrs.friend -> creature");
        await expect(facade.getWorldSchema(invalidSubjectTypeProject)).rejects.toThrow("schema 字段必须是 object：subjectTypes.character");
        await expect(facade.getWorldSchema(invalidAttrsProject)).rejects.toThrow("schema 字段必须是 object：subjectTypes.character.attrs");
        await expect(facade.getWorldSchema(invalidSubjectDescProject)).rejects.toThrow("desc 必须是字符串：subjectTypes.character.desc");
        await expect(facade.getWorldSchema(invalidAttrDescProject)).rejects.toThrow("desc 必须是字符串：hp.desc");
    }, 10_000);

    it("schema loader 拒绝非法 enum 与非 JSON default", async () => {
        const invalidEnumProject = await createProject([
            "subjectTypes:",
            "  quest:",
            "    attrs:",
            "      status: { kind: scalar, type: enum, enum: active }",
            "",
        ]);
        const invalidDefaultProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: float, default: .nan }",
            "",
        ]);
        const invalidTypedDefaultProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: bad }",
            "",
        ]);
        const unsafeIntDefaultProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: 9007199254740992 }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(invalidEnumProject)).rejects.toThrow("属性 enum 必须是 array：status");
        await expect(facade.getWorldSchema(invalidDefaultProject)).rejects.toThrow("属性 default 必须是 JSON 值：hp");
        await expect(facade.getWorldSchema(invalidTypedDefaultProject)).rejects.toThrow("hp default 必须是 int");
        await expect(facade.getWorldSchema(unsafeIntDefaultProject)).rejects.toThrow("hp default 必须是安全整数");
    });

    it("schema loader 拒绝重复 enum 候选值", async () => {
        const duplicatedScalarProject = await createProject([
            "subjectTypes:",
            "  quest:",
            "    attrs:",
            "      status: { kind: scalar, type: enum, enum: [active, active] }",
            "",
        ]);
        const duplicatedObjectProject = await createProject([
            "subjectTypes:",
            "  quest:",
            "    attrs:",
            "      status:",
            "        kind: scalar",
            "        type: enum",
            "        enum:",
            "          - { phase: active, flag: urgent }",
            "          - { flag: urgent, phase: active }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(duplicatedScalarProject)).rejects.toThrow("属性 enum 不能包含重复值：status[0] / status[1]");
        await expect(facade.getWorldSchema(duplicatedObjectProject)).rejects.toThrow("属性 enum 不能包含重复值：status[0] / status[1]");
    });

    it("enum 对象值校验忽略 key 顺序", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  quest:",
            "    attrs:",
            "      status:",
            "        kind: scalar",
            "        type: enum",
            "        enum:",
            "          - { phase: active, flag: urgent }",
            "        default: { flag: urgent, phase: active }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "quest-01", type: "quest", name: "救援任务", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "状态确认",
            mutations: [{subjectId: "quest-01", attr: "status", op: "set", value: {flag: "urgent", phase: "active"}}],
        });

        const state = await facade.queryState(projectPath, {subjectIds: ["quest-01"], attrs: ["status"]});
        expect(state.subjects[0].attrs.status).toEqual({flag: "urgent", phase: "active"});
    });

    it("schema loader 拒绝非法 type/itemType 结构", async () => {
        const invalidTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: integer }",
            "",
        ]);
        const scalarObjectTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      profile: { kind: scalar, type: object }",
            "",
        ]);
        const missingItemTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      events: { kind: list }",
            "",
        ]);
        const missingEnumValuesProject = await createProject([
            "subjectTypes:",
            "  quest:",
            "    attrs:",
            "      status: { kind: scalar, type: enum }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(invalidTypeProject)).rejects.toThrow("属性 type 不合法：hp=integer");
        await expect(facade.getWorldSchema(scalarObjectTypeProject)).rejects.toThrow("属性 type 不合法：profile=object");
        await expect(facade.getWorldSchema(missingItemTypeProject)).rejects.toThrow("events(list) 必须声明 itemType");
        await expect(facade.getWorldSchema(missingEnumValuesProject)).rejects.toThrow("status(enum) 必须声明非空 enum");
    });

    it("schema loader 拒绝 attr kind 与 type/itemType/fields 的非法组合", async () => {
        const scalarItemTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, itemType: int }",
            "",
        ]);
        const listTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      events: { kind: list, type: text, itemType: text }",
            "",
        ]);
        const scalarFieldsProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      profile: { kind: scalar, fields: { name: { type: text } } }",
            "",
        ]);
        const objectTypeProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      profile: { kind: object, type: text }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.getWorldSchema(scalarItemTypeProject)).rejects.toThrow("hp(scalar) 不能声明 itemType");
        await expect(facade.getWorldSchema(listTypeProject)).rejects.toThrow("events(list) 不能声明 type，请使用 itemType");
        await expect(facade.getWorldSchema(scalarFieldsProject)).rejects.toThrow("profile(scalar) 不能声明 fields");
        await expect(facade.getWorldSchema(objectTypeProject)).rejects.toThrow("profile(object) 不能声明 type");
    });

    it("编辑过去绝对 set，下游有相对 add 时返回 base-shifted 提醒（A）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "轻伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "伤势修正",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 90}],
        });
        expect(edited.sliceId).toBe(first.sliceId);
        expect(edited.issues).toEqual([
            expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "hp"}),
        ]);

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        expect(state.subjects[0].attrs.hp).toBe(80);
    });

    it("editSlice 原样保存已有 mutation 时不重复返回 A issue", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "轻伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "轻伤（只改标题）",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });

        expect(edited).toEqual({sliceId: first.sliceId, issues: []});
    });

    it("editSlice 把基准切面移到下游相对 op 之后时返回 base-shifted（A）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "轻伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });
        const downstream = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 30n,
            title: "轻伤改到之后",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 80}],
        });

        expect(edited.issues).toEqual([
            expect.objectContaining({code: "base-shifted", sliceId: downstream.sliceId, subjectId: "erina", attr: "hp"}),
        ]);
    });

    it("editSlice 删除旧绝对 mutation 时仍返回下游 base-shifted（A）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "轻伤与心境",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "mind", op: "set", value: "警惕"},
            ],
        });
        const downstream = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "只保留心境",
            mutations: [{subjectId: "erina", attr: "mind", op: "set", value: "警惕"}],
        });

        expect(edited.issues).toEqual([
            expect.objectContaining({code: "base-shifted", sliceId: downstream.sliceId, subjectId: "erina", attr: "hp"}),
        ]);
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        expect(state.subjects[0].attrs.hp).toBe(90);
    });

    it("editSlice 修改同切面其他 mutation 时不为未变化的绝对 mutation 返回 A issue", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "轻伤与心境",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "mind", op: "set", value: "警惕"},
            ],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "调整心境",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "mind", op: "set", value: "冷静"},
            ],
        });

        expect(edited.issues).toEqual([]);
    });

    it("editSlice 纯重排相关 mutation 时返回下游 base-shifted（A）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "连续修正伤势",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
            ],
        });
        const downstream = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "调换伤势修正顺序",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});

        expect(edited.issues).toEqual([
            expect.objectContaining({code: "base-shifted", sliceId: downstream.sliceId, subjectId: "erina", attr: "hp"}),
        ]);
        expect(state.subjects[0].attrs.hp).toBe(70);
    });

    it("editSlice 纯重排无关 mutation 时不为未变化绝对 mutation 返回 A issue", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "伤势与心境",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "mind", op: "set", value: "警惕"},
            ],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "先记心境再记伤势",
            mutations: [
                {subjectId: "erina", attr: "mind", op: "set", value: "警惕"},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});

        expect(edited.issues).toEqual([]);
        expect(state.subjects[0].attrs.hp).toBe(70);
    });

    it("editSlice 新增无关 mutation 时仍检测保留 mutation 的相关重排", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "连续修正伤势",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
            ],
        });
        const downstream = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "继续战斗",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "调换伤势修正顺序并补心境",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "set", value: 90},
                {subjectId: "erina", attr: "mind", op: "set", value: "警惕"},
                {subjectId: "erina", attr: "hp", op: "set", value: 80},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "mind"]});

        expect(edited.issues).toEqual([
            expect.objectContaining({code: "base-shifted", sliceId: downstream.sliceId, subjectId: "erina", attr: "hp"}),
        ]);
        expect(state.subjects[0].attrs).toMatchObject({hp: 70, mind: "警惕"});
    });

    it("过去整体 set object 会提醒下游子路径相对 op 的 base-shifted（A）", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      stats:",
            "        kind: object",
            "        fields:",
            "          hp: { kind: scalar, type: int }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const baseSlice = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "设定状态",
            mutations: [{subjectId: "erina", attr: "stats", op: "set", value: {hp: 100}}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "受伤",
            mutations: [{subjectId: "erina", attr: "stats.hp", op: "add", value: -10}],
        });

        const edited = await facade.editSlice(projectPath, baseSlice.sliceId, {
            instant: 10n,
            title: "修正状态",
            mutations: [{subjectId: "erina", attr: "stats", op: "set", value: {hp: 120}}],
        });

        expect(edited.issues).toEqual([
            expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "stats.hp"}),
        ]);
    });

    it("过去整体 set object 会分别提醒多个下游子路径的 A issue", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      stats:",
            "        kind: object",
            "        fields:",
            "          hp: { kind: scalar, type: int }",
            "          mp: { kind: scalar, type: int }",
            "          note: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const baseSlice = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "设定状态",
            mutations: [{subjectId: "erina", attr: "stats", op: "set", value: {hp: 100, mp: 30, note: "稳定"}}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "备注变化",
            mutations: [{subjectId: "erina", attr: "stats.note", op: "set", value: "被覆盖的备注"}],
        });
        await facade.writeSlice(projectPath, {
            instant: 30n,
            title: "生命变化",
            mutations: [{subjectId: "erina", attr: "stats.hp", op: "add", value: -10}],
        });
        await facade.writeSlice(projectPath, {
            instant: 40n,
            title: "魔力变化",
            mutations: [{subjectId: "erina", attr: "stats.mp", op: "add", value: 5}],
        });

        const edited = await facade.editSlice(projectPath, baseSlice.sliceId, {
            instant: 10n,
            title: "修正状态",
            mutations: [{subjectId: "erina", attr: "stats", op: "set", value: {hp: 120, mp: 40, note: "稳定"}}],
        });

        expect(edited.issues).toHaveLength(3);
        expect(edited.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "masked", subjectId: "erina", attr: "stats.note"}),
            expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "stats.hp"}),
            expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "stats.mp"}),
        ]));
    });

    it("往过去写绝对 set 被下游绝对 set 覆盖时返回 masked 提醒（A）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "重设体力",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 50}],
        });

        const inserted = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "补一个中途体力",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: 999}],
        });
        expect(inserted.issues).toEqual([
            expect.objectContaining({code: "masked", subjectId: "erina", attr: "hp"}),
        ]);

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        expect(state.subjects[0].attrs.hp).toBe(50);
    });

    it("删除建立基准的切面后，下游相对 op 在 reduce 时显形 broken-relative（E）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "受伤并记录",
            mutations: [
                {subjectId: "erina", attr: "hp", op: "add", value: -10},
                {subjectId: "erina", attr: "events", op: "listAppend", value: "受伤"},
            ],
        });
        const initSlice = (await facade.listSlices(projectPath)).find((slice) => slice.kind === "init");

        const deleted = await facade.deleteSlice(projectPath, initSlice?.id ?? "");
        expect(deleted.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "broken-relative", subjectId: "erina", attr: "hp"}),
            expect.objectContaining({code: "broken-relative", subjectId: "erina", attr: "events"}),
        ]));

        // getState 读时也现算同样的 E，并把它归属到显形切面
        const state = await facade.getWorldState(projectPath);
        expect(state.issues.some((issue) => issue.code === "broken-relative")).toBe(true);
    });

    it("读状态时把缺失 ref 目标报告为 dangling-ref（E）", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.createSubject(projectPath, {id: "capital", type: "location", name: "王都", at: 0n});
        const relationSlice = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "抵达王都",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject://capital"}],
        });

        await deleteWorldSubject(projectPath, "capital");

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["location"]});
        const slices = await facade.listSlices(projectPath);
        expect(state.subjects[0].attrs.location).toBe("subject://capital");
        expect(state.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", sliceId: relationSlice.sliceId, subjectId: "erina", attr: "location"}),
        ]);
        expect(slices.find((slice) => slice.id === relationSlice.sliceId)?.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", subjectId: "erina", attr: "location"}),
        ]);
    });

    it("queryState 使用 attrs 投影时只返回相关属性的 E issue", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.createSubject(projectPath, {id: "capital", type: "location", name: "王都", at: 0n});
        const relationSlice = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "抵达王都",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject://capital"}],
        });

        await deleteWorldSubject(projectPath, "capital");

        const hpState = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        const locationState = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["location"]});
        const fullState = await facade.queryState(projectPath, {subjectIds: ["erina"]});

        expect(hpState.subjects[0].attrs).toEqual({hp: 100});
        expect(hpState.issues).toEqual([]);
        expect(locationState.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", sliceId: relationSlice.sliceId, subjectId: "erina", attr: "location"}),
        ]);
        expect(fullState.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", sliceId: relationSlice.sliceId, subjectId: "erina", attr: "location"}),
        ]);
    });

    it("collection ref 的 dangling-ref 归属到写入该元素的切面", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      inventory: { kind: collection, itemType: ref(item), default: [] }",
            "  item:",
            "    attrs:",
            "      name: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.createSubject(projectPath, {id: "old-sword", type: "item", name: "旧剑", at: 0n});
        await facade.createSubject(projectPath, {id: "key", type: "item", name: "钥匙", at: 0n});
        const swordSlice = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "拾起旧剑",
            mutations: [{subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://old-sword"}],
        });
        const keySlice = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "拾起钥匙",
            mutations: [{subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://key"}],
        });

        await deleteWorldSubject(projectPath, "old-sword");

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["inventory"]});
        const slices = await facade.listSlices(projectPath);
        expect(state.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", sliceId: swordSlice.sliceId, subjectId: "erina", attr: "inventory[0]"}),
        ]);
        expect(slices.find((slice) => slice.id === swordSlice.sliceId)?.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", subjectId: "erina", attr: "inventory[0]"}),
        ]);
        expect(slices.find((slice) => slice.id === keySlice.sliceId)?.issues).toBeUndefined();
    });

    it("deleteSlice 物理删除切面；删不存在的切面报 404", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const slice = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "受伤",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        });

        await expect(facade.editSlice(projectPath, ` ${slice.sliceId} `, {
            instant: 10n,
            title: "空白 sliceId",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -10}],
        })).rejects.toThrow(`sliceId 不能包含前后空白： ${slice.sliceId} `);
        await expect(facade.deleteSlice(projectPath, ` ${slice.sliceId} `)).rejects.toThrow(`sliceId 不能包含前后空白： ${slice.sliceId} `);

        const deleted = await facade.deleteSlice(projectPath, slice.sliceId);
        expect(deleted.issues).toEqual([]);
        const slices = await facade.listSlices(projectPath);
        expect(slices.some((item) => item.id === slice.sliceId)).toBe(false);
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        expect(state.subjects[0].attrs.hp).toBe(100);

        await expect(facade.deleteSlice(projectPath, "missing")).rejects.toThrow("切面不存在");
    });

    it("editSlice 只改元数据、且无下游相对依赖时不产生提醒", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "记录身份",
            mutations: [{subjectId: "erina", attr: "profile", op: "set", value: {aliases: ["旧剑持有者"], tags: ["capital"]}}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "后续事件",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -1}],
        });

        const edited = await facade.editSlice(projectPath, first.sliceId, {
            instant: 10n,
            title: "记录身份（改标题）",
            mutations: [{subjectId: "erina", attr: "profile", op: "set", value: {tags: ["capital"], aliases: ["旧剑持有者"]}}],
        });

        expect(edited).toEqual({sliceId: first.sliceId, issues: []});
    });

    it("校验动态属性限制与 ref 目标类型", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.createSubject(projectPath, {id: "capital", type: "location", name: "王都", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误动态属性",
            mutations: [{subjectId: "erina", attr: "unknownList", op: "listAppend", value: "x"}],
        })).rejects.toThrow("未声明属性只允许 set/unset");

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "错误引用",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject://erina"}],
        })).rejects.toThrow("引用目标类型不匹配");

        await expect(facade.writeSlice(projectPath, {
            instant: 12n,
            title: "空引用",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject://"}],
        })).rejects.toThrow("location 引用 id 不能为空");

        await expect(facade.writeSlice(projectPath, {
            instant: 13n,
            title: "空白引用",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject:// capital "}],
        })).rejects.toThrow("location 引用 id 不能包含前后空白： capital ");

        await facade.writeSlice(projectPath, {
            instant: 14n,
            title: "抵达王都",
            mutations: [{subjectId: "erina", attr: "location", op: "set", value: "subject://capital"}],
        });

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["location"]});
        expect(state.subjects[0].attrs.location).toBe("subject://capital");

    });

    it("object 属性整体 set 时按 fields/itemType 校验子值", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      memory: { kind: object, itemType: text }",
            "      equipment:",
            "        kind: object",
            "        fields:",
            "          weapon: { kind: scalar, type: ref(item) }",
            "  item:",
            "    attrs:",
            "      name: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.createSubject(projectPath, {id: "old-sword", type: "item", name: "旧剑", at: 0n});

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "整体更新对象",
            mutations: [
                {subjectId: "erina", attr: "memory", op: "set", value: {capital: "王都很安全"}},
                {subjectId: "erina", attr: "equipment", op: "set", value: {weapon: "subject://old-sword"}},
            ],
        });

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "错误开放对象值",
            mutations: [{subjectId: "erina", attr: "memory", op: "set", value: {capital: 1}}],
        })).rejects.toThrow("memory.capital 必须是 text");
        await expect(facade.writeSlice(projectPath, {
            instant: 12n,
            title: "错误固定对象字段",
            mutations: [{subjectId: "erina", attr: "equipment", op: "set", value: {ring: "subject://old-sword"}}],
        })).rejects.toThrow("equipment.ring 未在 object.fields 声明");

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["memory", "equipment"]});
        expect(state.subjects[0].attrs).toEqual({
            memory: {capital: "王都很安全"},
            equipment: {weapon: "subject://old-sword"},
        });
    });

    it("开放 object 支持 itemType object 并校验每个子值", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      memories: { kind: object, itemType: object, default: { first: { text: 初见王都 } } }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "追加对象记忆",
            mutations: [{subjectId: "erina", attr: "memories.second", op: "set", value: {text: "拿到旧剑"}}],
        });

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "错误对象记忆",
            mutations: [{subjectId: "erina", attr: "memories.third", op: "set", value: "不是对象"}],
        })).rejects.toThrow("memories.third 必须是 object");

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["memories"]});
        expect(state.subjects[0].attrs.memories).toEqual({
            first: {text: "初见王都"},
            second: {text: "拿到旧剑"},
        });
    });

    it("object default 会按 itemType 校验子值", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      memory: { kind: object, itemType: text, default: { capital: 1 } }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n})).rejects.toThrow("memory.capital default 必须是 text");
    });

    it("itemType object 的 default 必须逐项为 JSON object", async () => {
        const listProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      notes: { kind: list, itemType: object, default: [bad] }",
            "",
        ]);
        const collectionProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      badges: { kind: collection, itemType: object, default: [1] }",
            "",
        ]);
        const objectProject = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      memories: { kind: object, itemType: object, default: { first: bad } }",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.createSubject(listProject, {id: "erina", type: "character", name: "艾莉娜", at: 0n})).rejects.toThrow("notes[0] default 必须是 object");
        await expect(facade.createSubject(collectionProject, {id: "erina", type: "character", name: "艾莉娜", at: 0n})).rejects.toThrow("badges[0] default 必须是 object");
        await expect(facade.createSubject(objectProject, {id: "erina", type: "character", name: "艾莉娜", at: 0n})).rejects.toThrow("memories.first default 必须是 object");
    });

    it("unset 不允许携带 value，避免写入无语义载荷", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误 unset",
            mutations: [{subjectId: "erina", attr: "mind", op: "unset", value: null}],
        })).rejects.toThrow("mind 使用 unset 时不能提供 value");
    });

    it("非 unset mutation 必须显式携带 value，避免隐式写入 null", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "缺少 set value",
            mutations: [{subjectId: "erina", attr: "dynamicNote", op: "set"}],
        })).rejects.toThrow("dynamicNote 使用 set 时必须提供 value");
        await facade.writeSlice(projectPath, {
            instant: 11n,
            title: "显式设置 null",
            mutations: [{subjectId: "erina", attr: "dynamicNote", op: "set", value: null}],
        });

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["dynamicNote"]});
        expect(state.subjects[0].attrs.dynamicNote).toBeNull();
    });

    it("只有数值 scalar 支持 add", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "文本不能 add",
            mutations: [{subjectId: "erina", attr: "mind", op: "add", value: 1}],
        })).rejects.toThrow("mind(scalar) 不支持 add");

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "引用不能 add",
            mutations: [{subjectId: "erina", attr: "location", op: "add", value: 1}],
        })).rejects.toThrow("location(scalar) 不支持 add");

        await expect(facade.writeSlice(projectPath, {
            instant: 12n,
            title: "对象不能 add",
            mutations: [{subjectId: "erina", attr: "profile", op: "add", value: 1}],
        })).rejects.toThrow("profile(object) 不支持 add");

        await facade.writeSlice(projectPath, {
            instant: 13n,
            title: "数值可以 add",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: -5}],
        });

        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        expect(state.subjects[0].attrs.hp).toBe(95);
    });

    it("拒绝 NaN / Infinity 与不安全整数进入数值 mutation", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: 100 }",
            "      score: { kind: scalar, type: float, default: 0 }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "非法 add",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: Number.NaN}],
        })).rejects.toThrow("hp 使用 add 时 value 必须是 finite number");
        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "非法 float",
            mutations: [{subjectId: "erina", attr: "score", op: "set", value: Number.POSITIVE_INFINITY}],
        })).rejects.toThrow("score 必须是 float");
        await expect(facade.writeSlice(projectPath, {
            instant: 12n,
            title: "不安全 int",
            mutations: [{subjectId: "erina", attr: "hp", op: "set", value: Number.MAX_SAFE_INTEGER + 1}],
        })).rejects.toThrow("hp 必须是安全整数");
        await expect(facade.writeSlice(projectPath, {
            instant: 13n,
            title: "不安全 int add",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: Number.MAX_SAFE_INTEGER + 1}],
        })).rejects.toThrow("hp 必须是安全整数");
    });

    it("int add 结果超出安全整数范围时返回 broken-relative", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      hp: { kind: scalar, type: int, default: 9007199254740991 }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        const result = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "溢出增量",
            mutations: [{subjectId: "erina", attr: "hp", op: "add", value: 1}],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "broken-relative", sliceId: result.sliceId, subjectId: "erina", attr: "hp", message: "add hp 结果超出安全整数范围"}),
        ]));
        expect(state.subjects[0].attrs.hp).toBe(Number.MAX_SAFE_INTEGER);
        expect(state.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "broken-relative", sliceId: result.sliceId, subjectId: "erina", attr: "hp"}),
        ]));
    });

    it("add 结果不是有限数时返回 broken-relative", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  character:",
            "    attrs:",
            "      score: { kind: scalar, type: float, default: 0 }",
            "",
        ]);
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});
        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "设定极大分数",
            mutations: [{subjectId: "erina", attr: "score", op: "set", value: Number.MAX_VALUE}],
        });
        const result = await facade.writeSlice(projectPath, {
            instant: 11n,
            title: "溢出分数",
            mutations: [{subjectId: "erina", attr: "score", op: "add", value: Number.MAX_VALUE}],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["score"]});

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "broken-relative", sliceId: result.sliceId, subjectId: "erina", attr: "score", message: "add score 结果不是有限数"}),
        ]));
        expect(state.subjects[0].attrs.score).toBe(Number.MAX_VALUE);
        expect(state.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "broken-relative", sliceId: result.sliceId, subjectId: "erina", attr: "score"}),
        ]));
    });

    it("动态属性 set 也拒绝非 JSON value", async () => {
        const projectPath = await createProject();
        const facade = createFacade();
        // 测试运行时非法输入：模拟非 HTTP / Agent 调用绕过 TypeScript 的 JsonValue 类型。
        const nonJsonObject = new Date("2026-06-20T00:00:00.000Z") as unknown as JsonValue;

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "非法动态属性",
            mutations: [{subjectId: "erina", attr: "dynamicScore", op: "set", value: Number.NaN}],
        })).rejects.toThrow("dynamicScore value 必须是 JSON 值");
        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "非法嵌套动态属性",
            mutations: [{subjectId: "erina", attr: "dynamicProfile", op: "set", value: {score: Number.POSITIVE_INFINITY}}],
        })).rejects.toThrow("dynamicProfile value 必须是 JSON 值");
        await expect(facade.writeSlice(projectPath, {
            instant: 12n,
            title: "非普通对象动态属性",
            mutations: [{subjectId: "erina", attr: "dynamicProfile", op: "set", value: nonJsonObject}],
        })).rejects.toThrow("dynamicProfile value 必须是 JSON 值");
    });

    it("拒绝带空段的 attr 路径", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.createSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜", at: 0n});

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "非法路径",
            mutations: [{subjectId: "erina", attr: "profile..tags", op: "set", value: ["capital"]}],
        })).rejects.toThrow("attr 路径不能包含空段：profile..tags");
        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "空白路径段",
            mutations: [{subjectId: "erina", attr: "profile. tags ", op: "set", value: ["capital"]}],
        })).rejects.toThrow("attr 路径段不能包含前后空白：profile. tags ");
    });

    it("默认 Calendar 可以 format/parse 同一个 instant", async () => {
        const projectPath = await createProject();
        const facade = createFacade();
        const text = await facade.formatTime(projectPath, 15151500000n);
        const beforeZero = await facade.formatTime(projectPath, -1n);
        const schema = await facade.getWorldSchema(projectPath);

        expect(text).toBe("复兴纪元488年 2月15日 14:00:00");
        expect(await facade.parseTime(projectPath, text)).toBe(15151500000n);
        expect(beforeZero).toBe("复兴纪元0年 12月30日 23:59:59");
        expect(await facade.parseTime(projectPath, beforeZero)).toBe(-1n);
        expect(await facade.parseTime(projectPath, "instant:-5")).toBe(-5n);
        expect(schema.calendar.examples).toContain("复兴纪元488年 1月15日 14:00:00");
    });

    it("Calendar 配置显式拒绝非法单位和缺 token 的 format", async () => {
        const invalidRootProject = await createProject(undefined, [
            "- nope",
            "",
        ]);
        const invalidUnitProject = await createProject(undefined, [
            "hoursPerDay: nope",
            "",
        ]);
        const invalidEraProject = await createProject(undefined, [
            "era: 123",
            "",
        ]);
        const invalidFormatProject = await createProject(undefined, [
            "format: \"{era}{year}年\"",
            "",
        ]);
        const duplicatedYearProject = await createProject(undefined, [
            "format: \"{era}{year}年 {year}年 {month}月{day}日\"",
            "",
        ]);
        const duplicatedHourProject = await createProject(undefined, [
            "format: \"{era}{year}年 {month}月{day}日 {hour}:{hour:02}\"",
            "",
        ]);
        const unsafeNumberProject = await createProject(undefined, [
            "hoursPerDay: 9007199254740992",
            "",
        ]);
        const zeroStringProject = await createProject(undefined, [
            "secondsPerMinute: \"0\"",
            "",
        ]);
        const facade = createFacade();

        await expect(facade.formatTime(invalidRootProject, 0n)).rejects.toThrow("calendar 配置必须是 object");
        await expect(facade.formatTime(invalidUnitProject, 0n)).rejects.toThrow("hoursPerDay 必须是正整数");
        await expect(facade.formatTime(invalidEraProject, 0n)).rejects.toThrow("era 必须是字符串");
        await expect(facade.formatTime(invalidFormatProject, 0n)).rejects.toThrow("format 缺少必要 token：{month}");
        await expect(facade.formatTime(duplicatedYearProject, 0n)).rejects.toThrow("format 时间字段不能重复：year / year");
        await expect(facade.formatTime(duplicatedHourProject, 0n)).rejects.toThrow("format 时间字段不能重复：hour / hour:02");
        await expect(facade.formatTime(unsafeNumberProject, 0n)).rejects.toThrow("hoursPerDay 必须是安全正整数");
        await expect(facade.formatTime(zeroStringProject, 0n)).rejects.toThrow("secondsPerMinute 必须是正整数");
    });

    it("getWorldSchema 投影包含 enum、default、itemType 与 object fields，供 Agent 和 Preview 生成合法 mutation", async () => {
        const projectPath = await createProject([
            "subjectTypes:",
            "  quest:",
            "    attrs:",
            "      status: { kind: scalar, type: enum, enum: [active, done], default: active, desc: 任务状态 }",
            "      log: { kind: list, itemType: text, default: [] }",
            "      memory: { kind: object, itemType: text }",
            "      equipment:",
            "        kind: object",
            "        fields:",
            "          weapon: { kind: scalar, type: ref(item) }",
            "          durability: { kind: scalar, type: int, default: 100 }",
            "  item:",
            "    attrs:",
            "      name: { kind: scalar, type: text }",
            "",
        ]);
        const facade = createFacade();

        const schema = await facade.getWorldSchema(projectPath);

        expect(schema.subjectTypes[0]).toEqual({
            type: "quest",
            desc: undefined,
            attrs: [
                {name: "status", kind: "scalar", type: "enum", enum: ["active", "done"], default: "active", desc: "任务状态"},
                {name: "log", kind: "list", type: "text", itemType: "text", enum: undefined, default: [], desc: undefined},
                {name: "memory", kind: "object", type: "text", itemType: "text", enum: undefined, default: undefined, desc: undefined},
                {
                    name: "equipment",
                    kind: "object",
                    type: undefined,
                    enum: undefined,
                    default: undefined,
                    desc: undefined,
                    fields: {
                        weapon: {name: "weapon", kind: "scalar", type: "ref(item)", enum: undefined, default: undefined, desc: undefined},
                        durability: {name: "durability", kind: "scalar", type: "int", enum: undefined, default: 100, desc: undefined},
                    },
                },
                {name: "equipment.weapon", kind: "scalar", type: "ref(item)", enum: undefined, default: undefined, desc: undefined},
                {name: "equipment.durability", kind: "scalar", type: "int", enum: undefined, default: 100, desc: undefined},
            ],
        });
    });

    it("Calendar 支持合法固定进位配置", async () => {
        const projectPath = await createProject(undefined, [
            "era: 星历",
            "format: \"{era}{year}年 {month}月{day}日 {hour:02}:{minute:02}:{second:02}\"",
            "secondsPerMinute: 10",
            "minutesPerHour: 10",
            "hoursPerDay: 10",
            "daysPerMonth: 10",
            "monthsPerYear: 10",
            "",
        ]);
        const facade = createFacade();

        expect(await facade.formatTime(projectPath, 1000n)).toBe("星历1年 1月2日 00:00:00");
        expect(await facade.parseTime(projectPath, "星历1年 1月2日 00:00:00")).toBe(1000n);
    });

    it("Calendar 单位允许用字符串表达超过 JS safe integer 的正整数", async () => {
        const projectPath = await createProject(undefined, [
            "era: 巨历",
            "format: \"{era}{year}年 {month}月{day}日 {hour}:{minute}:{second}\"",
            "secondsPerMinute: 1",
            "minutesPerHour: 1",
            "hoursPerDay: \"9007199254740992\"",
            "daysPerMonth: 1",
            "monthsPerYear: 1",
            "",
        ]);
        const facade = createFacade();

        expect(await facade.parseTime(projectPath, "巨历1年 1月1日 9007199254740991:00:00")).toBe(9007199254740991n);
    });
});

function createFacade(): WorldEngineFacade {
    const facade = new WorldEngineFacade();
    createdFacades.push(facade);
    return facade;
}

async function createProject(schemaLines?: string[], calendarLines?: string[]): Promise<string> {
    const slug = `world-engine-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const projectRoot = path.join(resolveWorkspaceContainerRoot(), slug);
    await fs.mkdir(path.join(projectRoot, "world-engine"), {recursive: true});
    await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: World Engine Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(projectRoot, "world-engine/schema.yaml"), (schemaLines ?? [
        "subjectTypes:",
        "  world:",
        "    attrs:",
        "      era: { kind: scalar, type: text, default: 复兴纪元 }",
        "  character:",
        "    attrs:",
        "      hp: { kind: scalar, type: int, default: 100 }",
        "      mind: { kind: scalar, type: text }",
        "      profile: { kind: object }",
        "      events: { kind: list, itemType: text, default: [] }",
        "      location: { kind: scalar, type: ref(location) }",
        "  location:",
        "    attrs:",
        "      name: { kind: scalar, type: text }",
        "",
    ]).join("\n"), "utf-8");
    if (calendarLines) {
        await fs.writeFile(path.join(projectRoot, "world-engine/calendar.yaml"), calendarLines.join("\n"), "utf-8");
    }
    createdProjects.push(projectPath);
    return projectPath;
}

async function deleteWorldSubject(projectPath: string, subjectId: string): Promise<void> {
    const client = new PrismaClient({
        adapter: new PrismaLibSql({url: toSqliteFileUrl(resolveProjectDatabasePath(projectPath))}),
    });
    try {
        await client.worldSubject.delete({where: {id: subjectId}});
    } finally {
        await client.$disconnect();
    }
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
    try {
        await fs.rm(projectRoot, {recursive: true, force: true});
    } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
            throw error;
        }
    }
}
