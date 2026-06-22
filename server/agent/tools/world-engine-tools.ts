import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";
import type {JsonValue as AgentJsonValue} from "nbook/server/agent/messages/types";
import {WORLD_FOCUS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import type {JsonValue, MutationInput, WorldMutationOp} from "nbook/server/world-engine";

const DEFAULT_WORLD_SLICE_LIMIT = 5;

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});
const ProjectScopedSchema = Type.Object({
    projectPath: NonEmptyString("Required Project Path, e.g. workspace/silver-dragon-hime. The agent must pass it explicitly."),
});
const TimeString = NonEmptyString("Project calendar time string. Do not pass raw numeric instant.");
const MutationOpSchema = Type.Union([
    Type.Literal("set"),
    Type.Literal("add"),
    Type.Literal("unset"),
    Type.Literal("listAppend"),
    Type.Literal("collectionAdd"),
    Type.Literal("collectionRemove"),
]);
const MutationSchema = Type.Object({
    subjectId: NonEmptyString("Subject id, e.g. erina."),
    attr: NonEmptyString("Attribute path, e.g. hp or equipment.weapon."),
    op: MutationOpSchema,
    // Tool 边界接受任意 JSON，核心 service 会按 schema/op 做真实校验。
    value: Type.Optional(Type.Unknown()),
}, {additionalProperties: false});
const SliceKindSchema = Type.Union([
    Type.Literal("event"),
    Type.Literal("init"),
    Type.String(),
]);
type WorldTimeParser = {
    parseTime(projectPath: string, input: string): Promise<bigint>;
};

const GetWorldStateSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    subjectIds: Type.Optional(Type.Array(NonEmptyString("Subject id."), {minItems: 1})),
    type: Type.Optional(NonEmptyString("Subject type, e.g. character.")),
    attrs: Type.Optional(Type.Array(NonEmptyString("Attribute path."), {minItems: 1})),
    at: Type.Optional(TimeString),
    listLimit: Type.Optional(Type.Integer({minimum: 1, maximum: 100})),
}, {additionalProperties: false});
const ListWorldSlicesSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: 50})),
    from: Type.Optional(TimeString),
    to: Type.Optional(TimeString),
    withMutations: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});
const WriteWorldSliceSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    time: TimeString,
    title: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    kind: Type.Optional(SliceKindSchema),
    mutations: Type.Array(MutationSchema, {minItems: 1, maxItems: 100}),
}, {additionalProperties: false});
const EditWorldSliceSchema = Type.Object({
    ...WriteWorldSliceSchema.properties,
    sliceId: NonEmptyString("WorldSlice id to edit."),
}, {additionalProperties: false});
const DeleteWorldSliceSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    sliceId: NonEmptyString("WorldSlice id to delete."),
}, {additionalProperties: false});
const CreateWorldSubjectSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    id: NonEmptyString("Stable subject id. References use subject://<id>."),
    type: NonEmptyString("Schema subject type."),
    name: Type.Optional(Type.String()),
    time: TimeString,
}, {additionalProperties: false});
const GetWorldSchemaSchema = ProjectScopedSchema;
const ListWorldSubjectsSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    type: Type.Optional(NonEmptyString("Optional subject type filter.")),
}, {additionalProperties: false});

/** 构造 World Engine Agent 工具。 */
export function createWorldEngineTools(): NeuroAgentTool[] {
    return [
        tool("get_world_state", "Query reduced world state by subject/type/attrs at a project calendar time.", GetWorldStateSchema, async (context, input) => {
            if (!input.subjectIds?.length && !input.type) {
                throw new Error("get_world_state 必须提供 subjectIds 或 type，避免向 Agent 倾倒全量世界状态。");
            }
            const facade = await loadWorldEngineFacade();
            const at = input.at ? await parseAgentTime(facade, input.projectPath, input.at, "at") : undefined;
            const states = await facade.queryState(input.projectPath, {
                subjectIds: input.subjectIds,
                type: input.type,
                attrs: input.attrs,
                at,
                listLimit: input.listLimit,
            });
            if (input.subjectIds?.length) {
                await writeWorldFocus(context, {projectPath: input.projectPath, subjectIds: input.subjectIds});
            }
            return worldResult(states);
        }),
        tool("list_world_slices", "List recent or ranged world timeline slices. Times are project calendar strings.", ListWorldSlicesSchema, async (_context, input) => {
            const facade = await loadWorldEngineFacade();
            const slices = await facade.listSlices(input.projectPath, {
                limit: resolveSliceLimit(input),
                from: input.from ? await parseAgentTime(facade, input.projectPath, input.from, "from") : undefined,
                to: input.to ? await parseAgentTime(facade, input.projectPath, input.to, "to") : undefined,
                withMutations: input.withMutations,
            });
            return worldResult(await Promise.all(slices.map(async (slice) => ({
                ...slice,
                instant: undefined,
                time: await facade.formatTime(input.projectPath, slice.instant),
            }))));
        }),
        tool("write_world_slice", "Write one new world slice. If the time already has a slice, use edit_world_slice.", WriteWorldSliceSchema, async (_context, input) => {
            const facade = await loadWorldEngineFacade();
            const result = await facade.writeSlice(input.projectPath, {
                instant: await parseAgentTime(facade, input.projectPath, input.time, "time"),
                title: input.title,
                summary: input.summary,
                kind: input.kind,
                mutations: normalizeMutations(input.mutations),
            });
            return worldResult(result);
        }),
        tool("edit_world_slice", "Replace an existing world slice as a whole.", EditWorldSliceSchema, async (_context, input) => {
            const facade = await loadWorldEngineFacade();
            const result = await facade.editSlice(input.projectPath, input.sliceId, {
                instant: await parseAgentTime(facade, input.projectPath, input.time, "time"),
                title: input.title,
                summary: input.summary,
                kind: input.kind,
                mutations: normalizeMutations(input.mutations),
            });
            return worldResult(result);
        }),
        tool("delete_world_slice", "Permanently delete a world slice for cleanup. Returns data issues surfaced after deletion.", DeleteWorldSliceSchema, async (_context, input) => {
            const facade = await loadWorldEngineFacade();
            return worldResult(await facade.deleteSlice(input.projectPath, input.sliceId));
        }),
        tool("create_world_subject", "Create a world subject. Schema defaults are written into a kind=init slice; if that time already has a non-init slice, edit the slice explicitly or choose another time. Without defaults, only the subject identity is registered.", CreateWorldSubjectSchema, async (context, input) => {
            const facade = await loadWorldEngineFacade();
            const result = await facade.createSubject(input.projectPath, {
                id: input.id,
                type: input.type,
                name: input.name,
                at: await parseAgentTime(facade, input.projectPath, input.time, "time"),
            });
            await writeWorldFocus(context, {projectPath: input.projectPath, subjectIds: [input.id]});
            return worldResult(result);
        }),
        tool("get_world_schema", "Return Agent-friendly world schema and calendar format projection.", GetWorldSchemaSchema, async (_context, input) => {
            const facade = await loadWorldEngineFacade();
            return worldResult(await facade.getWorldSchema(input.projectPath));
        }),
        tool("list_world_subjects", "List registered world subjects without reducing their state.", ListWorldSubjectsSchema, async (_context, input) => {
            const facade = await loadWorldEngineFacade();
            return worldResult(await facade.listWorldSubjects(input.projectPath, {type: input.type}));
        }),
    ];
}

function tool<TSchemaValue extends TSchema>(
    key: string,
    description: string,
    parameters: TSchemaValue,
    execute: (context: ToolExecutionContext, input: Static<TSchemaValue>) => Promise<AgentToolResult<unknown>>,
): NeuroAgentTool {
    return {
        key,
        name: key,
        label: key,
        executionMode: "sequential",
        description,
        parameters,
        async execute() {
            throw new Error(`${key} 需要 v3 session context。`);
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            return execute(context, params as Static<TSchemaValue>);
        },
    };
}

function normalizeMutations(input: Static<typeof MutationSchema>[]): MutationInput[] {
    return input.map((mutation) => ({
        subjectId: mutation.subjectId,
        attr: mutation.attr,
        op: mutation.op as WorldMutationOp,
        ...(mutation.value === undefined ? {} : {value: normalizeJsonValue(mutation.value, mutation.attr)}),
    }));
}

function resolveSliceLimit(input: Static<typeof ListWorldSlicesSchema>): number | undefined {
    if (input.limit !== undefined) {
        return input.limit;
    }
    return input.from || input.to ? undefined : DEFAULT_WORLD_SLICE_LIMIT;
}

/** Agent 公开边界只接受项目日历字符串；raw instant 仅保留给 facade/calendar 底层调试。 */
async function parseAgentTime(facade: WorldTimeParser, projectPath: string, input: string, field: string): Promise<bigint> {
    if (input !== input.trim()) {
        throw new Error(`${field} 不能包含前后空白：${input}`);
    }
    if (isRawInstantTime(input)) {
        throw new Error(`${field} 必须使用项目日历字符串，不能使用 instant:<number>`);
    }
    return facade.parseTime(projectPath, input);
}

function isRawInstantTime(input: string): boolean {
    return input.trim().toLowerCase().startsWith("instant:");
}

function normalizeJsonValue(value: unknown, attr: string): JsonValue {
    if (!isJsonValue(value)) {
        throw new Error(`${attr} value 必须是 JSON 值`);
    }
    return value;
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (isObjectLike(value)) {
        return Object.values(value).every(isJsonValue);
    }
    return false;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

async function writeWorldFocus(context: ToolExecutionContext, patch: {projectPath: string; subjectIds: string[]}): Promise<void> {
    await context.harness.appendCustomState(context.sessionId, WORLD_FOCUS_STATE_KEY, {
        ...patch,
        updatedAt: new Date().toISOString(),
    } as AgentJsonValue, context.workspaceKey);
}

function worldResult(details: unknown): AgentToolResult<unknown> {
    const normalized = normalizeToolDetails(details);
    return {
        content: [{type: "text" as const, text: JSON.stringify(normalized, null, 2)}],
        details: normalized,
    };
}

function normalizeToolDetails(value: unknown): AgentJsonValue {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value === undefined) {
        return null;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalizeToolDetails);
    }
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, normalizeToolDetails(item)]));
    }
    return String(value);
}

async function loadWorldEngineFacade(): Promise<typeof import("nbook/server/world-engine").worldEngineFacade> {
    return (await import("nbook/server/world-engine")).worldEngineFacade;
}
