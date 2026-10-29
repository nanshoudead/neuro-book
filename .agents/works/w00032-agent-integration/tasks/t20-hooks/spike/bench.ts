/**
 * spike 的性能粗测：长会话打开、每条事件的增量、算一次请求、回退到中间、快照的内存。
 * 运行：bun bench.ts [轮数，缺省 700]
 */

import {Session, type ModelRequest, type ModelResponse} from "./kernel.ts";
import {coreHistory} from "./core.ts";
import {allPlugins, router} from "./examples/plugins.ts";
import {leader} from "./examples/profiles.tsx";

const RUNS = Number(process.argv[2] ?? 700);
const tools = {
    read: () => ({text: "第一行内容。".repeat(40)}),
    edit: (a: any, f: Map<string, string>) => (f.set(a.path, (f.get(a.path) ?? "") + "y"), {text: "已写入"}),
};
let n = 0, inRun = 0;
// 每轮两次工具调用（先 read 后 edit）再结束；send 是串行的，用闭包计数就够
const model = (_r: ModelRequest): ModelResponse => {
    if (inRun < 2) return {text: "继续", toolCalls: [{id: `c${++n}`, name: inRun++ ? "edit" : "read", args: {path: "正文/第3章.md"}}]};
    inRun = 0;
    return {text: "这一轮完成。".repeat(20)};
};
const make = (snapshots: "all" | "none") => new Session({profile: leader, plugins: [...allPlugins(), router], core: [coreHistory], model, tools, files: {"正文/第3章.md": "x"}, settings: {leaderPersonaPreset: "p"}, snapshots, cacheWarnTokens: 1e9, freeze: process.env.FREEZE !== "0"});

const ms = (t0: number) => `${(performance.now() - t0).toFixed(1)} ms`;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

let t0 = performance.now();
const live = make("all");
await live.create();
for (let i = 0; i < RUNS; i++) await live.send(`第 ${i} 轮：继续写`);
console.log(`跑 ${RUNS} 轮（含假模型与反应）：${ms(t0)}；日志 ${live.entries.length} 条，请求 ${live.requests.length} 次`);
const tokens = live.requests.at(-1)!.tokens;
console.log(`最后一次请求约 ${tokens} token，${live.requests.at(-1)!.request.messages.length} 条消息`);

const log = live.entries.map((e) => ({...e}));
for (const mode of ["all", "none"] as const) {
    Bun.gc(true);
    const heap0 = process.memoryUsage().heapUsed;
    t0 = performance.now();
    const s = make(mode);
    s.load(log);
    const openTime = ms(t0);
    Bun.gc(true);
    const heap = process.memoryUsage().heapUsed - heap0;
    t0 = performance.now();
    for (let i = 0; i < 20; i++) await s.view(s.leaf);
    const req = `${((performance.now() - t0) / 20).toFixed(2)} ms`;
    const mid = log[Math.floor(log.length / 2)]!.id;
    t0 = performance.now();
    s.rewind(mid);
    await s.view(s.leaf);
    const rewind = ms(t0);
    console.log(`快照 ${mode}：打开 ${openTime}，堆增加约 ${mb(heap)}；算一次请求 ${req}；回退到中间并算请求 ${rewind}`);
}

// 每条事件的增量：再跑 20 轮，记平均
t0 = performance.now();
const before = live.entries.length;
for (let i = 0; i < 20; i++) await live.send("再来一轮");
console.log(`长会话上每条新事件（含归约、反应、算请求）平均 ${((performance.now() - t0) / (live.entries.length - before)).toFixed(2)} ms`);
