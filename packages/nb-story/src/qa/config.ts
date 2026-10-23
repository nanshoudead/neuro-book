/**
 * 问答与抽取共用的配置文件（docs/specs/story/qa.md 的“配置”、docs/specs/story/ingest.md 的“抽取模型”）。密钥本身
 * 不在这里，只写存密钥的环境变量名。
 *
 * 这里不导入 nb-harness：它一被导入，OMP 就接管中断信号（`nbstory ingest` 要自己处理 Ctrl-C）。配置到 nb-harness
 * 模型的转换在 harness-model.ts。
 */

import {createHash, randomBytes} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {basename, dirname, join} from "node:path";

import type {Static} from "typebox";
import {Compile} from "typebox/compile";

import {tryLock} from "../platform/flock";
import {ConfigSchema, type IngestModelSchema, type PriceSchema, type QaConfig} from "./config-schema";
import {QaError} from "./errors";

export type {QaConfig} from "./config-schema";

/** 图当目录一问最多读的不同章数（开发者定的上限，配置只能调小）。 */
export const MAX_CHAPTERS = 20;
export const DEFAULT_FULL_READ_MAX_CHARS = 300_000;

const checkConfig = Compile(ConfigSchema);

/** 配置文件的默认位置：`$XDG_CONFIG_HOME/nbstory/config.json`，未设置时 `~/.config/nbstory/config.json`。 */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nbstory", "config.json");
}

/** 按配置的 schema 校验；不对时报 `qa_unconfigured`，写明是哪个字段（最多三处）。`source` 说明这份配置从哪来。 */
export function parseQaConfig(value: unknown, source: string): QaConfig {
    if (!checkConfig.Check(value)) {
        const problems = [...checkConfig.Errors(value)].slice(0, 3).map(item => `${item.instancePath || "/"} ${item.message}`);
        throw new QaError("qa_unconfigured", `问答配置${source}不对：${problems.join("；")}`);
    }
    return value;
}

/** 配置文件内容的摘要：写入时比对用（`config.set` 的 `expect`）。文件不在时是 `absent`。 */
export type ConfigDigest = string;
export const ABSENT_CONFIG: ConfigDigest = "absent";

const digestOf = (text: string): ConfigDigest => createHash("sha256").update(text).digest("hex");

async function readConfigText(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new QaError("qa_unconfigured", `读不到问答配置 ${path}`, {cause: error});
    }
}

function parseConfigText(path: string, text: string): QaConfig {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new QaError("qa_unconfigured", `问答配置 ${path} 不是 JSON`, {cause: error});
    }
    return parseQaConfig(value, ` ${path} `);
}

/** 读并校验配置；文件不在、不是 JSON 或字段不对都报 `qa_unconfigured`，写明是哪个字段。 */
export async function loadQaConfig(path: string = defaultConfigPath()): Promise<QaConfig> {
    return (await readQaConfigFile(path)).config;
}

/** 读配置连同它此刻的摘要（之后改写时带上，见 `saveQaConfig` 的 `expect`）。 */
export async function readQaConfigFile(path: string = defaultConfigPath()): Promise<{config: QaConfig; digest: ConfigDigest}> {
    const text = await readConfigText(path);
    if (text === null) throw new QaError("qa_unconfigured", `读不到问答配置 ${path}：先用 nbstory config init 写好它（字段见 docs/specs/story/qa.md 的“配置”）`);
    return {config: parseConfigText(path, text), digest: digestOf(text)};
}

/** 配置文件此刻的摘要，读不成也给（文件不在是 `absent`）：网页在配置坏了时也要能整份改写。 */
export async function currentConfigDigest(path: string): Promise<ConfigDigest> {
    const text = await readConfigText(path).catch(() => null);
    return text === null ? ABSENT_CONFIG : digestOf(text);
}

/** 等别的程序写完配置最多这么久；写一次配置是毫秒级的，等满了多半是有进程卡在写的中途。 */
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 50;

/**
 * 程序对配置的写入（命令行的 init、set、unset，网页的设置页）都在这把跨进程锁里做：锁内重读、比对、校验、写临时
 * 文件、改名，几个写入不会交错，比对与发布之间也不会插进别人的写入。锁是同目录的 `.lock` 文件上的 flock，持有的进程
 * 退出（含崩溃）时系统自动放掉。手改文件不走锁，只能靠摘要尽力发现。
 */
async function withConfigLock<T>(path: string, run: () => Promise<T>): Promise<T> {
    try {
        await mkdir(dirname(path), {recursive: true});
    } catch (error) {
        throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
    // 锁文件与配置同目录、以点开头：它常驻（删掉正被别人锁着的文件会让两个进程各锁一份），不是临时文件。
    const lockPath = join(dirname(path), `.${basename(path)}.lock`);
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        let lock: ReturnType<typeof tryLock>;
        try {
            lock = tryLock(lockPath);
        } catch (error) {
            throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
        }
        if (lock !== null) {
            try {
                return await run();
            } finally {
                lock.release();
            }
        }
        if (Date.now() >= deadline) throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：另一个程序正在写它，等了 ${LOCK_WAIT_MS / 1000} 秒还没写完`);
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
    }
}

/**
 * 校验后写盘，返回写下的配置与它的摘要。先写同目录的临时文件（每次随机命名：服务进程里几个请求可能同时写）再改名，
 * 读者（正在跑的 `ask`）要么读到旧的整份，要么读到新的整份；校验不过或写失败时原文件不动。给了 `expect` 时，锁内重读
 * 的摘要与它不同就报 `config_conflict`（别处改过了）。密钥不在配置里（只有环境变量名），所以文件用普通权限。
 */
export async function saveQaConfig(path: string, config: unknown, options: {expect?: ConfigDigest} = {}): Promise<{config: QaConfig; digest: ConfigDigest}> {
    const valid = parseQaConfig(config, ` ${path} `);
    return withConfigLock(path, async () => {
        if (options.expect !== undefined) {
            const current = await currentConfigDigest(path);
            if (current !== options.expect) throw new QaError("config_conflict", `问答配置 ${path} 在你读取之后被别处改过了：重新读取再改`);
        }
        const text = `${JSON.stringify(valid, null, 4)}\n`;
        const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
        const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
        const failed = (error: unknown, note = ""): QaError => new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${reason(error)}${note}`, {cause: error});
        let created = false;
        try {
            await writeFile(temporary, text);
            created = true;
            await rename(temporary, path);
        } catch (error) {
            // 原文件没动过。临时文件写出来了就清理；清理也失败时照样报写失败，不让清理的错误盖掉它，留下的临时文件写进说明。
            const leftover = created ? await rm(temporary, {force: true}).then(() => null, (cleanup: unknown) => cleanup) : null;
            throw failed(error, leftover === null ? "" : `；临时文件 ${temporary} 没能删掉：${reason(leftover)}`);
        }
        return {config: valid, digest: digestOf(text)};
    });
}

export function qaLimits(config: QaConfig): {maxChapters: number; fullReadMaxChars: number} {
    return {maxChapters: config.qa?.maxChapters ?? MAX_CHAPTERS, fullReadMaxChars: config.qa?.fullReadMaxChars ?? DEFAULT_FULL_READ_MAX_CHARS};
}

/** 抽取一次请求的输出上限，配置里没写 `maxTokens` 时用（与抽取管线定型时相同）。 */
export const DEFAULT_INGEST_MAX_TOKENS = 32_000;

export interface IngestModel {
    baseUrl: string;
    id: string;
    apiKeyEnv: string;
    maxTokens: number;
    price: Static<typeof PriceSchema> | null;
    /** 取自哪一节：`ingest.model`，或没有它时的问答 `model`。 */
    source: "ingest.model" | "model";
}

/** 挑选相关说法用的模型；多一种来源 `ingest.recall.model`。 */
export type RecallModel = Omit<IngestModel, "source"> & {source: IngestModel["source"] | "ingest.recall.model"};

/** 抽取用的模型：`ingest.model`，没有时用问答的 `model`（其中的 `thinking` 不用）。 */
export function ingestModel(config: QaConfig): IngestModel {
    const own = config.ingest?.model;
    return {...asModel(own ?? config.model), source: own ? "ingest.model" : "model"};
}

/** 挑选相关说法用的模型；没开（默认）时为 null。整节继承：`ingest.recall.model`，没有时用抽取的模型。 */
export function recallModel(config: QaConfig): RecallModel | null {
    const recall = config.ingest?.recall;
    if (recall?.enabled !== true) return null;
    return recall.model ? {...asModel(recall.model), source: "ingest.recall.model"} : ingestModel(config);
}

function asModel(model: Static<typeof IngestModelSchema> | QaConfig["model"]): Omit<IngestModel, "source"> {
    return {baseUrl: model.baseUrl, id: model.id, apiKeyEnv: model.apiKeyEnv, maxTokens: model.maxTokens ?? DEFAULT_INGEST_MAX_TOKENS, price: model.price ?? null};
}
