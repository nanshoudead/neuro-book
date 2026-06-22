import {randomUUID} from "node:crypto";
import type {WorldMutation, WorldSlice, WorldSubject} from "nbook/server/generated/project-prisma/client";
import type {MutationInput, SliceInput, WorldMutationRow, WorldPrismaExecutor, WorldSliceSubjectFilterMode} from "nbook/server/world-engine/types";

/** 世界引擎 Prisma 仓储。 */
export class WorldEngineRepository {
    constructor(private readonly prisma: WorldPrismaExecutor) {}

    /** 创建 subject 身份记录。 */
    async createSubject(input: {id: string; type: string; name: string}): Promise<WorldSubject> {
        return this.prisma.worldSubject.create({data: input});
    }

    /** 按 id 查询 subject。 */
    async findSubject(subjectId: string): Promise<WorldSubject | null> {
        return this.prisma.worldSubject.findUnique({where: {id: subjectId}});
    }

    /** 按查询条件列出 subject。 */
    async listSubjects(query: {ids?: string[]; type?: string} = {}): Promise<WorldSubject[]> {
        return this.prisma.worldSubject.findMany({
            where: {
                id: query.ids ? {in: query.ids} : undefined,
                type: query.type,
            },
            orderBy: [{type: "asc"}, {id: "asc"}],
        });
    }

    /** 查询某 instant 上的切面。 */
    async findSliceByInstant(instant: bigint): Promise<WorldSlice | null> {
        return this.prisma.worldSlice.findUnique({where: {instant}});
    }

    /** 查询切面及其 mutation。 */
    async findSliceWithMutations(sliceId: string): Promise<(WorldSlice & {mutations: WorldMutation[]}) | null> {
        return this.prisma.worldSlice.findUnique({
            where: {id: sliceId},
            include: {mutations: {orderBy: {seq: "asc"}}},
        });
    }

    /** 查询指定 instant 之前最近的切面。 */
    async findPreviousSlice(instant: bigint): Promise<WorldSlice | null> {
        return this.prisma.worldSlice.findFirst({
            where: {instant: {lt: instant}},
            orderBy: {instant: "desc"},
        });
    }

    /** 创建一个新切面与 mutation 行。 */
    async createSlice(input: SliceInput, mutations: Array<MutationInput & {seq: number}>): Promise<WorldSlice> {
        return this.prisma.worldSlice.create({
            data: {
                id: randomUUID(),
                instant: input.instant,
                title: input.title ?? "",
                summary: input.summary ?? "",
                kind: input.kind ?? "event",
                mutations: {
                    create: mutations.map((mutation) => ({
                        id: randomUUID(),
                        subjectId: mutation.subjectId,
                        instant: input.instant,
                        seq: mutation.seq,
                        attr: mutation.attr,
                        op: mutation.op,
                        value: encodeMutationValue(mutation),
                    })),
                },
            },
        });
    }

    /** 把 init mutations 追加进已有切面。 */
    async appendMutations(sliceId: string, instant: bigint, mutations: Array<MutationInput & {seq: number}>): Promise<void> {
        if (mutations.length === 0) {
            return;
        }
        await this.prisma.worldMutation.createMany({
            data: mutations.map((mutation) => ({
                id: randomUUID(),
                sliceId,
                subjectId: mutation.subjectId,
                instant,
                seq: mutation.seq,
                attr: mutation.attr,
                op: mutation.op,
                value: encodeMutationValue(mutation),
            })),
        });
    }

    /** 返回某切面当前最大 seq；无 mutation 时返回 -1。 */
    async maxSeq(sliceId: string): Promise<number> {
        const result = await this.prisma.worldMutation.aggregate({
            where: {sliceId},
            _max: {seq: true},
        });
        return result._max.seq ?? -1;
    }

    /** 整块替换切面与 mutation。 */
    async replaceSlice(sliceId: string, input: SliceInput, mutations: Array<MutationInput & {seq: number}>): Promise<WorldSlice> {
        await this.prisma.worldMutation.deleteMany({where: {sliceId}});
        return this.prisma.worldSlice.update({
            where: {id: sliceId},
            data: {
                instant: input.instant,
                title: input.title ?? "",
                summary: input.summary ?? "",
                kind: input.kind ?? "event",
                mutations: {
                    create: mutations.map((mutation) => ({
                        id: randomUUID(),
                        subjectId: mutation.subjectId,
                        instant: input.instant,
                        seq: mutation.seq,
                        attr: mutation.attr,
                        op: mutation.op,
                        value: encodeMutationValue(mutation),
                    })),
                },
            },
        });
    }

    /** 物理删除切面（其 mutation 行随 onDelete: Cascade 一并删除）。 */
    async deleteSlice(sliceId: string): Promise<void> {
        await this.prisma.worldSlice.delete({where: {id: sliceId}});
    }

    /** 查询某 subject 在 at 之前或之前含 at 的 mutation。 */
    async findMutationsForSubject(input: {subjectId: string; at?: bigint; beforeInstant?: bigint; from?: bigint; excludeSliceId?: string}): Promise<WorldMutationRow[]> {
        return this.prisma.worldMutation.findMany({
            where: {
                subjectId: input.subjectId,
                sliceId: input.excludeSliceId ? {not: input.excludeSliceId} : undefined,
                instant: {
                    lte: input.at,
                    lt: input.beforeInstant,
                    gte: input.from,
                },
            },
            orderBy: [{instant: "asc"}, {seq: "asc"}],
        });
    }

    /** 查询最新 instant。 */
    async latestInstant(): Promise<bigint | null> {
        const latest = await this.prisma.worldSlice.findFirst({orderBy: {instant: "desc"}});
        return latest?.instant ?? null;
    }

    /** 列切面。 */
    async listSlices(query: {from?: bigint; to?: bigint; limit?: number; withMutations?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode}): Promise<Array<WorldSlice & {mutations?: WorldMutation[]}>> {
        const orderBy = query.limit && query.from === undefined && query.to === undefined ? {instant: "desc" as const} : {instant: "asc" as const};
        const subjectFilters = buildSubjectSliceFilters(query.subjectIds, query.subjectMode);
        const rows = await this.prisma.worldSlice.findMany({
            where: {
                instant: {
                    gte: query.from,
                    lte: query.to,
                },
                AND: subjectFilters.length ? subjectFilters : undefined,
            },
            orderBy,
            take: query.limit,
            include: query.withMutations ? {mutations: {orderBy: {seq: "asc"}}} : undefined,
        });
        return orderBy.instant === "desc" ? rows.reverse() : rows;
    }
}

function buildSubjectSliceFilters(subjectIds: string[] | undefined, mode: WorldSliceSubjectFilterMode | undefined) {
    if (!subjectIds?.length) {
        return [];
    }
    if (mode === "all") {
        return subjectIds.map((subjectId) => ({mutations: {some: {subjectId}}}));
    }
    return [{mutations: {some: {subjectId: {in: subjectIds}}}}];
}

function encodeMutationValue(mutation: MutationInput): string | null {
    return mutation.op === "unset" ? null : JSON.stringify(mutation.value ?? null);
}
