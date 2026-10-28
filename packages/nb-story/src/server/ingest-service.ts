/**
 * 独立服务里的抽取（docs/specs/story/ingest.md 的“网页”、输出 11、12 与“状态与转换”）：`ingest.*` 方法、本服务运行
 * 的任务表，以及服务停止时的收口。
 *
 * 删除一本书时书库的协调者经 `stopLocal` 先停这里这个 id 的任务：正在启动的先等它拿到任务（启动期间它已持锁，
 * 不能当成别的进程在抽），再停、等放锁（实现审查 S5 第 5 条）。
 *
 * 停止服务的顺序（计划审查第 7 条）：`close()` 先同步关上接纳的门，之后的 `ingest.start` 得到 `ingest_running`；
 * 再等已经接纳、还在启动中的发起结束（它们拿到的任务一启动就停掉），停下表里全部任务，等它们放锁。调用方在这之后
 * 才撤销服务登记、停监听。
 */

import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {schemaProblems} from "../core/api";
import {StoryError, type StoryErrorCode} from "../core/errors";
import {bookIdFromTitle, type Library} from "../core/library";
import {INGEST_METHODS, type IngestMethod, type ViewerParams, type ViewerResult} from "../contract/contract";
import type {Runner} from "../ingest/runner";
import {modelChoice, startIngest} from "../ingest/runner";
import {planFromText, type IngestPlan} from "../ingest/start";
import {ingestStatus, ingestStatuses} from "../ingest/status";
import {decodeUtf8, MAX_SOURCE_BYTES} from "../ingest/text";
import {ingestModel, loadQaConfig, personaCheckEnabled, recallModel, type QaConfig} from "../qa/config";
import {QaError, type QaErrorCode} from "../qa/errors";
import {AGENT_SKILL_DIRS, installSkill, SKILL_SOURCE, SkillInstallError, skillTarget, type SkillErrorCode} from "../cli/skill";

export type IngestOutcome<M extends IngestMethod> = {ok: true; value: ViewerResult<M>} | {ok: false; error: {code: StoryErrorCode | QaErrorCode | SkillErrorCode; message: string}};

export interface IngestService {
    call<M extends IngestMethod>(method: M, params: unknown): Promise<IngestOutcome<M>>;
    /** 停下这个 id 在本服务里的任务（含正在启动的）并等它放锁；没有就什么也不做。 */
    stopLocal(id: string): Promise<void>;
    /** 关门、停下本服务的全部任务并等它们放锁；可以多次调用。 */
    close(): Promise<void>;
}

/** base64 只用这些字符，长度是 4 的倍数。 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

/** base64 文本解码后的字节数（扣掉末尾填充）；调用方已确认长度是 4 的倍数。 */
export function base64Bytes(content: string): number {
    return (content.length / 4) * 3 - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
}

/** 网页提交的原文：base64 解码，再按与命令行相同的规则检查大小与编码。 */
function decodeContent(content: string): string {
    if (content.length % 4 !== 0 || !BASE64.test(content)) throw new StoryError("invalid_params", "content 不是 base64");
    // 解码前就能算出字节数：超过上限的不解码。
    const bytes = base64Bytes(content);
    if (bytes > MAX_SOURCE_BYTES) throw new StoryError("ingest_bad_text", `原文文件有 ${(bytes / 1024 / 1024).toFixed(1)} MiB，超过 32 MiB 的上限`);
    return decodeUtf8(Buffer.from(content, "base64"));
}

function titleOf(params: {title?: string; id?: string}): string {
    const title = params.title ?? params.id;
    if (title === undefined) throw new StoryError("invalid_params", "要给书名（title）或书 id（id）");
    return title;
}

export function createIngestService(options: {library: Library; configPath?: string}): IngestService {
    const {library} = options;
    const runners = new Map<string, Runner>();
    let closing: Promise<void> | null = null;
    /** 已经接纳、还没拿到任务（或失败）的发起，按书 id。 */
    const starting = new Map<string, Promise<unknown>>();

    const loadConfig = (): Promise<QaConfig> => loadQaConfig(...(options.configPath === undefined ? [] : [options.configPath]));

    async function preview(params: ViewerParams<"ingest.preview">): Promise<ViewerResult<"ingest.preview">> {
        const plan = await planFromText(library, {text: decodeContent(params.content), title: titleOf(params), ...(params.id === undefined ? {} : {id: params.id}), ...(params.features === undefined ? {} : {features: params.features})});
        // 预览不要求配置可用：读不出来时只是不写模型，开始时再报 qa_unconfigured。配置读得出来、抽取却没有能用的模型
        // （问答的默认模型不能给抽取用）时写明原因。
        const config = await loadConfig().catch((error: unknown) => {
            if (error instanceof QaError) return null;
            throw error;
        });
        let model: {id: string; source: "ingest.model" | "model"} | null = null;
        let modelProblem: string | null = null;
        if (config !== null) {
            try {
                const {id, source} = ingestModel(config);
                model = {id, source};
            } catch (error) {
                if (!(error instanceof QaError)) throw error;
                modelProblem = error.message;
            }
        }
        const {source: _source, ...rest} = plan;
        return {...rest, model, modelProblem};
    }

    function register(runner: Runner): void {
        runners.set(runner.id, runner);
        void runner.done.then(() => {
            if (runners.get(runner.id) === runner) runners.delete(runner.id);
        });
    }

    async function start(params: ViewerParams<"ingest.start">): Promise<ViewerResult<"ingest.start">> {
        if (closing) throw new StoryError("ingest_running", "服务正在停止，不再接受新的抽取");
        const source = "book" in params ? {id: params.book} : {text: decodeContent(params.content), title: titleOf(params), ...(params.id === undefined ? {} : {id: params.id})};
        const id = source.id ?? bookIdFromTitle("title" in source ? source.title : "");
        if (starting.has(id) || runners.has(id)) throw new StoryError("ingest_running", `书 ${id} 已有抽取任务在运行`);
        const launched = (async () => {
            const config = await loadConfig();
            const recall = recallModel(config);
            return startIngest({
                library,
                ...source,
                ...(params.features === undefined ? {} : {features: params.features}),
                ...modelChoice(ingestModel(config)),
                recall: recall === null ? null : modelChoice(recall),
                personaCheck: personaCheckEnabled(config),
                runner: "serve",
            });
        })();
        starting.set(id, launched);
        let result: {plan: IngestPlan; runner: Runner | null};
        try {
            result = await launched;
        } finally {
            starting.delete(id);
        }
        if (result.runner) {
            register(result.runner);
            // 启动期间服务开始停止：门关上之前接纳的，一拿到就停。
            if (closing) result.runner.stop();
        }
        return {id: result.plan.id, action: result.plan.action};
    }

    async function stop(params: ViewerParams<"ingest.stop">): Promise<ViewerResult<"ingest.stop">> {
        const local = runners.get(params.book);
        if (local) {
            local.stop();
            return {};
        }
        const status = await ingestStatus(library, params.book);
        if (!status) throw new StoryError("book_not_found", `书 ${params.book} 没有抽取记录`);
        // 网页只能停本服务里的任务（ingest.md 的“状态与转换”）。
        if (status.state === "running") throw new StoryError("ingest_running", "这本书正在命令行里抽取，在运行它的终端里按 Ctrl-C 停止");
        return {};
    }

    async function status(params: ViewerParams<"ingest.status">): Promise<ViewerResult<"ingest.status">> {
        if (params.book === undefined) return {books: await ingestStatuses(library)};
        const one = await ingestStatus(library, params.book);
        if (!one) throw new StoryError("book_not_found", `书 ${params.book} 没有抽取记录`);
        return {books: [one]};
    }

    /** V9 记忆图文件：base64 解码（gzip 压缩的先解开），写到临时目录里交给书库导入，导入完删掉临时文件。 */
    async function importGraph(params: ViewerParams<"book.importGraph">): Promise<ViewerResult<"book.importGraph">> {
        if (params.content.length % 4 !== 0 || !BASE64.test(params.content)) throw new StoryError("invalid_params", "content 不是 base64");
        const bytes = base64Bytes(params.content);
        if (bytes > MAX_SOURCE_BYTES) throw new StoryError("ingest_bad_text", `文件超过 32 MiB 的上限`);
        let raw = Buffer.from(params.content, "base64");
        if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
            try {
                raw = gunzipSync(raw, {maxOutputLength: 4 * MAX_SOURCE_BYTES});
            } catch {
                throw new StoryError("invalid_params", "gzip 文件解不开");
            }
        }
        let title = params.title;
        if (title === undefined) {
            try {
                const meta = (JSON.parse(raw.toString("utf8")) as {book?: {title?: unknown}}).book?.title;
                if (typeof meta === "string" && meta !== "") title = meta;
            } catch {
                throw new StoryError("unsupported_format", "文件不是 JSON，不是 V9 记忆图");
            }
        }
        title ??= params.id;
        // 没有书名又没给书名：文件要先是 V9（有 schema 与 book），才值得让用户补书名；否则补了名字也导不进去。
        if (title === undefined) {
            let looksV9 = false;
            try {
                const parsed = JSON.parse(raw.toString("utf8")) as {schema?: unknown; book?: unknown};
                looksV9 = typeof parsed.schema === "string" && typeof parsed.book === "object" && parsed.book !== null;
            } catch {
                looksV9 = false;
            }
            throw new StoryError(looksV9 ? "invalid_params" : "unsupported_format", looksV9 ? "文件里没有书名，请给书名（title）或书 id（id）" : "文件不是 V9 记忆图");
        }
        const dir = await mkdtemp(join(tmpdir(), "nbstory-import-"));
        try {
            const file = join(dir, "graph.json");
            await writeFile(file, raw);
            const imported = await library.importBook({file, title, ...(params.id === undefined ? {} : {id: params.id})});
            return {id: imported.id};
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    }

    async function installSkillFor(params: ViewerParams<"skill.install">): Promise<ViewerResult<"skill.install">> {
        // 只认固定的两个位置：网页不能指定目录（命令行的 --dir 不给网页）。
        if (!Object.hasOwn(AGENT_SKILL_DIRS, params.agent)) throw new StoryError("invalid_params", `agent 只能是 ${Object.keys(AGENT_SKILL_DIRS).join("、")}`);
        const target = skillTarget({agent: params.agent});
        const result = await installSkill(SKILL_SOURCE, target, params.force === true);
        return {state: result.state, path: target, ...(result.leftover === undefined ? {} : {leftover: result.leftover})};
    }

    const handlers: {[M in IngestMethod]: (params: ViewerParams<M>) => Promise<ViewerResult<M>>} = {
        "book.importGraph": importGraph,
        "skill.install": installSkillFor,
        "ingest.preview": preview,
        "ingest.start": start,
        "ingest.stop": stop,
        "ingest.status": status,
    };

    return {
        async call(method, params) {
            try {
                const spec = INGEST_METHODS[method];
                const invalid = schemaProblems(spec.input, params);
                if (invalid) throw new StoryError("invalid_params", `参数不符合 ${method} 的 schema：${invalid}`);
                const value = await (handlers[method] as (params: unknown) => Promise<unknown>)(params);
                const broken = schemaProblems(spec.output, value);
                if (broken) throw new Error(`${method} 的结果不符合合同：${broken}`);
                return {ok: true, value: value as ViewerResult<typeof method>};
            } catch (error) {
                if (error instanceof StoryError || error instanceof QaError || error instanceof SkillInstallError) return {ok: false, error: {code: error.code, message: error.message}};
                throw error;
            }
        },
        async stopLocal(id) {
            const pending = starting.get(id);
            // 启动失败由发起它的请求报给它的调用方；这里只等它结束，结束了就没有要停的。
            if (pending) await pending.catch(() => undefined);
            const runner = runners.get(id);
            if (!runner) return;
            runner.stop();
            await runner.done;
        },
        close() {
            closing ??= (async () => {
                await Promise.allSettled([...starting.values()]);
                const all = [...runners.values()];
                for (const runner of all) runner.stop();
                await Promise.all(all.map(runner => runner.done));
            })();
            return closing;
        },
    };
}

export function isIngestMethod(method: string): method is IngestMethod {
    return Object.hasOwn(INGEST_METHODS, method);
}
