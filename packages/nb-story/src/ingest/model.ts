/**
 * 抽取的模型调用（docs/specs/story/ingest.md 输出 9）：OpenAI 兼容服务、流式、推理档与 JSON 输出原样发送，渠道失败
 * 按固定的延迟表重发。
 *
 * 用 `openai` SDK 而不是问答用的 nb-harness：SDK 设 `maxRetries: 0` 后一次调用就是一次 HTTP 请求，推理档原样发送；
 * nb-harness 底下的 OMP 在一次调用里自带最多 6 次重试，端点拒绝 `minimal` 时还会自动降成 `low` 重发，两样都关不掉，
 * 与“只一层重试”的合同冲突（w00024 t06 计划审查第 4、5 条的实测）。降档这一样后来改成自己做（#257）：只在网关的
 * 400 明确列出合法档位时改发一次，规则与 OMP 相同、可见、不占重试表，见 `nearestEffort`。错误归类沿用 nb-harness 的口径
 * （docs/specs/agent/harness.md），密钥的遮盖记号与它的 `REDACTED_KEY` 相同。不导入 nb-harness：它的入口会加载
 * 整个 OMP，抽取线程用不到。
 *
 * 这一层只管渠道：一次逻辑请求的重发、流的中止、用量与取出 JSON 对象。回复成不成形（缺本章、没有段落块）由
 * 调用方按各步自己的形状判断。
 */

import OpenAI from "openai";

/** 抽取的固定推理档：写时间点和段落块用最低档，其余步骤用中档。 */
export type IngestEffort = "minimal" | "medium";

export type ErrorKind = "network" | "rate_limit" | "auth" | "quota" | "context_overflow" | "provider" | "local";

export interface ModelEndpoint {
    baseUrl: string;
    model: string;
    /** 密钥：调用时才从环境变量读出；没有设置时为空串（以 `auth` 失败，不发请求）。 */
    apiKey: string;
    /** 一次回复的输出上限（token）。 */
    maxTokens: number;
    /** 存密钥的环境变量名，只用来在缺密钥时写进错误信息。 */
    apiKeyEnv?: string;
}

/** 一次 HTTP 尝试的用量。拿不到（中止、流中断、跑飞）时 `complete` 为 false，数值是已知的下界。 */
export interface AttemptUsage {
    input: number;
    output: number;
    cacheRead: number;
    complete: boolean;
}

export interface Attempt {
    /** 同一逻辑请求里的第几次 HTTP 尝试，从 1 起。 */
    attempt: number;
    ms: number;
    usage: AttemptUsage;
    /** 这次失败的原因；成功为 null。 */
    error: ModelError | null;
}

export class ModelError extends Error {
    readonly kind: ErrorKind;
    readonly status: number | null;
    /** 服务用 `Retry-After` 要求的等待（毫秒，已限在 `MAX_RETRY_AFTER_MS` 内）；没给或格式不认识为 null。 */
    readonly retryAfterMs: number | null;

    constructor(kind: ErrorKind, status: number | null, message: string, retryAfterMs: number | null = null) {
        super(message);
        this.name = "ModelError";
        this.kind = kind;
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

/** 调用方中止（停止抽取）。 */
export class ModelAborted extends Error {
    constructor() {
        super("模型请求被中止");
        this.name = "ModelAborted";
    }
}

export interface ModelReply {
    text: string;
    /** 服务给的结束原因（`stop`、`length` 等）。 */
    finishReason: string | null;
    /** 从回复里取出的 JSON 对象（第一个“{”到最后一个“}”）；取不出或解析失败为 null。 */
    json: unknown;
    /** 网关不支持请求的推理档、改发了别的档时，实际发的那一档；没改过不写。 */
    effortUsed?: string;
}

export interface CallOptions {
    system: string;
    user: string;
    effort: IngestEffort;
    signal?: AbortSignal;
    /**
     * 每次 HTTP 尝试发出之前调用，等它完成才发请求：进程在这次尝试中途被杀时，账上一定已经留下“发出过、用量不知道”。
     * 它失败时请求不发，错误原样抛给调用方。
     */
    onAttemptStart?: (attempt: number) => void | Promise<void>;
    /** 每次 HTTP 尝试结束时调用（成功或失败），用来记账。 */
    onAttempt?: (attempt: Attempt) => void;
    /** 至多几次 HTTP 尝试，默认按重发的延迟表（网络类 6 次、限流 12 次）。`config test --ingest` 只试一次。 */
    maxAttempts?: number;
    /** 替换延迟表；测试把分钟级的等待缩成毫秒，产品里不传。 */
    delaysMs?: {network?: readonly number[]; rateLimit?: readonly number[]};
    /** 这次调用的身份（写进请求头 `X-Nbstory-Step`），渠道重发时不变。 */
    tag?: string;
    /** 一次 HTTP 尝试的时限；默认 10 分钟。 */
    timeoutMs?: number;
    /** 决定重发、开始等待时调用。 */
    onRetry?: (info: {attempt: number; waitMs: number; error: ModelError}) => void;
    /** 等待；测试注入，默认真的等。被中止时 reject。 */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** 替换 HTTP（测试用本机端点时不需要）。 */
    fetch?: typeof fetch;
}

/** 渠道失败后的等待（毫秒）：第 n 次重发前等第 n 项。表的长度就是重发次数，连同第一次合计至多 6 次。 */
export const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 180_000, 300_000];

/**
 * 限流（429）后的等待：1、2、5、10、15、20 分钟，之后每次 30 分钟，连同第一次合计至多 12 次，等待合计 203 分钟。
 * 限流一般是渠道的额度窗口，几分钟的间隔不够（2026-10-24 西游记抽取里 429 持续了二十多分钟）。
 */
export const RATE_LIMIT_DELAYS_MS = [60_000, 120_000, 300_000, 600_000, 900_000, 1_200_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000];

/** `Retry-After` 采用的上限：服务要求更久时也只等这么久，之后再试一次看看。 */
export const MAX_RETRY_AFTER_MS = 1_800_000;

/** 连续这么多个空白字符，判定为“跑飞”：模型写坏一段 JSON 后只输出空白，直到输出上限。 */
export const RUNAWAY_WHITESPACE = 2000;

/** 一次 HTTP 尝试（含读完整个流）的时限。 */
const ATTEMPT_TIMEOUT_MS = 600_000;
/** 请求头里写这次调用的身份（章、步骤、轮次）：渠道重发时不变。只是诊断信息，服务可以忽略；回放端点按它认请求。 */
export const STEP_HEADER = "X-Nbstory-Step";
/** 错误文字里回显的密钥换成它（与 nb-harness 的 `REDACTED_KEY` 相同）。 */
const REDACTED_KEY = "[REDACTED]";
/** 服务明确拒绝、没有受理请求的状态码（用量确定为 0）。413 是网关嫌请求太大，请求没有到模型。 */
const REJECTED_UNPROCESSED = new Set([401, 403, 413, 429]);

/** 推理档里“启用推理”的几档，由低到高；`none` 是关闭推理，不在其中。 */
const ENABLED_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const KNOWN_EFFORTS = new Set<string>(["none", ...ENABLED_EFFORTS]);

/**
 * 网关拒绝推理档时正文里列出的合法档位（"Supported values are: 'none', 'low', …"）。不是这种拒绝、或没列出档位时为
 * null。请求发的那一档本来就在列表里时也是 null：那是别的原因的 400。
 */
export function supportedEfforts(message: string, requested: string): readonly string[] | null {
    const listed = /\bsupported values?\b([^]*)/iu.exec(message)?.[1];
    // 被拒绝的得是推理档：正文写着 reasoning_effort，或点名了我们发的那一档（'minimal'）。别的参数的 400 也会列“合法值”。
    const aboutEffort = /reasoning[_ ]effort/iu.test(message) || new RegExp(`['"\`]${requested}['"\`]`, "iu").test(message);
    if (listed === undefined || !aboutEffort) return null;
    const values = [...new Set([...listed.matchAll(/\b(none|minimal|low|medium|high|xhigh|max)\b/giu)].map(match => match[1]!.toLowerCase()))];
    return values.length === 0 || values.includes(requested) ? null : values;
}

/**
 * 在网关接受的档位里挑最接近的启用档。规则照 OMP（pi-ai 的 openai-reasoning-fallback，未导出）：只在启用档里选，
 * `none` 永远不选（关闭推理会让原来要推理的步骤静默变成不推理）；minimal 优先 low，xhigh 优先 max 再 high，max 优先
 * xhigh；其余取距离最近的，平局取更高的。没有启用档可选时为 null。
 */
export function nearestEffort(requested: string, allowed: readonly string[]): string | null {
    const enabled = ENABLED_EFFORTS.filter(value => allowed.includes(value));
    if (enabled.length === 0) return null;
    const prefer: Record<string, readonly string[]> = {minimal: ["low"], xhigh: ["max", "high"], max: ["xhigh"]};
    const preferred = prefer[requested]?.find(value => enabled.includes(value as (typeof ENABLED_EFFORTS)[number]));
    if (preferred !== undefined) return preferred;
    const rank = (value: string) => ENABLED_EFFORTS.indexOf(value as (typeof ENABLED_EFFORTS)[number]);
    const at = rank(requested);
    if (at < 0) return null;
    return [...enabled].sort((a, b) => Math.abs(rank(a) - at) - Math.abs(rank(b) - at) || rank(b) - rank(a))[0] ?? null;
}

/**
 * 这个进程里已经知道的“请求的档位 → 网关接受的档位”，按地址、模型与请求的档位记：之后的请求直接用，不再先吃一个
 * 400。Worker 是独立进程，各自吃一次。
 */
const effortFallbacks = new Map<string, string>();
const fallbackKey = (endpoint: ModelEndpoint, requested: string) => `${endpoint.baseUrl}\u0000${endpoint.model}\u0000${requested}`;
const NETWORK_STATUSES = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524]);

/** 等 `ms` 毫秒；被中止时 reject `ModelAborted`。 */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ModelAborted());
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new ModelAborted());
        };
        signal?.addEventListener("abort", onAbort, {once: true});
    });
}

const redactKey = (text: string, apiKey: string) => (apiKey === "" ? text : text.split(apiKey).join(REDACTED_KEY));

/**
 * 给 SDK 的日志：每一项都先遮盖密钥再写到标准错误。SDK 解析坏的流数据时会把原始数据打进日志，早于本层归类错误时的
 * 遮盖（实现审查第 6 条）。
 */
function redactingLogger(apiKey: string) {
    const write = (level: string) => (...args: unknown[]) => {
        const text = args.map(arg => (typeof arg === "string" ? arg : arg instanceof Error ? arg.message : JSON.stringify(arg))).join(" ");
        console.error(`[openai ${level}] ${redactKey(text, apiKey)}`);
    };
    return {error: write("error"), warn: write("warn"), info: write("info"), debug: write("debug")};
}

/** 把服务的错误归成 Spec 的 `kind`（与 nb-harness 的归类同口径）；错误文字里回显的密钥遮盖掉。 */
function classify(error: unknown, apiKey: string): ModelError {
    const redact = (text: string) => redactKey(text, apiKey);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return new ModelError("network", null, "请求超时");
    if (error instanceof OpenAI.APIConnectionError) return new ModelError("network", null, redact(`连接失败：${error.message}`));
    if (error instanceof OpenAI.APIError) {
        const status = typeof error.status === "number" ? error.status : null;
        // 没有状态码：请求已经成功、错误是流到一半服务发来的错误事件（例如 luna 渠道的 upstream_error）。这是渠道侧
        // 的临时故障，按网络失败重发（与 nb-harness 把没有状态码的临时错误归为 network 同口径）。
        if (status === null) return new ModelError("network", null, redact(error.message));
        const code = typeof error.code === "string" ? error.code : "";
        const message = redact(error.message);
        if (status === 401 || status === 403) return new ModelError("auth", status, message);
        if (status === 402 || code === "insufficient_quota") return new ModelError("quota", status, message);
        if (status === 429) return new ModelError("rate_limit", status, message, retryAfterOf(error.headers));
        if (code === "context_length_exceeded") return new ModelError("context_overflow", status, message);
        // 网关嫌请求太大（docs/specs/story/ingest.md F4）。抽取的请求随书变长，长书后面的章会撞上网关的上限；拆成几条消息
        // 也没用，w00024 t36 实测这个上限是按整个请求算的。只能换网关，所以说明里直接告诉用户。
        if (status === 413) return new ModelError("provider", status, `网关拒绝了这次请求：请求太大（413）。网关对单次请求的大小有上限，书越往后请求越大；换一个上限更大的网关（nbstory config set ingest.model …）后再接着抽。网关的原话：${message}`);
        if (status !== null && (NETWORK_STATUSES.has(status) || status >= 500)) return new ModelError("network", status, message);
        return new ModelError("provider", status, message);
    }
    return new ModelError("local", null, redact(error instanceof Error ? error.message : String(error)));
}

/**
 * `Retry-After` 取秒数（HTTP 日期、空串、负数、非数字都不认，走延迟表），换成毫秒并限在 `MAX_RETRY_AFTER_MS` 内。
 * SDK 的 `APIError.headers` 是标准 `Headers`，不能按下标读。
 */
function retryAfterOf(headers: Headers | undefined): number | null {
    const value = headers?.get("retry-after")?.trim();
    if (value === undefined || !/^\d+(\.\d+)?$/u.test(value)) return null;
    return Math.min(Math.round(Number(value) * 1000), MAX_RETRY_AFTER_MS);
}

/** 渠道这边的失败（超时、断线、5xx、跑飞、流没有结束原因）与限流重发；认证、额度、模型拒绝请求（含推理档）不重发。 */
const retryable = (error: ModelError) => error.kind === "network" || error.kind === "rate_limit";

/** 取出回复里的 JSON 对象。模型偶尔在 JSON 前后多写几个字，取第一个“{”到最后一个“}”。 */
function parseJsonObject(text: string): unknown {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
        // 解析失败是回复不成形，由调用方决定重发；这里只报告“取不出”。
        return null;
    }
}

/** 一次逻辑请求：按延迟表重发渠道失败，返回最终的回复；不可重试或重试用完时抛 `ModelError`，被中止时抛 `ModelAborted`。 */
export async function callModel(endpoint: ModelEndpoint, options: CallOptions): Promise<ModelReply> {
    if (endpoint.apiKey === "") throw new ModelError("auth", null, `模型的密钥环境变量${endpoint.apiKeyEnv === undefined ? "" : ` ${endpoint.apiKeyEnv} `}没有设置（nbstory 只认启动时的环境变量，不读家目录的 .env）`);
    const client = new OpenAI({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseUrl,
        maxRetries: 0,
        timeout: ATTEMPT_TIMEOUT_MS,
        logger: redactingLogger(endpoint.apiKey),
        ...(options.fetch ? {fetch: options.fetch} : {}),
    });
    const sleep = options.sleep ?? defaultSleep;
    // 两类失败各按自己的表计数：先断了几次线、后来被限流，限流的等待从表头开始。
    const failures = {network: 0, rate_limit: 0};
    let effort: string = effortFallbacks.get(fallbackKey(endpoint, options.effort)) ?? options.effort;
    // 一次逻辑调用最多改发一次：改发之后网关仍拒绝，就按它的 400 失败，不在几个档位之间来回改。
    let clampedOnce = false;
    for (let attempt = 1; ; attempt++) {
        if (options.signal?.aborted) throw new ModelAborted();
        const outcome = await attemptOnce(client, endpoint, options, attempt, effort);
        if (outcome.ok) {
            // 缓存只记成功了的映射。
            if (clampedOnce) effortFallbacks.set(fallbackKey(endpoint, options.effort), effort);
            return effort === options.effort ? outcome.reply : {...outcome.reply, effortUsed: effort};
        }
        if (options.signal?.aborted) throw new ModelAborted();
        const {error} = outcome;
        // 网关不认请求的推理档（严格转发参数的端点）：改发它列出的最近的启用档，立即重发一次。这不是渠道故障，不进延迟表，
        // 也不受 maxAttempts 限制（`config test --ingest` 只试一次，也要能通过）。
        const allowed = !clampedOnce && error.kind === "provider" && error.status === 400 ? supportedEfforts(error.message, effort) : null;
        const clamped = allowed === null ? null : nearestEffort(effort, allowed);
        if (clamped !== null && clamped !== effort) {
            clampedOnce = true;
            effort = clamped;
            continue;
        }
        if (!retryable(error) || attempt >= (options.maxAttempts ?? Infinity)) throw error;
        const kind = error.kind as "network" | "rate_limit";
        const table = kind === "rate_limit" ? (options.delaysMs?.rateLimit ?? RATE_LIMIT_DELAYS_MS) : (options.delaysMs?.network ?? RETRY_DELAYS_MS);
        const scheduled = table[failures[kind]++];
        if (scheduled === undefined) throw error;
        const waitMs = error.retryAfterMs ?? scheduled;
        options.onRetry?.({attempt, waitMs, error: outcome.error});
        await sleep(waitMs, options.signal);
    }
}

type AttemptOutcome = {ok: true; reply: ModelReply} | {ok: false; error: ModelError};

/**
 * 一次 HTTP 尝试。流为什么停下决定结果，按这个先后判断：用户停止 → 跑飞 → 超时 → 出错 → 没有结束原因 → 正常结束。
 * SDK 遇到中止时有时让迭代正常结束、不抛错（计划审查后的实现审查第 7 条），所以不能只在 catch 里认停止，要看
 * 中止是谁发起的。
 */
async function attemptOnce(client: OpenAI, endpoint: ModelEndpoint, options: CallOptions, attempt: number, effort: string): Promise<AttemptOutcome> {
    await options.onAttemptStart?.(attempt);
    const started = Date.now();
    const controller = new AbortController();
    let abortedBy: "stop" | "runaway" | "timeout" | null = null;
    const abort = (why: "stop" | "runaway" | "timeout") => {
        abortedBy ??= why;
        controller.abort();
    };
    const onStop = () => abort("stop");
    options.signal?.addEventListener("abort", onStop, {once: true});
    // SDK 的 timeout 只管到收到响应头为止，流开始之后就没有计时了；这里的计时覆盖整个流。
    const timer = setTimeout(() => abort("timeout"), options.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
    const usage: AttemptUsage = {input: 0, output: 0, cacheRead: 0, complete: false};
    const record = (error: ModelError | null) => options.onAttempt?.({attempt, ms: Date.now() - started, usage, error});
    let text = "";
    let finishReason: string | null = null;
    let trailingWhitespace = 0;
    /** 收到响应头、开始读流了：之后出的不是 API 错误的异常，都是读流时连接出了事。 */
    let streaming = false;
    let failure: unknown = null;
    try {
        if (options.signal?.aborted) abort("stop");
        const stream = await client.chat.completions.create(
            {
                model: endpoint.model,
                messages: [{role: "system", content: options.system}, {role: "user", content: options.user}],
                max_tokens: endpoint.maxTokens,
                stream: true,
                stream_options: {include_usage: true},
                reasoning_effort: effort as OpenAI.ReasoningEffort,
                response_format: {type: "json_object"},
            },
            {signal: controller.signal, ...(options.tag ? {headers: {[STEP_HEADER]: options.tag}} : {})},
        );
        streaming = true;
        for await (const chunk of stream) {
            if (chunk.usage) {
                usage.input = chunk.usage.prompt_tokens;
                usage.output = chunk.usage.completion_tokens;
                usage.cacheRead = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
                usage.complete = true;
            }
            const choice = chunk.choices[0];
            const delta = choice?.delta?.content ?? "";
            if (delta) {
                text += delta;
                const tail = delta.length - delta.trimEnd().length;
                trailingWhitespace = tail === delta.length ? trailingWhitespace + tail : tail;
                if (trailingWhitespace >= RUNAWAY_WHITESPACE) {
                    // 中止并离开循环会取消响应体，服务才不会一直输出到上限。
                    abort("runaway");
                    break;
                }
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
    } catch (error) {
        failure = error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onStop);
    }

    const fail = (error: ModelError): AttemptOutcome => {
        usage.complete = false;
        record(error);
        return {ok: false, error};
    };
    if (abortedBy === "stop") {
        usage.complete = false;
        record(new ModelError("local", null, "被中止"));
        throw new ModelAborted();
    }
    if (abortedBy === "runaway") return fail(new ModelError("network", null, `模型跑飞：写了 ${text.length - trailingWhitespace} 个字之后只输出空白`));
    if (abortedBy === "timeout") return fail(new ModelError("network", null, `一次请求超过 ${Math.round((options.timeoutMs ?? ATTEMPT_TIMEOUT_MS) / 1000)} 秒没有结束`));
    if (failure !== null) {
        // 读流时连接断了（Bun 直接从响应体抛出，SDK 不包装）：按网络失败重发，不看错误文字。
        if (streaming && !(failure instanceof OpenAI.APIError)) return fail(new ModelError("network", null, redactKey(`读回复的流时连接断了：${failure instanceof Error ? failure.message : String(failure)}`, endpoint.apiKey)));
        const error = classify(failure, endpoint.apiKey);
        // 服务在读请求之前就明确拒绝（401、403 认证失败，429 限流）：请求没有被受理，用量确定是 0，不让汇总标成不完整。
        // 5xx、408、网关故障不算：网关报错时上游可能已经生成并计费，状态码证明不了没花钱。
        if (!streaming && error.status !== null && (REJECTED_UNPROCESSED.has(error.status) || (error.status === 400 && supportedEfforts(error.message, effort) !== null))) {
            usage.complete = true;
            record(error);
            return {ok: false, error};
        }
        return fail(error);
    }
    if (finishReason === null) return fail(new ModelError("network", null, "回复的流没有结束原因就断了"));
    record(null);
    return {ok: true, reply: {text, finishReason, json: parseJsonObject(text)}};
}
