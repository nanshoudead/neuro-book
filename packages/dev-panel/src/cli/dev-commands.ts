import {NbdevError} from "../core/errors.js";
import {resolveTaskTarget} from "../core/lease-ops.js";
import {locateRepository} from "../core/repo.js";
import {AS_OPTION, shortSession, stringValue, writeCaller, type CommandSpec, type Values} from "./common.js";
import type {CheckoutSearchDone, SearchHit} from "../core/search.js";
import type {DevEvent} from "../dev/dev-ops.js";
import type {CommandOutcome} from "./output.js";

/**
 * t14 的命令：开发服务三个、`worktree new`、`find`、`shot`。`dev start` 是长命令：边跑边按行输出 `READY`、`NOT_READY`、`EXITED`，带 `--sample` 时还有 `SAMPLE`、`SAMPLE_FAILED`（t18；`--json` 时是同样含义的 JSON 行），
 * 不套一次性的外壳。合同见 docs/cli.md 的“dev”。监管与登记的实现在 `src/dev/`，只在这几个命令里按需导入。
 */

export const DEV_USAGE = `  dev start [--checkout <key|路径>] [--package packages/neuro-book] [--script dev] [--work <W> --task <T>] [--ready-pattern <正则>] [--ready-timeout <秒>] [--sample [--sample-timeout <秒>]] [--grace <秒>] [--as <标签>]
  dev status [--checkout <key|路径>] [--package …] [--script …] [--all] [--wait-ready [--timeout <秒>]]
  dev stop (<runId> | [--checkout <key|路径>] [--package …] [--script …]) [--force] [--grace <秒>] [--as <标签>]
  worktree new <workRef> <taskRef> [--slug <短名>] [--type feat] [--from master] [--as <标签>]
  find <词> [--in <checkout key|all>] [--name] [--limit 20]
  shot [--checkout <key|路径>] [--package packages/neuro-book] [--work <W> --task <T>] [--url <地址>] [--page <路径>] -- <交给 lab:shot 或 page:shot 的参数…>`;

/** `find` 的总条数上限：17 个 checkout 每个 20 条时也不会把几千行塞进 Agent 的上下文（t14 设计审查 S11）。 */
const FIND_TOTAL_LIMIT = 200;

const TARGET_OPTIONS = {checkout: {type: "string"}, package: {type: "string"}, script: {type: "string"}} as const;

function seconds(values: Values, name: string, fallbackMs: number): number {
    const text = stringValue(values, name);
    if (text === undefined) return fallbackMs;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0 || value > 3_600) throw new NbdevError("usage", `--${name} 写 1 到 3600 的秒数：${text}`);
    return Math.round(value * 1_000);
}

function eventLine(event: DevEvent): string {
    switch (event.event) {
    case "ready": return `READY ${event.url} run=${event.runId}${event.reused ? " reused" : ""}${event.owner ? ` owner=${event.owner}` : ""}`;
    case "not_ready": return `NOT_READY ${event.logPath} run=${event.runId}${event.lastStatus !== null ? ` status=${event.lastStatus}` : ""}${event.reused ? " reused" : ""}`;
    case "exited": return `EXITED ${event.signal ?? event.exitCode ?? "?"} run=${event.runId}${event.leftovers > 0 ? ` leftovers=${event.leftovers}` : ""}`;
    case "sample": return `SAMPLE ${event.url} run=${event.runId}`;
    case "sample_failed": return `SAMPLE_FAILED ${event.reason} run=${event.runId}`;
    }
}

export const DEV_COMMANDS: Record<string, CommandSpec> = {
    find: {
        schema: "nbdev.find/v1",
        positionals: ["q"],
        options: {in: {type: "string"}, name: {type: "boolean"}, limit: {type: "string"}},
        async run({io, positionals, values}): Promise<CommandOutcome> {
            const {createNameIndexCache, matchRecords, searchCheckouts, validateSearchQuery} = await import("../core/search.js");
            const {readProjectRecords, readTransitionState} = await import("../core/status.js");
            const {checkoutKeys} = await import("../core/checkouts.js");
            const {listCheckouts} = await import("../core/repo.js");
            const q = validateSearchQuery(positionals[0]!);
            const limitText = stringValue(values, "limit");
            const limit = limitText === undefined ? 20 : Number(limitText);
            if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new NbdevError("usage", `--limit 写 1 到 200：${limitText}`);
            const context = await locateRepository(io.cwd);
            const {records, warnings} = await readProjectRecords(context, await readTransitionState(context.mainRoot));
            const recordHits = values.name === true ? [] : matchRecords(records, q).slice(0, 50);
            const checkouts = (await listCheckouts(context.mainRoot)).filter((checkout) => !checkout.prunable);
            const keys = checkoutKeys(checkouts);
            const scope = stringValue(values, "in") ?? "all";
            const targets = checkouts.filter((checkout) => scope === "all" || keys.get(checkout.root) === scope);
            if (targets.length === 0) throw new NbdevError("usage", `找不到 checkout：${scope}（写 checkout key 或 all）`, {details: {known: [...keys.values()]}});
            const hits: SearchHit[] = [];
            const done: CheckoutSearchDone[] = [];
            let truncated = false;
            await searchCheckouts({
                q,
                checkouts: targets.map((checkout) => ({key: keys.get(checkout.root)!, root: checkout.root, head: checkout.head})),
                names: createNameIndexCache(),
                signal: new AbortController().signal,
                limit,
                namesOnly: values.name === true,
                onHit: (hit) => {
                    if (hits.length < FIND_TOTAL_LIMIT) hits.push(hit);
                    else truncated = true;
                },
                onCheckoutDone: (entry) => {
                    done.push(entry);
                    truncated ||= entry.truncated;
                },
            });
            const human = [
                ...recordHits.map((hit) => `记录 ${hit.kind}  ${hit.kind === "work" ? hit.workId : hit.kind === "task" ? `${hit.workId}/${hit.taskId}` : `${hit.workId}/${hit.taskId ?? "-"}/${hit.artifactId}`}  ${hit.title ?? ""}`),
                ...hits.map((hit) => `${hit.checkout}:${hit.path}${hit.line !== null ? `:${hit.line}: ${hit.text ?? ""}` : ""}`),
                ...done.filter((entry) => entry.error).map((entry) => `${entry.checkout}：搜索出错（${entry.error}）`),
            ];
            if (truncated) human.push(`结果已截断（每个 checkout ${limit} 条、合计 ${FIND_TOTAL_LIMIT} 条）`);
            if (human.length === 0) human.push("没有命中");
            return {schema: "nbdev.find/v1", data: {records: recordHits, hits, checkouts: done, truncated}, warnings, error: null, human};
        },
    },
    shot: {
        schema: "nbdev.shot/v1",
        positionals: ["参数…"],
        positionalsRange: [0, 100],
        options: {checkout: {type: "string"}, package: {type: "string"}, work: {type: "string"}, task: {type: "string"}, url: {type: "string"}, page: {type: "string"}},
        async run({io, positionals, values}): Promise<CommandOutcome> {
            const {runShot} = await import("../dev/shot.js");
            const workRef = stringValue(values, "work");
            const taskRef = stringValue(values, "task");
            if ((workRef === undefined) !== (taskRef === undefined)) throw new NbdevError("usage", "--work 与 --task 要一起给");
            const context = await locateRepository(io.cwd);
            const task = workRef !== undefined && taskRef !== undefined ? await resolveTaskTarget(context, workRef, taskRef) : null;
            const result = await runShot(context, io.cwd, {checkoutRef: stringValue(values, "checkout") ?? null, packageDir: stringValue(values, "package") ?? "packages/neuro-book", url: stringValue(values, "url") ?? null, page: stringValue(values, "page") ?? null, task, passthrough: positionals}, io.env);
            return {schema: "nbdev.shot/v1", data: result, warnings: [], error: null, human: [`截图在 ${result.outDir}（${result.files.length} 个文件）`, ...result.files.map((file) => `  ${file}`)]};
        },
    },
    "worktree new": {
        schema: "nbdev.worktree-new/v1",
        positionals: ["workRef", "taskRef"],
        options: {slug: {type: "string"}, type: {type: "string"}, from: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}): Promise<CommandOutcome> {
            const {createWorktree} = await import("../core/worktree-ops.js");
            const context = await locateRepository(io.cwd);
            const {herdr, caller, warnings} = await writeCaller(io, values);
            const outcome = await createWorktree(context, {workRef: positionals[0]!, taskRef: positionals[1]!, slug: stringValue(values, "slug") ?? null, type: stringValue(values, "type") ?? "feat", from: stringValue(values, "from") ?? "master"}, {caller, herdr});
            const {data} = outcome;
            return {
                schema: "nbdev.worktree-new/v1",
                data,
                warnings: [...warnings, ...outcome.warnings],
                error: null,
                human: [
                    `已建 ${data.path}（分支 ${data.branch}，从 ${data.from}）`,
                    data.home ? `登记表：${data.workId}/${data.taskId} 的 home 指向它` : "登记表的 home 没写（见警告）",
                    `Task README 的执行位置写：\`${data.path.slice(data.path.indexOf("/.worktree/") + 1)}\`，分支 \`${data.branch}\``,
                    `依赖没装：${data.installHint}`,
                ],
            };
        },
    },
    "dev start": {
        schema: "nbdev.dev-start/v1",
        positionals: [],
        options: {...TARGET_OPTIONS, work: {type: "string"}, task: {type: "string"}, "ready-pattern": {type: "string"}, "ready-timeout": {type: "string"}, sample: {type: "boolean"}, "sample-timeout": {type: "string"}, grace: {type: "string"}, ...AS_OPTION},
        async run({io, values}): Promise<CommandOutcome> {
            const {devStart, DEFAULT_GRACE_MS, DEFAULT_READY_TIMEOUT_MS} = await import("../dev/dev-ops.js");
            const {DEFAULT_SAMPLE_TIMEOUT_MS} = await import("../dev/sample.js");
            const sample = values.sample === true;
            if (!sample && stringValue(values, "sample-timeout") !== undefined) throw new NbdevError("usage", "--sample-timeout 要与 --sample 一起给");
            const workRef = stringValue(values, "work");
            const taskRef = stringValue(values, "task");
            if ((workRef === undefined) !== (taskRef === undefined)) throw new NbdevError("usage", "--work 与 --task 要一起给");
            const context = await locateRepository(io.cwd);
            const task = workRef !== undefined && taskRef !== undefined ? await resolveTaskTarget(context, workRef, taskRef) : null;
            const {caller, warnings} = await writeCaller(io, values);
            const json = values.json === true;
            const result = await devStart(context, io.cwd, {
                checkoutRef: stringValue(values, "checkout") ?? null,
                packageDir: stringValue(values, "package") ?? "packages/neuro-book",
                script: stringValue(values, "script") ?? "dev",
                task,
                readyPattern: stringValue(values, "ready-pattern") ?? null,
                readyTimeoutMs: seconds(values, "ready-timeout", DEFAULT_READY_TIMEOUT_MS),
                graceMs: seconds(values, "grace", DEFAULT_GRACE_MS),
                sample,
                sampleTimeoutMs: seconds(values, "sample-timeout", DEFAULT_SAMPLE_TIMEOUT_MS),
            }, caller, io.env, (event) => io.stdout.write(`${json ? JSON.stringify(event) : eventLine(event)}\n`));
            return {schema: "nbdev.dev-start/v1", data: null, warnings: [...warnings, ...result.warnings], error: null, human: [], streamed: {exitCode: result.exitCode}};
        },
    },
    "dev status": {
        schema: "nbdev.dev-status/v1",
        positionals: [],
        options: {...TARGET_OPTIONS, all: {type: "boolean"}, "wait-ready": {type: "boolean"}, timeout: {type: "string"}},
        async run({io, values}): Promise<CommandOutcome> {
            const {DEFAULT_READY_TIMEOUT_MS, listRuns, resolveDevTarget, waitRunReady} = await import("../dev/dev-ops.js");
            const context = await locateRepository(io.cwd);
            const target = await resolveDevTarget(context, stringValue(values, "checkout") ?? null, stringValue(values, "package") ?? "packages/neuro-book", stringValue(values, "script") ?? "dev", io.cwd);
            if (values["wait-ready"] === true) {
                const run = await waitRunReady(context.mainRoot, target, seconds(values, "timeout", DEFAULT_READY_TIMEOUT_MS));
                return {schema: "nbdev.dev-status/v1", data: {runs: [run]}, warnings: [], error: null, human: [`READY ${run.url} run=${run.runId}`]};
            }
            const {runs, warnings} = await listRuns(context.mainRoot);
            const dayAgo = Date.now() - 24 * 3_600_000;
            const shown = runs
                .filter((run) => values.all === true || run.checkout === target.checkout.root)
                .filter((run) => run.state !== "ended" || Date.parse(run.endedAt ?? run.startedAt) >= dayAgo)
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
            return {
                schema: "nbdev.dev-status/v1",
                data: {runs: shown},
                warnings,
                error: null,
                human: shown.length === 0 ? ["没有经 nbdev 起的服务"] : shown.map((run) => `${run.state}${run.reason ? `（${run.reason}）` : ""}  ${run.runId}  ${run.checkoutKey}:${run.package}:${run.script}  ${run.url ?? "地址未知"}  ${run.startedBy ? shortSession(run.startedBy.key) : "未认出的调用者"}  日志 ${run.logPath}`),
            };
        },
    },
    "dev stop": {
        schema: "nbdev.dev-stop/v1",
        positionals: ["runId"],
        positionalsOptional: true,
        options: {...TARGET_OPTIONS, force: {type: "boolean"}, grace: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}): Promise<CommandOutcome> {
            const {DEFAULT_GRACE_MS, devStop, resolveDevTarget} = await import("../dev/dev-ops.js");
            const {assertRunId} = await import("../core/procs.js");
            const context = await locateRepository(io.cwd);
            const runId = positionals[0] !== undefined ? assertRunId(positionals[0]) : null;
            const target = runId === null ? await resolveDevTarget(context, stringValue(values, "checkout") ?? null, stringValue(values, "package") ?? "packages/neuro-book", stringValue(values, "script") ?? "dev", io.cwd) : null;
            const {caller, warnings} = await writeCaller(io, values);
            const data = await devStop(context.mainRoot, {runId, target, force: values.force === true, graceMs: seconds(values, "grace", DEFAULT_GRACE_MS)}, caller);
            return {
                schema: "nbdev.dev-stop/v1",
                data,
                warnings,
                error: null,
                human: [...data.stopped.map((id) => `已停 ${id}`), ...data.skipped.map((entry) => `${entry.runId} 已结束（${entry.reason}），没有发信号`)],
            };
        },
    },
};
