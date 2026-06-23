import {randomUUID} from "node:crypto";
import type {Client, InValue} from "@libsql/client";
import type {MutationInput, SliceInput, WorldMutationRow, WorldSliceSubjectFilterMode} from "nbook/server/world-engine/types";

type WorldSubjectRow = {
    id: string;
    type: string;
    name: string;
    createdAt: Date;
};

type WorldSliceRow = {
    id: string;
    instant: bigint;
    title: string;
    summary: string;
    kind: string;
    createdAt: Date;
};

type WorldMutationSqlRow = WorldMutationRow & {
    id: string;
};

type WorldSliceWithMutations = WorldSliceRow & {
    mutations: WorldMutationSqlRow[];
};

type SqlRow = Record<string, unknown>;
type SqlArgs = InValue[];

/** 世界引擎 SQLite 仓储。 */
export class WorldEngineRepository {
    constructor(private readonly client: Client) {}

    /** 创建 subject 身份记录。 */
    async createSubject(input: {id: string; type: string; name: string}): Promise<WorldSubjectRow> {
        await this.execute(
            `INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, ?, ?)`,
            [input.id, input.type, input.name],
        );
        const subject = await this.findSubject(input.id);
        if (!subject) {
            throw new Error(`WorldSubject 写入后读取失败：${input.id}`);
        }
        return subject;
    }

    /** 按 id 查询 subject。 */
    async findSubject(subjectId: string): Promise<WorldSubjectRow | null> {
        const row = await this.queryOne(`SELECT * FROM "WorldSubject" WHERE "id" = ?`, [subjectId]);
        return row ? toSubject(row) : null;
    }

    /** 按查询条件列出 subject。 */
    async listSubjects(query: {ids?: string[]; type?: string} = {}): Promise<WorldSubjectRow[]> {
        const where: string[] = [];
        const args: SqlArgs = [];
        if (query.ids?.length) {
            where.push(`"id" IN (${placeholders(query.ids.length)})`);
            args.push(...query.ids);
        }
        if (query.type !== undefined) {
            where.push(`"type" = ?`);
            args.push(query.type);
        }
        const rows = await this.queryRows(
            `SELECT * FROM "WorldSubject"${renderWhere(where)} ORDER BY "type" ASC, "id" ASC`,
            args,
        );
        return rows.map(toSubject);
    }

    /** 查询某 instant 上的切面。 */
    async findSliceByInstant(instant: bigint): Promise<WorldSliceRow | null> {
        const row = await this.queryOne(`SELECT * FROM "WorldSlice" WHERE "instant" = ?`, [instant]);
        return row ? toSlice(row) : null;
    }

    /** 查询切面及其 mutation。 */
    async findSliceWithMutations(sliceId: string): Promise<WorldSliceWithMutations | null> {
        const slice = await this.queryOne(`SELECT * FROM "WorldSlice" WHERE "id" = ?`, [sliceId]);
        if (!slice) {
            return null;
        }
        return {
            ...toSlice(slice),
            mutations: await this.listMutationsBySlice(sliceId),
        };
    }

    /** 查询指定 instant 之前最近的切面。 */
    async findPreviousSlice(instant: bigint): Promise<WorldSliceRow | null> {
        const row = await this.queryOne(
            `SELECT * FROM "WorldSlice" WHERE "instant" < ? ORDER BY "instant" DESC LIMIT 1`,
            [instant],
        );
        return row ? toSlice(row) : null;
    }

    /** 创建一个新切面与 mutation 行。 */
    async createSlice(input: SliceInput, mutations: Array<MutationInput & {seq: number}>): Promise<WorldSliceRow> {
        const id = randomUUID();
        await this.execute(
            `INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES (?, ?, ?, ?, ?)`,
            [id, input.instant, input.title ?? "", input.summary ?? "", input.kind ?? "event"],
        );
        await this.appendMutations(id, input.instant, mutations);
        const slice = await this.findSliceWithMutations(id);
        if (!slice) {
            throw new Error(`WorldSlice 写入后读取失败：${id}`);
        }
        return slice;
    }

    /** 把 init mutations 追加进已有切面。 */
    async appendMutations(sliceId: string, instant: bigint, mutations: Array<MutationInput & {seq: number}>): Promise<void> {
        for (const mutation of mutations) {
            await this.execute(
                `INSERT INTO "WorldMutation" ("id", "sliceId", "subjectId", "instant", "seq", "attr", "op", "value") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), sliceId, mutation.subjectId, instant, mutation.seq, mutation.attr, mutation.op, encodeMutationValue(mutation)],
            );
        }
    }

    /** 返回某切面当前最大 seq；无 mutation 时返回 -1。 */
    async maxSeq(sliceId: string): Promise<number> {
        const row = await this.queryOne(`SELECT MAX("seq") AS "maxSeq" FROM "WorldMutation" WHERE "sliceId" = ?`, [sliceId]);
        const value = row?.maxSeq;
        return typeof value === "number" ? value : -1;
    }

    /** 整块替换切面与 mutation。 */
    async replaceSlice(sliceId: string, input: SliceInput, mutations: Array<MutationInput & {seq: number}>): Promise<WorldSliceRow> {
        await this.execute(`DELETE FROM "WorldMutation" WHERE "sliceId" = ?`, [sliceId]);
        await this.execute(
            `UPDATE "WorldSlice" SET "instant" = ?, "title" = ?, "summary" = ?, "kind" = ? WHERE "id" = ?`,
            [input.instant, input.title ?? "", input.summary ?? "", input.kind ?? "event", sliceId],
        );
        await this.appendMutations(sliceId, input.instant, mutations);
        const slice = await this.findSliceWithMutations(sliceId);
        if (!slice) {
            throw new Error(`WorldSlice 替换后读取失败：${sliceId}`);
        }
        return slice;
    }

    /** 物理删除切面（其 mutation 行随 onDelete: Cascade 一并删除）。 */
    async deleteSlice(sliceId: string): Promise<void> {
        await this.execute(`DELETE FROM "WorldSlice" WHERE "id" = ?`, [sliceId]);
    }

    /** 查询某 subject 在 at 之前或之前含 at 的 mutation。 */
    async findMutationsForSubject(input: {subjectId: string; at?: bigint; beforeInstant?: bigint; from?: bigint; excludeSliceId?: string}): Promise<WorldMutationRow[]> {
        const where = [`"subjectId" = ?`];
        const args: SqlArgs = [input.subjectId];
        if (input.excludeSliceId) {
            where.push(`"sliceId" <> ?`);
            args.push(input.excludeSliceId);
        }
        if (input.at !== undefined) {
            where.push(`"instant" <= ?`);
            args.push(input.at);
        }
        if (input.beforeInstant !== undefined) {
            where.push(`"instant" < ?`);
            args.push(input.beforeInstant);
        }
        if (input.from !== undefined) {
            where.push(`"instant" >= ?`);
            args.push(input.from);
        }
        const rows = await this.queryRows(
            `SELECT * FROM "WorldMutation"${renderWhere(where)} ORDER BY "instant" ASC, "seq" ASC`,
            args,
        );
        return rows.map(toMutation);
    }

    /** 查询最新 instant。 */
    async latestInstant(): Promise<bigint | null> {
        const row = await this.queryOne(`SELECT "instant" FROM "WorldSlice" ORDER BY "instant" DESC LIMIT 1`, []);
        return row ? toBigInt(row.instant) : null;
    }

    /** 列切面。 */
    async listSlices(query: {from?: bigint; to?: bigint; limit?: number; withMutations?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode}): Promise<Array<WorldSliceRow & {mutations?: WorldMutationSqlRow[]}>> {
        const where: string[] = [];
        const args: SqlArgs = [];
        if (query.from !== undefined) {
            where.push(`"instant" >= ?`);
            args.push(query.from);
        }
        if (query.to !== undefined) {
            where.push(`"instant" <= ?`);
            args.push(query.to);
        }
        appendSubjectFilters(where, args, query.subjectIds, query.subjectMode);
        const order = query.limit && query.from === undefined && query.to === undefined ? "DESC" : "ASC";
        const limit = query.limit ? ` LIMIT ${query.limit}` : "";
        const rows = await this.queryRows(
            `SELECT * FROM "WorldSlice"${renderWhere(where)} ORDER BY "instant" ${order}${limit}`,
            args,
        );
        const slices = rows.map(toSlice);
        const ordered = order === "DESC" ? slices.reverse() : slices;
        if (!query.withMutations) {
            return ordered;
        }
        return Promise.all(ordered.map(async (slice) => ({
            ...slice,
            mutations: await this.listMutationsBySlice(slice.id),
        })));
    }

    private async listMutationsBySlice(sliceId: string): Promise<WorldMutationSqlRow[]> {
        const rows = await this.queryRows(
            `SELECT * FROM "WorldMutation" WHERE "sliceId" = ? ORDER BY "seq" ASC`,
            [sliceId],
        );
        return rows.map(toMutation);
    }

    private async execute(sql: string, args: SqlArgs): Promise<void> {
        await this.client.execute({sql, args});
    }

    private async queryRows(sql: string, args: SqlArgs): Promise<SqlRow[]> {
        const result = await this.client.execute({sql, args});
        return result.rows as SqlRow[];
    }

    private async queryOne(sql: string, args: SqlArgs): Promise<SqlRow | null> {
        return (await this.queryRows(sql, args))[0] ?? null;
    }
}

function appendSubjectFilters(where: string[], args: SqlArgs, subjectIds: string[] | undefined, mode: WorldSliceSubjectFilterMode | undefined): void {
    if (!subjectIds?.length) {
        return;
    }
    if (mode === "all") {
        for (const subjectId of subjectIds) {
            where.push(`EXISTS (SELECT 1 FROM "WorldMutation" m WHERE m."sliceId" = "WorldSlice"."id" AND m."subjectId" = ?)`);
            args.push(subjectId);
        }
        return;
    }
    where.push(`EXISTS (SELECT 1 FROM "WorldMutation" m WHERE m."sliceId" = "WorldSlice"."id" AND m."subjectId" IN (${placeholders(subjectIds.length)}))`);
    args.push(...subjectIds);
}

function renderWhere(where: string[]): string {
    return where.length ? ` WHERE ${where.join(" AND ")}` : "";
}

function placeholders(count: number): string {
    return Array.from({length: count}, () => "?").join(", ");
}

function toSubject(row: SqlRow): WorldSubjectRow {
    return {
        id: toText(row.id),
        type: toText(row.type),
        name: toText(row.name),
        createdAt: toDate(row.createdAt),
    };
}

function toSlice(row: SqlRow): WorldSliceRow {
    return {
        id: toText(row.id),
        instant: toBigInt(row.instant),
        title: toText(row.title),
        summary: toText(row.summary),
        kind: toText(row.kind),
        createdAt: toDate(row.createdAt),
    };
}

function toMutation(row: SqlRow): WorldMutationSqlRow {
    return {
        id: toText(row.id),
        sliceId: toText(row.sliceId),
        subjectId: toText(row.subjectId),
        instant: toBigInt(row.instant),
        seq: Number(row.seq ?? 0),
        attr: toText(row.attr),
        op: toText(row.op),
        value: row.value === null || row.value === undefined ? null : toText(row.value),
    };
}

function toText(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
}

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" || typeof value === "string") {
        return BigInt(value);
    }
    return BigInt(0);
}

function toDate(value: unknown): Date {
    const text = toText(value);
    return new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
}

function encodeMutationValue(mutation: MutationInput): string | null {
    return mutation.op === "unset" ? null : JSON.stringify(mutation.value ?? null);
}
