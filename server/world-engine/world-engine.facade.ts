import {PrismaLibSql} from "@prisma/adapter-libsql";
import {Prisma, PrismaClient} from "nbook/server/generated/project-prisma/client";
import {WorldCalendarLoader} from "nbook/server/world-engine/calendar";
import {WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {WorldEngineService} from "nbook/server/world-engine/world-engine.service";
import type {
    DeleteSliceResult,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    CreateWorldSubjectResult,
    WorldPrismaExecutor,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldState,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabase, normalizeProjectPath, resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

type WorldEngineModule = {
    service: WorldEngineService;
};

/** 世界引擎后端门面。 */
export class WorldEngineFacade {
    private readonly clients = new Map<string, PrismaClient>();
    private readonly schemaLoader = new WorldSchemaLoader();
    private readonly calendarLoader = new WorldCalendarLoader();

    /** 关闭指定 Project SQLite 的 PrismaClient。 */
    async closeProject(projectPath: string): Promise<void> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        const cacheKey = databasePath.replace(/\\/g, "/");
        const client = this.clients.get(cacheKey);
        if (!client) {
            return;
        }
        this.clients.delete(cacheKey);
        await client.$disconnect();
        collectReleasedSqliteHandles();
    }

    /** 创建 subject + 初始化切面。 */
    async createSubject(projectPath: string, input: {id: string; type: string; name?: string; at: bigint}): Promise<CreateWorldSubjectResult> {
        return this.runInTransaction(projectPath, (module) => module.service.createSubject(input));
    }

    /** 写入新切面。 */
    async writeSlice(projectPath: string, input: SliceInput): Promise<SliceWriteResult> {
        return this.runInTransaction(projectPath, (module) => module.service.writeSlice(input));
    }

    /** 整块编辑已有切面。 */
    async editSlice(projectPath: string, sliceId: string, input: SliceInput): Promise<SliceWriteResult> {
        return this.runInTransaction(projectPath, (module) => module.service.editSlice(sliceId, input));
    }

    /** 物理删除一个切面。 */
    async deleteSlice(projectPath: string, sliceId: string): Promise<DeleteSliceResult> {
        return this.runInTransaction(projectPath, (module) => module.service.deleteSlice(sliceId));
    }

    /** 读取单个切面及 mutation。 */
    async getSlice(projectPath: string, sliceId: string): Promise<SliceListItem> {
        return (await this.createModule(projectPath)).service.getSlice(sliceId);
    }

    /** 查询某时刻完整世界状态。 */
    async getWorldState(projectPath: string, at?: bigint): Promise<WorldState> {
        return (await this.createModule(projectPath)).service.getWorldState(at);
    }

    /** 查询收窄后的世界状态。 */
    async queryState(projectPath: string, query: {subjectIds?: string[]; type?: string; attrs?: string[]; at?: bigint; listLimit?: number}): Promise<QueryStateResult> {
        return (await this.createModule(projectPath)).service.queryState(query);
    }

    /** 列出切面。 */
    async listSlices(projectPath: string, query: {from?: bigint; to?: bigint; limit?: number; withMutations?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode} = {}): Promise<SliceListItem[]> {
        return (await this.createModule(projectPath)).service.listSlices(query);
    }

    /** 列出 subject 身份。 */
    async listWorldSubjects(projectPath: string, query: {type?: string} = {}): Promise<WorldSubjectListItem[]> {
        return (await this.createModule(projectPath)).service.listWorldSubjects(query);
    }

    /** 返回 Agent 友好的 world schema 投影。 */
    async getWorldSchema(projectPath: string): Promise<WorldSchemaProjection> {
        return (await this.createModule(projectPath)).service.getWorldSchema();
    }

    /** 解析项目日历字符串。 */
    async parseTime(projectPath: string, input: string): Promise<bigint> {
        const calendar = await this.calendarLoader.load(normalizeProjectPath(projectPath));
        return calendar.parse(input);
    }

    /** 格式化项目时间。 */
    async formatTime(projectPath: string, instant: bigint): Promise<string> {
        const calendar = await this.calendarLoader.load(normalizeProjectPath(projectPath));
        return calendar.format(instant);
    }

    private async runInTransaction<TResult>(projectPath: string, callback: (module: WorldEngineModule) => Promise<TResult>): Promise<TResult> {
        const prisma = await this.client(projectPath);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
            return callback(await this.createModuleFromExecutor(transactionClient, normalizedProjectPath));
        });
    }

    private async createModule(projectPath: string): Promise<WorldEngineModule> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return this.createModuleFromExecutor(await this.client(normalizedProjectPath), normalizedProjectPath);
    }

    private async client(projectPath: string): Promise<PrismaClient> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        await initProjectDatabase(normalizedProjectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        const cacheKey = databasePath.replace(/\\/g, "/");
        const existing = this.clients.get(cacheKey);
        if (existing) {
            return existing;
        }
        const client = new PrismaClient({
            adapter: new PrismaLibSql({url: toSqliteFileUrl(databasePath)}),
        });
        this.clients.set(cacheKey, client);
        return client;
    }

    private async createModuleFromExecutor(executor: WorldPrismaExecutor, projectPath: string): Promise<WorldEngineModule> {
        const schema = await this.schemaLoader.load(projectPath);
        const calendar = await this.calendarLoader.load(projectPath);
        return {
            service: new WorldEngineService(new WorldEngineRepository(executor), schema, calendar),
        };
    }
}
