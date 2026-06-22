import type {H3Event} from "h3";
import {z} from "zod";
import {worldEngineFacade} from "nbook/server/world-engine";
import type {JsonValue, MutationInput, SliceInput, SliceListItem, WorldSliceSubjectFilterMode, WorldState} from "nbook/server/world-engine";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

const MutationSchema = z.object({
    subjectId: z.string().min(1, "subjectId 不能为空"),
    attr: z.string().min(1, "attr 不能为空"),
    op: z.enum(["set", "add", "unset", "listAppend", "collectionAdd", "collectionRemove"]),
    value: JsonValueSchema.optional(),
}).strict();

const SliceBodySchema = z.object({
    time: z.string().min(1, "time 不能为空"),
    title: z.string().optional(),
    summary: z.string().optional(),
    kind: z.string().optional(),
    mutations: z.array(MutationSchema).min(1, "mutations 不能为空").max(100, "mutations 不能超过 100 条"),
}).strict();

const QueryStateBodySchema = z.object({
    subjectIds: z.array(z.string().min(1, "subjectId 不能为空")).min(1).optional(),
    type: z.string().min(1, "type 不能为空").optional(),
    attrs: z.array(z.string().min(1, "attr 不能为空")).min(1).optional(),
    at: z.string().min(1, "at 不能为空").optional(),
    listLimit: z.number().int().min(1).max(100).optional(),
}).strict();

const CreateSubjectBodySchema = z.object({
    id: z.string().min(1, "id 不能为空"),
    type: z.string().min(1, "type 不能为空"),
    name: z.string().optional(),
    time: z.string().min(1, "time 不能为空"),
}).strict();

type SliceBody = z.infer<typeof SliceBodySchema>;
type QueryStateBody = z.infer<typeof QueryStateBodySchema>;
type CreateSubjectBody = z.infer<typeof CreateSubjectBodySchema>;

/**
 * World Engine Project API：所有时间入参和出参都使用项目日历字符串。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPathQuery(event);
    const segments = readSegments(event);
    const method = event.method.toUpperCase();

    if (method === "GET" && matchSegments(segments, ["schema"])) {
        return worldEngineFacade.getWorldSchema(projectPath);
    }
    if (method === "GET" && matchSegments(segments, ["subjects"])) {
        return worldEngineFacade.listWorldSubjects(projectPath, {type: readOptionalStringQuery(event, "type")});
    }
    if (method === "POST" && matchSegments(segments, ["subjects"])) {
        return createSubject(projectPath, await validateBody<CreateSubjectBody>(event, CreateSubjectBodySchema));
    }
    if (method === "GET" && matchSegments(segments, ["slices"])) {
        return listSlices(projectPath, event);
    }
    if (method === "GET" && segments.length === 2 && segments[0] === "slices") {
        return serializeSlice(projectPath, await worldEngineFacade.getSlice(projectPath, requireSegment("sliceId", segments[1])));
    }
    if (method === "POST" && matchSegments(segments, ["slices"])) {
        return writeSlice(projectPath, await validateBody<SliceBody>(event, SliceBodySchema));
    }
    if (method === "POST" && segments.length === 3 && segments[0] === "slices" && segments[2] === "edit") {
        return editSlice(projectPath, requireSegment("sliceId", segments[1]), await validateBody<SliceBody>(event, SliceBodySchema));
    }
    if (method === "POST" && segments.length === 3 && segments[0] === "slices" && segments[2] === "delete") {
        return worldEngineFacade.deleteSlice(projectPath, requireSegment("sliceId", segments[1]));
    }
    if (method === "DELETE" && segments.length === 2 && segments[0] === "slices") {
        return worldEngineFacade.deleteSlice(projectPath, requireSegment("sliceId", segments[1]));
    }
    if (method === "GET" && matchSegments(segments, ["state"])) {
        return getWorldState(projectPath, event);
    }
    if (method === "POST" && matchSegments(segments, ["state", "query"])) {
        return queryState(projectPath, await validateBody<QueryStateBody>(event, QueryStateBodySchema));
    }

    throw createError({statusCode: 404, message: "未知 World Engine API"});
});

async function createSubject(projectPath: string, body: CreateSubjectBody): Promise<unknown> {
    return worldEngineFacade.createSubject(projectPath, {
        id: body.id,
        type: body.type,
        name: body.name,
        at: await parsePublicTime(projectPath, body.time, "time"),
    });
}

async function listSlices(projectPath: string, event: H3Event): Promise<unknown> {
    const slices = await worldEngineFacade.listSlices(projectPath, {
        limit: readPositiveIntQuery(event, "limit"),
        from: await readOptionalTimeQuery(projectPath, event, "from"),
        to: await readOptionalTimeQuery(projectPath, event, "to"),
        withMutations: readBooleanQuery(event, "withMutations"),
        subjectIds: readStringListQuery(event, "subjectIds"),
        subjectMode: readSubjectModeQuery(event),
    });
    return Promise.all(slices.map((slice) => serializeSlice(projectPath, slice)));
}

async function writeSlice(projectPath: string, body: SliceBody): Promise<unknown> {
    return worldEngineFacade.writeSlice(projectPath, await toSliceInput(projectPath, body));
}

async function editSlice(projectPath: string, sliceId: string, body: SliceBody): Promise<unknown> {
    return worldEngineFacade.editSlice(projectPath, sliceId, await toSliceInput(projectPath, body));
}

async function getWorldState(projectPath: string, event: H3Event): Promise<unknown> {
    return serializeWorldState(projectPath, await worldEngineFacade.getWorldState(projectPath, await readOptionalTimeQuery(projectPath, event, "at")));
}

async function queryState(projectPath: string, body: QueryStateBody): Promise<unknown> {
    if (!body.subjectIds?.length && !body.type) {
        throw createError({statusCode: 400, message: "state/query 必须提供 subjectIds 或 type"});
    }
    return worldEngineFacade.queryState(projectPath, {
        subjectIds: body.subjectIds,
        type: body.type,
        attrs: body.attrs,
        at: body.at ? await parsePublicTime(projectPath, body.at, "at") : undefined,
        listLimit: body.listLimit,
    });
}

async function toSliceInput(projectPath: string, body: SliceBody): Promise<SliceInput> {
    return {
        instant: await parsePublicTime(projectPath, body.time, "time"),
        title: body.title,
        summary: body.summary,
        kind: body.kind,
        mutations: body.mutations.map((mutation): MutationInput => ({
            subjectId: mutation.subjectId,
            attr: mutation.attr,
            op: mutation.op,
            ...(mutation.value === undefined ? {} : {value: mutation.value}),
        })),
    };
}

async function serializeSlice(projectPath: string, slice: SliceListItem): Promise<unknown> {
    return {
        id: slice.id,
        time: await worldEngineFacade.formatTime(projectPath, slice.instant),
        ...(slice.previousInstant !== undefined ? {previousTime: await worldEngineFacade.formatTime(projectPath, slice.previousInstant)} : {}),
        title: slice.title,
        summary: slice.summary,
        kind: slice.kind,
        ...(slice.mutations ? {mutations: slice.mutations} : {}),
        ...(slice.issues && slice.issues.length ? {issues: slice.issues} : {}),
    };
}

async function serializeWorldState(projectPath: string, state: WorldState): Promise<unknown> {
    return {
        time: await worldEngineFacade.formatTime(projectPath, state.instant),
        subjects: state.subjects,
        issues: state.issues,
    };
}

async function readOptionalTimeQuery(projectPath: string, event: H3Event, key: string): Promise<bigint | undefined> {
    const value = readOptionalStringQuery(event, key);
    if (!value) {
        return undefined;
    }
    if (value !== value.trim()) {
        throw createError({statusCode: 400, message: `${key} 不能包含前后空白：${value}`});
    }
    return parsePublicTime(projectPath, value, key);
}

function readOptionalStringQuery(event: H3Event, key: string): string | undefined {
    const value = getQuery(event)[key];
    if (Array.isArray(value)) {
        throw createError({statusCode: 400, message: `${key} 只能传一个值`});
    }
    if (typeof value !== "string") {
        return undefined;
    }
    return value === "" ? undefined : value;
}

function readPositiveIntQuery(event: H3Event, key: string): number | undefined {
    const text = readOptionalStringQuery(event, key);
    if (!text) {
        return undefined;
    }
    if (!/^\d+$/.test(text)) {
        throw createError({statusCode: 400, message: `${key} 必须是正整数`});
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw createError({statusCode: 400, message: `${key} 必须是安全正整数`});
    }
    return value;
}

function readBooleanQuery(event: H3Event, key: string): boolean | undefined {
    const text = readOptionalStringQuery(event, key);
    if (!text) {
        return undefined;
    }
    if (text === "true") {
        return true;
    }
    if (text === "false") {
        return false;
    }
    throw createError({statusCode: 400, message: `${key} 必须是 true 或 false`});
}

function readStringListQuery(event: H3Event, key: string): string[] | undefined {
    const text = readOptionalStringQuery(event, key);
    if (!text) {
        return undefined;
    }
    return text.split(",");
}

function readSubjectModeQuery(event: H3Event): WorldSliceSubjectFilterMode | undefined {
    const text = readOptionalStringQuery(event, "subjectMode");
    if (!text) {
        return undefined;
    }
    if (text === "any" || text === "all") {
        return text;
    }
    throw createError({statusCode: 400, message: "subjectMode 必须是 any 或 all"});
}

/** HTTP 公开边界只接受项目日历字符串；raw instant 仅保留给 facade/calendar 底层调试。 */
async function parsePublicTime(projectPath: string, input: string, label: string): Promise<bigint> {
    if (input !== input.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${input}`});
    }
    if (isRawInstantTime(input)) {
        throw createError({statusCode: 400, message: `${label} 必须使用项目日历字符串，不能使用 instant:<number>`});
    }
    return worldEngineFacade.parseTime(projectPath, input);
}

function isRawInstantTime(input: string): boolean {
    return input.trim().toLowerCase().startsWith("instant:");
}

function readSegments(event: H3Event): string[] {
    const rawSegments = event.context.params?.segments;
    const segments = Array.isArray(rawSegments) ? rawSegments : typeof rawSegments === "string" ? rawSegments.split("/") : [];
    return segments.map(decodeSegment).filter(Boolean);
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        throw createError({statusCode: 400, message: `API path 编码不合法：${segment}`});
    }
}

function matchSegments(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function requireSegment(label: string, value: string | undefined): string {
    const text = value ?? "";
    if (text.trim() === "") {
        throw createError({statusCode: 400, message: `${label} 不能为空`});
    }
    if (text !== text.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${text}`});
    }
    return text;
}
