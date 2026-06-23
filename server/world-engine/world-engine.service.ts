import {createError} from "h3";
import {collectDefaultAttrs, findAttrSchema, flattenAttrs, normalizeAttrKind} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import type {WorldCalendar} from "nbook/server/world-engine/calendar";
import type {
    CreateWorldSubjectInput,
    JsonValue,
    CreateWorldSubjectResult,
    DeleteSliceResult,
    MutationInput,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    WorldAttrSchema,
    WorldIssue,
    WorldIssueCode,
    WorldMutationOp,
    WorldMutationRow,
    WorldSchema,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldState,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";

const OPS: WorldMutationOp[] = ["set", "add", "unset", "listAppend", "collectionAdd", "collectionRemove"];
const RELATIVE_OPS = new Set<string>(["add", "listAppend", "collectionAdd", "collectionRemove"]);
const MAX_SLICE_MUTATIONS = 100;
const SQLITE_INT64_MIN = BigInt("-9223372036854775808");
const SQLITE_INT64_MAX = BigInt("9223372036854775807");
const MISSING = Symbol("missing");

/** apply 阶段检测到的属性级问题（subjectId / sliceId 由调用方补上）。 */
type AttrIssue = {code: WorldIssueCode; attr: string; message: string};

/** 世界引擎核心服务。 */
export class WorldEngineService {
    constructor(
        private readonly repository: WorldEngineRepository,
        private readonly schema: WorldSchema,
        private readonly calendar: WorldCalendar,
    ) {}

    /** 创建 subject；只有 schema default 或初始化 attrs 非空时才写入 init slice。 */
    async createSubject(input: CreateWorldSubjectInput): Promise<CreateWorldSubjectResult> {
        assertSubjectId(input.id, "id");
        this.assertSubjectType(input.type);
        assertSqliteInstant(input.at, "at");
        const existing = await this.repository.findSubject(input.id);
        if (existing) {
            throw createError({statusCode: 409, message: `subject 已存在：${input.id}（当前 type=${existing.type}${existing.name ? `, name=${existing.name}` : ""}）`});
        }

        const initMutationByAttr = new Map<string, MutationInput>();
        for (const item of collectDefaultAttrs(this.schema, input.type)) {
            initMutationByAttr.set(item.attr, {
                subjectId: input.id,
                attr: item.attr,
                op: "set",
                value: item.value,
            });
        }
        for (const [attr, value] of Object.entries(input.attrs ?? {})) {
            initMutationByAttr.set(attr, {
                subjectId: input.id,
                attr,
                op: "set",
                value,
            });
        }
        const initMutations = [...initMutationByAttr.values()];
        await this.validateInitialMutations(input.type, initMutations);
        const slice = initMutations.length > 0 ? await this.repository.findSliceByInstant(input.at) : null;
        if (slice && slice.kind !== "init") {
            throw createError({statusCode: 409, message: this.renderInstantConflict(slice, "目标时间已有非 init 切面，不能把 subject 初始化追加进去；请使用 editSlice 显式合并，或选择其他初始化时间。")});
        }
        await this.repository.createSubject({id: input.id, type: input.type, name: input.name ?? ""});

        if (initMutations.length === 0) {
            return {subjectId: input.id, issues: []};
        }

        if (slice) {
            const startSeq = await this.repository.maxSeq(slice.id) + 1;
            assertMutationCapacity(startSeq + initMutations.length);
            await this.repository.appendMutations(slice.id, input.at, withSeq(initMutations, startSeq));
        } else {
            assertMutationCapacity(initMutations.length);
            await this.repository.createSlice({
                instant: input.at,
                title: input.name ? `创建 ${input.name}` : `创建 ${input.id}`,
                summary: "",
                kind: "init",
                mutations: initMutations,
            }, withSeq(initMutations, 0));
        }
        // 新建 subject 只写自身初始化 set，不会与既有链条产生 E/A，issues 恒为空。
        return {subjectId: input.id, issues: []};
    }

    /** 写入一个新的切面；同 instant 已存在时直接报错。 */
    async writeSlice(input: SliceInput): Promise<SliceWriteResult> {
        assertSqliteInstant(input.instant, "instant");
        assertSliceKind(input.kind);
        const existing = await this.repository.findSliceByInstant(input.instant);
        if (existing) {
            throw createError({statusCode: 409, message: this.renderInstantConflict(existing, "该时间已有切面，请使用 edit_world_slice 合并到已有切面，或选择相邻时间。")});
        }
        await this.validateMutations(input.mutations);
        const slice = await this.repository.createSlice(input, withSeq(input.mutations, 0));
        return {sliceId: slice.id, issues: await this.collectWriteIssues(input.instant, input.mutations, affectedSubjectIds(input.mutations))};
    }

    /** 整块替换已有切面。 */
    async editSlice(sliceId: string, input: SliceInput): Promise<SliceWriteResult> {
        assertSliceId(sliceId);
        assertSqliteInstant(input.instant, "instant");
        assertSliceKind(input.kind);
        const existing = await this.repository.findSliceWithMutations(sliceId);
        if (!existing) {
            throw createError({statusCode: 404, message: "切面不存在"});
        }
        const sliceAtNewInstant = await this.repository.findSliceByInstant(input.instant);
        if (sliceAtNewInstant && sliceAtNewInstant.id !== sliceId) {
            throw createError({statusCode: 409, message: this.renderInstantConflict(sliceAtNewInstant, "目标时间已有其他切面，不能把两个切面改到同一 instant。")});
        }

        await this.validateMutations(input.mutations);
        const previousMutations = existing.mutations.map(decodeRowMutation);
        const sameSemanticSlice = existing.instant === input.instant && sameMutationSequence(existing.mutations, input.mutations);
        await this.repository.replaceSlice(sliceId, input, withSeq(input.mutations, 0));
        const affected = unique([...existing.mutations.map((mutation) => mutation.subjectId), ...affectedSubjectIds(input.mutations)]);
        return {sliceId, issues: await this.collectEditIssues({
            previousInstant: existing.instant,
            nextInstant: input.instant,
            previousMutations,
            mutations: input.mutations,
            affectedSubjectIds: affected,
            excludeSliceId: sliceId,
            skipAdvisories: sameSemanticSlice,
        })};
    }

    /** 物理删除一个切面；删后对受影响 subject 重算持久问题（E）返回。 */
    async deleteSlice(sliceId: string): Promise<DeleteSliceResult> {
        assertSliceId(sliceId);
        const existing = await this.repository.findSliceWithMutations(sliceId);
        if (!existing) {
            throw createError({statusCode: 404, message: "切面不存在"});
        }
        const affected = unique(existing.mutations.map((mutation) => mutation.subjectId));
        await this.repository.deleteSlice(sliceId);
        return {issues: await this.collectSubjectIssues(affected)};
    }

    /** 读取单个 timeline 切面，附 mutation 与读时现算 issue。 */
    async getSlice(sliceId: string): Promise<SliceListItem> {
        assertSliceId(sliceId);
        const row = await this.repository.findSliceWithMutations(sliceId);
        if (!row) {
            throw createError({statusCode: 404, message: "切面不存在"});
        }
        const previousSlice = await this.repository.findPreviousSlice(row.instant);
        const issues = (await this.collectIssuesBySlice()).get(row.id);
        return {
            id: row.id,
            instant: row.instant,
            previousInstant: previousSlice?.instant,
            title: row.title,
            summary: row.summary,
            kind: row.kind,
            mutations: row.mutations.map((mutation) => ({
                subjectId: mutation.subjectId,
                attr: mutation.attr,
                op: mutation.op as WorldMutationOp,
                value: mutation.value === null ? undefined : decodeJson(mutation.value),
            })),
            ...(issues && issues.length ? {issues} : {}),
        };
    }

    /** 返回某时刻的全量世界状态。 */
    async getWorldState(at?: bigint): Promise<WorldState> {
        assertSqliteInstant(at, "at");
        const instant = at ?? await this.repository.latestInstant() ?? BigInt(0);
        const subjects = await this.repository.listSubjects();
        const reduced = await Promise.all(subjects.map(async (subject) => {
            const {attrs, issues} = await this.reduceWithIssues(subject.id, instant);
            return {state: {subjectId: subject.id, type: subject.type, attrs}, issues};
        }));
        return {instant, subjects: reduced.map((item) => item.state), issues: reduced.flatMap((item) => item.issues)};
    }

    /** Agent / 业务使用的收窄查询。 */
    async queryState(query: {subjectIds?: string[]; type?: string; attrs?: string[]; at?: bigint; listLimit?: number}): Promise<QueryStateResult> {
        assertSqliteInstant(query.at, "at");
        assertNonEmptyArray(query.subjectIds, "subjectIds");
        assertNonEmptyArray(query.attrs, "attrs");
        for (const attr of query.attrs ?? []) {
            assertAttrPath(attr);
        }
        for (const subjectId of query.subjectIds ?? []) {
            assertSubjectId(subjectId, "subjectId");
        }
        assertUniqueStrings(query.subjectIds, "subjectIds");
        assertUniqueStrings(query.attrs, "attrs");
        if (query.type !== undefined) {
            this.assertSubjectType(query.type);
        }
        assertQueryScope(query);
        assertListLimit(query.listLimit);
        const instant = query.at ?? await this.repository.latestInstant() ?? BigInt(0);
        const subjects = await this.repository.listSubjects({ids: query.subjectIds, type: query.type});
        assertRequestedSubjectsFound(query.subjectIds, subjects);
        const orderedSubjects = orderSubjects(subjects, query.subjectIds);
        const reduced = await Promise.all(orderedSubjects.map(async (subject) => {
            const {attrs, issues} = await this.reduceWithIssues(subject.id, instant);
            const projected = query.attrs?.length ? projectAttrs(attrs, query.attrs) : attrs;
            const limited = query.listLimit === undefined ? projected : limitAttrRecord(projected, query.listLimit, this.schema, subject.type);
            const visibleIssues = query.attrs?.length ? filterIssuesForAttrs(issues, query.attrs) : issues;
            return {state: {subjectId: subject.id, type: subject.type, attrs: limited}, issues: visibleIssues};
        }));
        return {subjects: reduced.map((item) => item.state), issues: reduced.flatMap((item) => item.issues)};
    }

    /** 列出 timeline 切面，附读时现算、归属到该切面的持久问题（E）。 */
    async listSlices(query: {from?: bigint; to?: bigint; limit?: number; withMutations?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode} = {}): Promise<SliceListItem[]> {
        assertSqliteInstant(query.from, "from");
        assertSqliteInstant(query.to, "to");
        assertPositiveInteger(query.limit, "limit");
        assertInstantRange(query.from, query.to);
        assertNonEmptyArray(query.subjectIds, "subjectIds");
        for (const subjectId of query.subjectIds ?? []) {
            assertSubjectId(subjectId, "subjectId");
        }
        assertUniqueStrings(query.subjectIds, "subjectIds");
        assertSliceSubjectMode(query.subjectMode, query.subjectIds);
        if (query.subjectIds?.length) {
            assertRequestedSubjectsFound(query.subjectIds, await this.repository.listSubjects({ids: query.subjectIds}));
        }
        const rows = await this.repository.listSlices(query);
        const issuesBySlice = await this.collectIssuesBySlice();
        return rows.map((row) => {
            const issues = issuesBySlice.get(row.id);
            return {
                id: row.id,
                instant: row.instant,
                title: row.title,
                summary: row.summary,
                kind: row.kind,
                mutations: row.mutations?.map((mutation) => ({
                    subjectId: mutation.subjectId,
                    attr: mutation.attr,
                    op: mutation.op as WorldMutationOp,
                    value: mutation.value === null ? undefined : decodeJson(mutation.value),
                })),
                ...(issues && issues.length ? {issues} : {}),
            };
        });
    }

    /** 列出 subject 身份，不返回状态。 */
    async listWorldSubjects(query: {type?: string} = {}): Promise<WorldSubjectListItem[]> {
        if (query.type !== undefined) {
            this.assertSubjectType(query.type);
        }
        const subjects = await this.repository.listSubjects({type: query.type});
        return subjects.map((subject) => ({id: subject.id, type: subject.type, name: subject.name}));
    }

    /** 返回 Agent 友好的 schema 与 calendar 投影。 */
    getWorldSchema(): WorldSchemaProjection {
        return {
            subjectTypes: Object.entries(this.schema.subjectTypes).map(([type, subjectType]) => ({
                type,
                desc: subjectType.desc,
                attrs: flattenAttrs(subjectType.attrs),
            })),
            calendar: this.calendar.projection(),
        };
    }

    /** 写 / 编辑后的问题汇总：A（本次编辑一次性提醒）+ E（受影响 subject 的持久问题）。 */
    private async collectWriteIssues(instant: bigint, mutations: MutationInput[], affectedSubjectIds: string[]): Promise<WorldIssue[]> {
        const advisories = await this.collectAdvisories(instant, mutations);
        const errors = await this.collectSubjectIssues(affectedSubjectIds);
        return [...advisories, ...errors];
    }

    /** editSlice 会移动或替换既有切面；A issue 需要同时观察旧位置和新位置，且排除当前切面自身。 */
    private async collectEditIssues(input: {
        previousInstant: bigint;
        nextInstant: bigint;
        previousMutations: MutationInput[];
        mutations: MutationInput[];
        affectedSubjectIds: string[];
        excludeSliceId: string;
        skipAdvisories: boolean;
    }): Promise<WorldIssue[]> {
        const reordered = input.previousInstant === input.nextInstant ? reorderedOverlapCandidates(input.previousMutations, input.mutations) : {previous: [], next: []};
        const previousCandidates = input.previousInstant === input.nextInstant ? uniqueMutations([...diffMutations(input.previousMutations, input.mutations), ...reordered.previous]) : input.previousMutations;
        const nextCandidates = input.previousInstant === input.nextInstant ? uniqueMutations([...diffMutations(input.mutations, input.previousMutations), ...reordered.next]) : input.mutations;
        const advisories = input.skipAdvisories ? [] : dedupeIssues((await Promise.all([
            this.collectAdvisories(input.previousInstant, previousCandidates, input.excludeSliceId),
            this.collectAdvisories(input.nextInstant, nextCandidates, input.excludeSliceId),
        ])).flat());
        const errors = await this.collectSubjectIssues(input.affectedSubjectIds);
        return [...advisories, ...errors];
    }

    /** A 通道：本次写入的绝对 op（set/unset）是否改了下游相对 op 的基（base-shifted），或被下游绝对 op 覆盖（masked）。每个 (subject,attr) 只提醒一次。 */
    private async collectAdvisories(instant: bigint, mutations: MutationInput[], excludeSliceId?: string): Promise<WorldIssue[]> {
        if (instant >= SQLITE_INT64_MAX) {
            return [];
        }
        const issues: WorldIssue[] = [];
        const seen = new Set<string>();
        for (const mutation of mutations) {
            if (mutation.op !== "set" && mutation.op !== "unset") {
                continue;
            }
            const key = `${mutation.subjectId}|${mutation.attr}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const downstream = await this.repository.findMutationsForSubject({subjectId: mutation.subjectId, from: instant + BigInt(1), excludeSliceId});
            const coveredPaths: string[] = [];
            for (const nearest of downstream) {
                if (!attrPathsOverlap(mutation.attr, nearest.attr) || isCoveredByPath(nearest.attr, coveredPaths)) {
                    continue;
                }
                if (RELATIVE_OPS.has(nearest.op)) {
                    issues.push({code: "base-shifted", sliceId: nearest.sliceId, subjectId: mutation.subjectId, attr: nearest.attr, message: `插入/编辑的 ${mutation.op} ${mutation.attr} 改变了后续 ${nearest.op} ${nearest.attr} 的累加基准，请确认语义是否符合预期`});
                    coveredPaths.push(nearest.attr);
                    continue;
                }
                issues.push({code: "masked", sliceId: nearest.sliceId, subjectId: mutation.subjectId, attr: nearest.attr, message: `本次对 ${mutation.attr} 的修改会被后续 ${nearest.op} ${nearest.attr} 覆盖，不会完整传播到最新状态`});
                if (attrPathContains(nearest.attr, mutation.attr)) {
                    break;
                }
                coveredPaths.push(nearest.attr);
            }
        }
        return issues;
    }

    /** E 通道：对一组 subject reduce 到最新，收集持久数据问题。 */
    private async collectSubjectIssues(subjectIds: string[]): Promise<WorldIssue[]> {
        const latest = await this.repository.latestInstant() ?? BigInt(0);
        const issues: WorldIssue[] = [];
        for (const subjectId of unique(subjectIds)) {
            const {issues: subIssues} = await this.reduceWithIssues(subjectId, latest);
            issues.push(...subIssues);
        }
        return issues;
    }

    /** 把所有 subject 的持久问题按显形切面 sliceId 归并，供 listSlices 读时投影。 */
    private async collectIssuesBySlice(): Promise<Map<string, WorldIssue[]>> {
        const latest = await this.repository.latestInstant() ?? BigInt(0);
        const subjects = await this.repository.listSubjects();
        const bySlice = new Map<string, WorldIssue[]>();
        for (const subject of subjects) {
            const {issues} = await this.reduceWithIssues(subject.id, latest);
            for (const issue of issues) {
                if (!issue.sliceId) {
                    continue;
                }
                const list = bySlice.get(issue.sliceId) ?? [];
                list.push(issue);
                bySlice.set(issue.sliceId, list);
            }
        }
        return bySlice;
    }

    /** reduce 单个 subject 截至 instant 的状态，并收集 reduce 时显形的持久问题（E）。 */
    private async reduceWithIssues(subjectId: string, instant: bigint): Promise<{attrs: Record<string, JsonValue>; issues: WorldIssue[]}> {
        const subject = await this.repository.findSubject(subjectId);
        const rows = await this.repository.findMutationsForSubject({subjectId, at: instant});
        const state: Record<string, JsonValue> = {};
        const issues: WorldIssue[] = [];
        const originByAttr = new Map<string, string>();
        for (const row of rows) {
            const mutation = decodeRowMutation(row);
            const previousValue = getPath(state, mutation.attr);
            const attrSchema = subject ? findAttrSchema(this.schema, subject.type, mutation.attr) : null;
            const issue = applyAndDetect(state, mutation, attrSchema);
            if (issue) {
                issues.push({...issue, sliceId: row.sliceId, subjectId});
                continue;
            }
            recordOriginAfterMutation(originByAttr, mutation, row.sliceId, previousValue, getPath(state, mutation.attr));
        }
        if (!subject) {
            return {attrs: state, issues};
        }
        const danglingRefIssues = await this.collectDanglingRefIssues(subject.id, subject.type, state, originByAttr);
        return {attrs: state, issues: [...issues, ...danglingRefIssues]};
    }

    /** 按 schema 扫描最终状态中的 ref 值，把旧数据/手工损坏造成的悬空引用转成持久 E issue。 */
    private async collectDanglingRefIssues(subjectId: string, subjectType: string, attrs: Record<string, JsonValue>, originByAttr: Map<string, string>): Promise<WorldIssue[]> {
        const subjectSchema = this.schema.subjectTypes[subjectType];
        if (!subjectSchema) {
            return [];
        }
        const issues: WorldIssue[] = [];
        for (const [attr, attrSchema] of Object.entries(subjectSchema.attrs)) {
            const value = getPath(attrs, attr);
            if (value === MISSING) {
                continue;
            }
            await this.collectDanglingRefIssuesFromValue({subjectId, attr, value, attrSchema, originByAttr, issues});
        }
        return issues;
    }

    private async collectDanglingRefIssuesFromValue(input: {
        subjectId: string;
        attr: string;
        value: JsonValue;
        attrSchema: WorldAttrSchema;
        originByAttr: Map<string, string>;
        issues: WorldIssue[];
    }): Promise<void> {
        const kind = normalizeAttrKind(input.attrSchema);
        if (kind === "object") {
            if (!isObject(input.value)) {
                return;
            }
            if (input.attrSchema.fields) {
                for (const [field, fieldSchema] of Object.entries(input.attrSchema.fields)) {
                    if (!(field in input.value)) {
                        continue;
                    }
                    await this.collectDanglingRefIssuesFromValue({
                        ...input,
                        attr: `${input.attr}.${field}`,
                        value: input.value[field] ?? null,
                        attrSchema: fieldSchema,
                    });
                }
                return;
            }
            const refType = parseRefType(input.attrSchema.itemType ?? "");
            if (!refType) {
                return;
            }
            for (const [key, item] of Object.entries(input.value)) {
                await this.collectDanglingRefIssue(input.subjectId, `${input.attr}.${key}`, item, refType, input.originByAttr, input.issues);
            }
            return;
        }
        if (kind === "list" || kind === "collection") {
            if (!Array.isArray(input.value)) {
                return;
            }
            const refType = parseRefType(input.attrSchema.itemType ?? input.attrSchema.type ?? "");
            if (!refType) {
                return;
            }
            for (const [index, item] of input.value.entries()) {
                await this.collectDanglingRefIssue(input.subjectId, `${input.attr}[${index}]`, item, refType, input.originByAttr, input.issues);
            }
            return;
        }
        const refType = parseRefType(input.attrSchema.type ?? input.attrSchema.itemType ?? "");
        if (refType) {
            await this.collectDanglingRefIssue(input.subjectId, input.attr, input.value, refType, input.originByAttr, input.issues);
        }
    }

    private async collectDanglingRefIssue(
        subjectId: string,
        attr: string,
        value: JsonValue,
        refType: string,
        originByAttr: Map<string, string>,
        issues: WorldIssue[],
    ): Promise<void> {
        const sliceId = findOriginSlice(originByAttr, attr);
        if (typeof value !== "string" || !value.startsWith("subject://")) {
            issues.push({code: "dangling-ref", sliceId, subjectId, attr, message: `${attr} 引用值不是 subject://<id>`});
            return;
        }
        const target = await this.repository.findSubject(value.slice("subject://".length));
        if (!target) {
            issues.push({code: "dangling-ref", sliceId, subjectId, attr, message: `引用目标不存在：${value}`});
            return;
        }
        if (target.type !== refType) {
            issues.push({code: "dangling-ref", sliceId, subjectId, attr, message: `引用目标类型不匹配：${value} 需要 ${refType}，实际 ${target.type}`});
        }
    }

    private renderInstantConflict(slice: {id: string; instant: bigint; title: string}, prefix: string): string {
        return `${prefix} existingSliceId=${slice.id}, time=${this.calendar.format(slice.instant)}, title=${slice.title || "(无标题)"}`;
    }

    private async validateMutations(mutations: MutationInput[]): Promise<void> {
        if (mutations.length === 0) {
            throw createError({statusCode: 400, message: "mutations 不能为空"});
        }
        assertMutationCapacity(mutations.length);
        for (const mutation of mutations) {
            assertSubjectId(mutation.subjectId, "subjectId");
            assertAttrPath(mutation.attr);
            if (!OPS.includes(mutation.op)) {
                throw createError({statusCode: 400, message: `不支持的 mutation op：${mutation.op}`});
            }
            const subject = await this.repository.findSubject(mutation.subjectId);
            if (!subject) {
                throw createError({statusCode: 404, message: `subject 不存在：${mutation.subjectId}`});
            }
            const attrSchema = findAttrSchema(this.schema, subject.type, mutation.attr);
            this.validateOp(mutation, attrSchema);
            await this.validateValue(mutation, attrSchema);
        }
    }

    private async validateInitialMutations(subjectType: string, mutations: MutationInput[]): Promise<void> {
        assertMutationCapacity(mutations.length);
        for (const mutation of mutations) {
            assertAttrPath(mutation.attr);
            const attrSchema = findAttrSchema(this.schema, subjectType, mutation.attr);
            if (!attrSchema) {
                throw createError({statusCode: 400, message: `初始化属性不存在：${mutation.attr}`});
            }
            this.validateOp(mutation, attrSchema);
            await this.validateValue(mutation, attrSchema);
        }
    }

    private validateOp(mutation: MutationInput, attrSchema: WorldAttrSchema | null): void {
        if (!attrSchema && mutation.op !== "set" && mutation.op !== "unset") {
            throw createError({statusCode: 400, message: `未声明属性只允许 set/unset：${mutation.attr}`});
        }
        const kind = normalizeAttrKind(attrSchema);
        const allowed: Record<ReturnType<typeof normalizeAttrKind>, WorldMutationOp[]> = {
            scalar: scalarOps(attrSchema),
            list: ["set", "listAppend"],
            collection: ["set", "collectionAdd", "collectionRemove"],
            object: ["set", "unset"],
        };
        const allowedOps = allowed[kind];
        if (!allowedOps.includes(mutation.op)) {
            throw createError({statusCode: 400, message: `${mutation.attr}(${kind}) 不支持 ${mutation.op}`});
        }
    }

    private async validateValue(mutation: MutationInput, attrSchema: WorldAttrSchema | null): Promise<void> {
        if (mutation.op === "unset") {
            if (mutation.value !== undefined) {
                throw createError({statusCode: 400, message: `${mutation.attr} 使用 unset 时不能提供 value`});
            }
            return;
        }
        if (mutation.value === undefined) {
            throw createError({statusCode: 400, message: `${mutation.attr} 使用 ${mutation.op} 时必须提供 value`});
        }
        if (mutation.op === "add" && (typeof mutation.value !== "number" || !Number.isFinite(mutation.value))) {
            throw createError({statusCode: 400, message: `${mutation.attr} 使用 add 时 value 必须是 finite number`});
        }
        const kind = normalizeAttrKind(attrSchema);
        if (attrSchema && (kind === "list" || kind === "collection") && mutation.op === "set") {
            if (!isJsonValue(mutation.value)) {
                throw createError({statusCode: 400, message: `${mutation.attr} value 必须是 JSON 值`});
            }
            if (!Array.isArray(mutation.value)) {
                throw createError({statusCode: 400, message: `${mutation.attr}${valueErrorSuffix("array", "mutation")}`});
            }
            const itemType = attrSchema.itemType ?? attrSchema.type;
            if (itemType) {
                for (const [index, item] of mutation.value.entries()) {
                    await this.validateTypedValue(`${mutation.attr}[${index}]`, item, itemType, attrSchema, "mutation");
                }
            }
            return;
        }
        const type = attrSchema?.type ?? attrSchema?.itemType;
        if (type === "float") {
            await this.validateTypedValue(mutation.attr, mutation.value, type, attrSchema ?? {}, "mutation");
        }
        if (!isJsonValue(mutation.value)) {
            throw createError({statusCode: 400, message: `${mutation.attr} value 必须是 JSON 值`});
        }
        if (attrSchema && normalizeAttrKind(attrSchema) === "object") {
            await this.validateObjectValue(mutation.attr, mutation.value ?? null, attrSchema, "mutation");
            return;
        }
        if (!attrSchema || !type) {
            return;
        }
        if (type === "object") {
            // list / collection 的 itemType=object：被追加 / 加入的是单个 object item，不递归校验其内部字段。
            if (!isObject(mutation.value)) {
                throw createError({statusCode: 400, message: `${mutation.attr}${valueErrorSuffix("object", "mutation")}`});
            }
            return;
        }
        await this.validateTypedValue(mutation.attr, mutation.value, type, attrSchema, "mutation");
    }

    private async validateObjectValue(attr: string, value: JsonValue, attrSchema: WorldAttrSchema, mode: "mutation" | "default"): Promise<void> {
        if (!isObject(value)) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("object", mode)}`});
        }
        if (attrSchema.fields) {
            for (const key of Object.keys(value)) {
                const fieldSchema = attrSchema.fields[key];
                if (!fieldSchema) {
                    throw createError({statusCode: 400, message: `${attr}.${key} 未在 object.fields 声明`});
                }
                await this.validateValueBySchema(`${attr}.${key}`, value[key] ?? null, fieldSchema, mode);
            }
            return;
        }
        if (attrSchema.itemType) {
            for (const [key, item] of Object.entries(value)) {
                await this.validateTypedValue(`${attr}.${key}`, item, attrSchema.itemType, attrSchema, mode);
            }
        }
    }

    private async validateValueBySchema(attr: string, value: JsonValue, attrSchema: WorldAttrSchema, mode: "mutation" | "default"): Promise<void> {
        if (normalizeAttrKind(attrSchema) === "object") {
            await this.validateObjectValue(attr, value, attrSchema, mode);
            return;
        }
        const type = attrSchema.type ?? attrSchema.itemType;
        if (type) {
            await this.validateTypedValue(attr, value, type, attrSchema, mode);
        }
    }

    private async validateTypedValue(attr: string, value: JsonValue | undefined, type: string, attrSchema: WorldAttrSchema, mode: "mutation" | "default"): Promise<void> {
        if (type === "int" && (!Number.isInteger(value) || typeof value !== "number")) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("int", mode)}`});
        }
        if (type === "int" && !Number.isSafeInteger(value)) {
            throw createError({statusCode: 400, message: `${attr}${safeIntegerErrorSuffix(mode)}`});
        }
        if (type === "float" && (typeof value !== "number" || !Number.isFinite(value))) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("float", mode)}`});
        }
        if (type === "text" && typeof value !== "string") {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("text", mode)}`});
        }
        if (type === "bool" && typeof value !== "boolean") {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("bool", mode)}`});
        }
        if (type === "enum" && attrSchema.enum && !attrSchema.enum.some((item) => stableJson(item) === stableJson(toJsonValue(value)))) {
            throw createError({statusCode: 400, message: `${attr}${enumErrorSuffix(mode)}`});
        }
        if (type === "object" && !isObject(value)) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("object", mode)}`});
        }
        const refType = parseRefType(type);
        if (refType) {
            await this.validateRef(value, refType, attr);
        }
    }

    private async validateRef(value: JsonValue | undefined, refType: string, attr: string): Promise<void> {
        if (typeof value !== "string" || !value.startsWith("subject://")) {
            throw createError({statusCode: 400, message: `${attr} 必须是 subject://<id> 引用`});
        }
        const targetId = value.slice("subject://".length);
        assertSubjectId(targetId, `${attr} 引用 id`);
        const target = await this.repository.findSubject(targetId);
        if (!target) {
            throw createError({statusCode: 400, message: `引用目标不存在：${value}`});
        }
        if (target.type !== refType) {
            throw createError({statusCode: 400, message: `引用目标类型不匹配：${value} 需要 ${refType}，实际 ${target.type}`});
        }
    }

    private assertSubjectType(type: string): void {
        assertSubjectTypeKey(type);
        if (Object.keys(this.schema.subjectTypes).length > 0 && !this.schema.subjectTypes[type]) {
            throw createError({statusCode: 400, message: `schema 未声明 subject type：${type}`});
        }
    }
}

/** 给一组 mutation 补上从 startSeq 起的应用顺序。 */
function withSeq(mutations: MutationInput[], startSeq: number): Array<MutationInput & {seq: number}> {
    return mutations.map((mutation, offset) => ({...mutation, seq: startSeq + offset}));
}

function decodeRowMutation(row: WorldMutationRow): MutationInput {
    return {
        subjectId: row.subjectId,
        attr: row.attr,
        op: row.op as WorldMutationOp,
        value: row.value === null ? undefined : decodeJson(row.value),
    };
}

function sameMutationSequence(rows: WorldMutationRow[], mutations: MutationInput[]): boolean {
    if (rows.length !== mutations.length) {
        return false;
    }
    return rows.every((row, index) => mutationSignature(decodeRowMutation(row)) === mutationSignature(mutations[index]));
}

function diffMutations(left: MutationInput[], right: MutationInput[]): MutationInput[] {
    const rightCounts = new Map<string, number>();
    for (const mutation of right) {
        const signature = mutationSignature(mutation);
        rightCounts.set(signature, (rightCounts.get(signature) ?? 0) + 1);
    }
    const diff: MutationInput[] = [];
    for (const mutation of left) {
        const signature = mutationSignature(mutation);
        const count = rightCounts.get(signature) ?? 0;
        if (count > 0) {
            rightCounts.set(signature, count - 1);
            continue;
        }
        diff.push(mutation);
    }
    return diff;
}

function reorderedOverlapCandidates(previous: MutationInput[], next: MutationInput[]): {previous: MutationInput[]; next: MutationInput[]} {
    if (sameMutationInputSequence(previous, next)) {
        return {previous: [], next: []};
    }
    const previousIndexes = new Map<string, number[]>();
    for (const [index, mutation] of previous.entries()) {
        const signature = mutationSignature(mutation);
        previousIndexes.set(signature, [...(previousIndexes.get(signature) ?? []), index]);
    }
    const matched = next.map((mutation, nextIndex) => {
        const indexes = previousIndexes.get(mutationSignature(mutation)) ?? [];
        const previousIndex = indexes.shift();
        return previousIndex === undefined ? null : {previousIndex, nextIndex, previous: previous[previousIndex], next: mutation};
    }).filter((item): item is {previousIndex: number; nextIndex: number; previous: MutationInput; next: MutationInput} => item !== null);
    const previousCandidates: MutationInput[] = [];
    const nextCandidates: MutationInput[] = [];
    for (let left = 0; left < matched.length; left += 1) {
        const leftItem = matched[left];
        if (!leftItem) {
            continue;
        }
        for (let right = left + 1; right < matched.length; right += 1) {
            const rightItem = matched[right];
            if (!rightItem) {
                continue;
            }
            if (leftItem.previousIndex < rightItem.previousIndex || !mutationsOverlap(leftItem.next, rightItem.next)) {
                continue;
            }
            previousCandidates.push(leftItem.previous, rightItem.previous);
            nextCandidates.push(leftItem.next, rightItem.next);
        }
    }
    return {previous: uniqueMutations(previousCandidates), next: uniqueMutations(nextCandidates)};
}

function sameMutationInputSequence(left: MutationInput[], right: MutationInput[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((mutation, index) => mutationSignature(mutation) === mutationSignature(right[index]));
}

function mutationsOverlap(left: MutationInput, right: MutationInput): boolean {
    return left.subjectId === right.subjectId && attrPathsOverlap(left.attr, right.attr);
}

function uniqueMutations(mutations: MutationInput[]): MutationInput[] {
    const seen = new Set<string>();
    const uniqueItems: MutationInput[] = [];
    for (const mutation of mutations) {
        const signature = mutationSignature(mutation);
        if (seen.has(signature)) {
            continue;
        }
        seen.add(signature);
        uniqueItems.push(mutation);
    }
    return uniqueItems;
}

function mutationSignature(mutation: MutationInput | undefined): string {
    if (!mutation) {
        return "";
    }
    const value = mutation.op === "unset" ? "" : stableJson(toJsonValue(mutation.value));
    return `${mutation.subjectId}\u0000${mutation.attr}\u0000${mutation.op}\u0000${value}`;
}

function scalarOps(attrSchema: WorldAttrSchema | null): WorldMutationOp[] {
    const type = attrSchema?.type;
    if (!type || type === "int" || type === "float") {
        return ["set", "add", "unset"];
    }
    return ["set", "unset"];
}

/**
 * 应用一条 mutation 到 reduce 状态；遇到相对 op 缺基 / 集合删不存在元素时**不兜底**，
 * 返回一个属性级问题（broken-relative），由调用方补 subjectId / sliceId。
 */
function applyAndDetect(state: Record<string, JsonValue>, mutation: MutationInput, attrSchema: WorldAttrSchema | null = null): AttrIssue | null {
    const attr = mutation.attr;
    if (mutation.op === "unset") {
        unsetPath(state, attr);
        return null;
    }
    if (mutation.op === "set") {
        setPath(state, attr, toJsonValue(mutation.value ?? null));
        return null;
    }
    if (mutation.op === "add") {
        const base = getPath(state, attr);
        if (base === MISSING || typeof base !== "number" || !Number.isFinite(base)) {
            return {code: "broken-relative", attr, message: `add ${attr} 缺少已存在的数值基准`};
        }
        const delta = Number(mutation.value);
        const result = base + delta;
        if (!Number.isFinite(result)) {
            return {code: "broken-relative", attr, message: `add ${attr} 结果不是有限数`};
        }
        if (attrSchema?.type === "int") {
            if (!Number.isSafeInteger(base) || !Number.isSafeInteger(delta)) {
                return {code: "broken-relative", attr, message: `add ${attr} 基准或增量不是安全整数`};
            }
            if (!Number.isSafeInteger(result)) {
                return {code: "broken-relative", attr, message: `add ${attr} 结果超出安全整数范围`};
            }
        }
        setPath(state, attr, result);
        return null;
    }
    if (mutation.op === "listAppend") {
        const base = getPath(state, attr);
        if (base === MISSING || !Array.isArray(base)) {
            return {code: "broken-relative", attr, message: `listAppend ${attr} 缺少已存在的 list 基准`};
        }
        setPath(state, attr, [...base, toJsonValue(mutation.value ?? null)]);
        return null;
    }
    if (mutation.op === "collectionAdd") {
        const base = getPath(state, attr);
        if (base === MISSING || !Array.isArray(base)) {
            return {code: "broken-relative", attr, message: `collectionAdd ${attr} 缺少已存在的 collection 基准`};
        }
        const value = toJsonValue(mutation.value ?? null);
        const list = base.some((item) => stableJson(item) === stableJson(value)) ? [...base] : [...base, value];
        setPath(state, attr, list);
        return null;
    }
    if (mutation.op === "collectionRemove") {
        const base = getPath(state, attr);
        if (base === MISSING || !Array.isArray(base)) {
            return {code: "broken-relative", attr, message: `collectionRemove ${attr} 缺少已存在的 collection 基准`};
        }
        const value = stableJson(toJsonValue(mutation.value ?? null));
        if (!base.some((item) => stableJson(item) === value)) {
            return {code: "broken-relative", attr, message: `collectionRemove ${attr} 目标元素不存在`};
        }
        setPath(state, attr, base.filter((item) => stableJson(item) !== value));
        return null;
    }
    return null;
}

function getPath(state: Record<string, JsonValue>, attr: string): JsonValue | typeof MISSING {
    let current: JsonValue | undefined = state;
    for (const part of attr.split(".")) {
        if (!isObject(current) || !(part in current)) {
            return MISSING;
        }
        current = current[part] ?? null;
    }
    return current ?? null;
}

function setPath(state: Record<string, JsonValue>, attr: string, value: JsonValue): void {
    const parts = attr.split(".");
    const leaf = parts.at(-1);
    if (!leaf) {
        throw createError({statusCode: 400, message: "attr 不能为空"});
    }
    let current: Record<string, JsonValue> = state;
    for (const part of parts.slice(0, -1)) {
        const next = current[part];
        if (!isObject(next)) {
            current[part] = {};
        }
        current = current[part] as Record<string, JsonValue>;
    }
    current[leaf] = value;
}

function unsetPath(state: Record<string, JsonValue>, attr: string): void {
    const parts = attr.split(".");
    const leaf = parts.at(-1);
    if (!leaf) {
        throw createError({statusCode: 400, message: "attr 不能为空"});
    }
    let current: JsonValue = state;
    for (const part of parts.slice(0, -1)) {
        if (!isObject(current)) {
            return;
        }
        current = current[part] ?? null;
    }
    if (isObject(current)) {
        delete current[leaf];
    }
}

function decodeJson(input: string): JsonValue {
    return JSON.parse(input) as JsonValue;
}

function toJsonValue(input: JsonValue | undefined): JsonValue {
    if (input === undefined) {
        return null;
    }
    return JSON.parse(JSON.stringify(input)) as JsonValue;
}

function cloneJson<T extends JsonValue>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
}

function projectAttrs(attrs: Record<string, JsonValue>, paths: string[]): Record<string, JsonValue> {
    const projected: Record<string, JsonValue> = {};
    for (const path of paths) {
        const value = getPath(attrs, path);
        if (value !== MISSING) {
            setPath(projected, path, cloneJson(value));
        }
    }
    return projected;
}

function filterIssuesForAttrs(issues: WorldIssue[], attrs: string[]): WorldIssue[] {
    return issues.filter((issue) => attrs.some((attr) => attrPathsOverlap(attr, issue.attr)));
}

function attrPathsOverlap(left: string, right: string): boolean {
    return attrPathContains(left, right) || attrPathContains(right, left);
}

function attrPathContains(parent: string, child: string): boolean {
    return parent === child || child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`);
}

function isCoveredByPath(attr: string, paths: string[]): boolean {
    return paths.some((path) => attrPathContains(path, attr));
}

function limitBySchema(value: JsonValue, attrSchema: WorldAttrSchema | null, limit: number): JsonValue {
    const kind = normalizeAttrKind(attrSchema);
    if ((kind === "list" || kind === "collection") && Array.isArray(value)) {
        return value.slice(-limit).map((item) => cloneJson(item));
    }
    if (kind === "object" && attrSchema?.fields && isObject(value)) {
        const limited: Record<string, JsonValue> = {};
        for (const [key, item] of Object.entries(value)) {
            limited[key] = limitBySchema(item, attrSchema.fields[key] ?? null, limit);
        }
        return limited;
    }
    return cloneJson(value);
}

function limitAttrRecord(value: Record<string, JsonValue>, limit: number, schema: WorldSchema, subjectType: string): Record<string, JsonValue> {
    const limited: Record<string, JsonValue> = {};
    for (const [attr, item] of Object.entries(value)) {
        limited[attr] = limitBySchema(item, findAttrSchema(schema, subjectType, attr), limit);
    }
    return limited;
}

function isObject(input: JsonValue | undefined): input is Record<string, JsonValue> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isJsonValue(input: unknown): input is JsonValue {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
        return true;
    }
    if (typeof input === "number") {
        return Number.isFinite(input);
    }
    if (Array.isArray(input)) {
        return input.every(isJsonValue);
    }
    if (isObjectLike(input)) {
        return Object.values(input).every(isJsonValue);
    }
    return false;
}

function isObjectLike(input: unknown): input is Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
}

function parseRefType(type: string): string | null {
    const match = /^ref\(([^)]+)\)$/.exec(type);
    return match?.[1] ?? null;
}

function recordOriginAfterMutation(
    originByAttr: Map<string, string>,
    mutation: MutationInput,
    sliceId: string,
    previousValue: JsonValue | typeof MISSING,
    currentValue: JsonValue | typeof MISSING,
): void {
    if (mutation.op === "unset") {
        clearOrigin(originByAttr, mutation.attr);
        return;
    }
    if (mutation.op === "listAppend") {
        if (Array.isArray(currentValue)) {
            originByAttr.set(`${mutation.attr}[${currentValue.length - 1}]`, sliceId);
        }
        return;
    }
    if (mutation.op === "collectionAdd") {
        if (!Array.isArray(currentValue)) {
            return;
        }
        const addedValue = stableJson(toJsonValue(mutation.value));
        const alreadyExisted = Array.isArray(previousValue) && previousValue.some((item) => stableJson(item) === addedValue);
        if (alreadyExisted) {
            return;
        }
        const index = currentValue.findIndex((item) => stableJson(item) === addedValue);
        if (index >= 0) {
            originByAttr.set(`${mutation.attr}[${index}]`, sliceId);
        }
        return;
    }
    if (mutation.op === "collectionRemove") {
        remapCollectionOrigins(originByAttr, mutation.attr, previousValue, currentValue);
        return;
    }
    originByAttr.set(mutation.attr, sliceId);
}

function clearOrigin(originByAttr: Map<string, string>, attr: string): void {
    for (const key of [...originByAttr.keys()]) {
        if (key === attr || key.startsWith(`${attr}.`) || key.startsWith(`${attr}[`)) {
            originByAttr.delete(key);
        }
    }
}

function remapCollectionOrigins(
    originByAttr: Map<string, string>,
    attr: string,
    previousValue: JsonValue | typeof MISSING,
    currentValue: JsonValue | typeof MISSING,
): void {
    if (!Array.isArray(previousValue) || !Array.isArray(currentValue)) {
        return;
    }
    const originByValue = new Map<string, string>();
    previousValue.forEach((item, index) => {
        const origin = originByAttr.get(`${attr}[${index}]`) ?? originByAttr.get(attr);
        if (origin) {
            originByValue.set(stableJson(item), origin);
        }
    });
    clearOrigin(originByAttr, attr);
    currentValue.forEach((item, index) => {
        const origin = originByValue.get(stableJson(item));
        if (origin) {
            originByAttr.set(`${attr}[${index}]`, origin);
        }
    });
}

function findOriginSlice(originByAttr: Map<string, string>, attr: string): string | undefined {
    const exact = originByAttr.get(attr);
    if (exact) {
        return exact;
    }
    const normalized = attr.replace(/\[\d+\]/g, "");
    const parts = normalized.split(".");
    while (parts.length > 0) {
        const sliceId = originByAttr.get(parts.join("."));
        if (sliceId) {
            return sliceId;
        }
        parts.pop();
    }
    return undefined;
}

function valueErrorSuffix(type: string, mode: "mutation" | "default"): string {
    return mode === "default" ? ` default 必须是 ${type}` : ` 必须是 ${type}`;
}

function safeIntegerErrorSuffix(mode: "mutation" | "default"): string {
    return mode === "default" ? " default 必须是安全整数" : " 必须是安全整数";
}

function enumErrorSuffix(mode: "mutation" | "default"): string {
    return mode === "default" ? " default 不在 enum 取值内" : " 不在 enum 取值内";
}

function affectedSubjectIds(mutations: MutationInput[]): string[] {
    return unique(mutations.map((mutation) => mutation.subjectId));
}

function assertRequestedSubjectsFound<TSubject extends {id: string}>(requestedIds: string[] | undefined, subjects: TSubject[]): void {
    if (!requestedIds?.length) {
        return;
    }
    const foundIds = new Set(subjects.map((subject) => subject.id));
    const missing = unique(requestedIds.filter((id) => !foundIds.has(id)));
    if (missing.length) {
        throw createError({statusCode: 404, message: `subject 不存在或不匹配查询条件：${missing.join(", ")}`});
    }
}

function assertUniqueStrings(values: string[] | undefined, label: string): void {
    if (!values?.length) {
        return;
    }
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const value of values) {
        if (seen.has(value) && !duplicates.includes(value)) {
            duplicates.push(value);
        }
        seen.add(value);
    }
    if (duplicates.length) {
        throw createError({statusCode: 400, message: `${label} 不能重复：${duplicates.join(", ")}`});
    }
}

function assertNonEmptyArray(values: string[] | undefined, label: string): void {
    if (values !== undefined && values.length === 0) {
        throw createError({statusCode: 400, message: `${label} 不能为空`});
    }
}

function assertAttrPath(attr: string): void {
    const parts = attr.split(".");
    if (parts.some((part) => part.trim() === "")) {
        throw createError({statusCode: 400, message: `attr 路径不能包含空段：${attr}`});
    }
    if (parts.some((part) => part !== part.trim())) {
        throw createError({statusCode: 400, message: `attr 路径段不能包含前后空白：${attr}`});
    }
}

function assertSubjectId(subjectId: string, label: string): void {
    if (subjectId.trim() === "") {
        throw createError({statusCode: 400, message: `${label} 不能为空`});
    }
    if (subjectId !== subjectId.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${subjectId}`});
    }
}

function assertSliceId(sliceId: string): void {
    if (sliceId.trim() === "") {
        throw createError({statusCode: 400, message: "sliceId 不能为空"});
    }
    if (sliceId !== sliceId.trim()) {
        throw createError({statusCode: 400, message: `sliceId 不能包含前后空白：${sliceId}`});
    }
}

function assertSubjectTypeKey(type: string): void {
    if (type.trim() === "") {
        throw createError({statusCode: 400, message: "subject type 不能为空"});
    }
    if (/\s/.test(type)) {
        throw createError({statusCode: 400, message: `subject type 不能包含空白：${type}`});
    }
    if (type.includes("(") || type.includes(")")) {
        throw createError({statusCode: 400, message: `subject type 不能包含括号：${type}`});
    }
}

function assertSliceKind(kind: string | undefined): void {
    if (kind === undefined) {
        return;
    }
    if (kind.trim() === "") {
        throw createError({statusCode: 400, message: "kind 不能为空"});
    }
    if (kind !== kind.trim()) {
        throw createError({statusCode: 400, message: `kind 不能包含前后空白：${kind}`});
    }
}

function assertQueryScope(query: {subjectIds?: string[]; type?: string}): void {
    if (!query.subjectIds?.length && !query.type) {
        throw createError({statusCode: 400, message: "queryState 必须提供 subjectIds 或 type"});
    }
}

function assertSliceSubjectMode(mode: WorldSliceSubjectFilterMode | undefined, subjectIds: string[] | undefined): void {
    if (mode === undefined) {
        return;
    }
    if (mode !== "any" && mode !== "all") {
        throw createError({statusCode: 400, message: "subjectMode 必须是 any 或 all"});
    }
    if (!subjectIds?.length) {
        throw createError({statusCode: 400, message: "subjectMode 需要同时提供 subjectIds"});
    }
}

function assertListLimit(listLimit: number | undefined): void {
    if (listLimit === undefined) {
        return;
    }
    if (!Number.isInteger(listLimit) || listLimit < 1 || listLimit > 100) {
        throw createError({statusCode: 400, message: "listLimit 必须是 1..100 的整数"});
    }
}

function assertSqliteInstant(value: bigint | undefined, label: string): void {
    if (value === undefined) {
        return;
    }
    if (value < SQLITE_INT64_MIN || value > SQLITE_INT64_MAX) {
        throw createError({statusCode: 400, message: `${label} 超出 SQLite INTEGER 64 位范围：${value}`});
    }
}

function assertMutationCapacity(count: number): void {
    if (count > MAX_SLICE_MUTATIONS) {
        throw createError({statusCode: 400, message: `mutations 不能超过 ${MAX_SLICE_MUTATIONS} 条`});
    }
}

function assertPositiveInteger(value: number | undefined, label: string): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw createError({statusCode: 400, message: `${label} 必须是安全正整数`});
    }
}

function assertInstantRange(from: bigint | undefined, to: bigint | undefined): void {
    if (from !== undefined && to !== undefined && from > to) {
        throw createError({statusCode: 400, message: "from 不能晚于 to"});
    }
}

function unique(input: string[]): string[] {
    return [...new Set(input)].sort((left, right) => left.localeCompare(right));
}

function uniqueInstants(input: bigint[]): bigint[] {
    return [...new Set(input.map((item) => item.toString()))].map((item) => BigInt(item)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function dedupeIssues(issues: WorldIssue[]): WorldIssue[] {
    const seen = new Set<string>();
    const result: WorldIssue[] = [];
    for (const issue of issues) {
        const key = `${issue.code}\u0000${issue.sliceId ?? ""}\u0000${issue.subjectId}\u0000${issue.attr}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(issue);
    }
    return result;
}

function orderSubjects<TSubject extends {id: string}>(subjects: TSubject[], ids: string[] | undefined): TSubject[] {
    if (!ids?.length) {
        return subjects;
    }
    const order = new Map(ids.map((id, index) => [id, index]));
    return [...subjects].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

function stableJson(input: JsonValue): string {
    if (Array.isArray(input)) {
        return `[${input.map((item) => stableJson(item)).join(",")}]`;
    }
    if (isObject(input)) {
        return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stableJson(input[key] ?? null)}`).join(",")}}`;
    }
    return JSON.stringify(input);
}
