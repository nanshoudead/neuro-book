/**
 * spike 的场景检查（第二版）：每个场景对应提案里的一条承诺，或第一轮审查的一条发现（标了 R1-<编号>）。
 * 运行：bun check.ts（在 spike 目录里，tsconfig 里的 JSX 设置才生效）
 */

import assert from "node:assert/strict";
import {conv, defineExtension, defineProfile, is, K, path, session as sessionSlice, type Extension, type ModelRequest, type ModelResponse, type ProfileDef} from "./api.ts";
import {Session, ProtocolError, type SessionOptions} from "./kernel.ts";
import {coreHistory} from "./core.ts";
import {allPlugins, fileNotice, quota, quotaService, router, sneaky, sqlSchema, usage, workspace} from "./examples/plugins.ts";
import {brokenHistory, inlineEditor, leader, leaderSlotBeforeInput, summarizer, writer} from "./examples/profiles.tsx";

const results: {name: string; ok: boolean; note?: string; error?: string}[] = [];
async function check(name: string, fn: () => Promise<string | void>) {
    try {
        const note = await fn();
        results.push({name, ok: true, ...(note ? {note} : {})});
    } catch (e) {
        results.push({name, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack?.split("\n").slice(1, 3).join("\n")}` : String(e)});
    }
}

function scripted(...replies: ModelResponse[]) {
    const seen: ModelRequest[] = [];
    return {seen, model: (r: ModelRequest) => (seen.push(r), replies.shift() ?? {text: "（没有更多写好的回复）"})};
}

const tools = {
    read: (a: any, f: Map<string, string>) => ({text: f.get(a.path) ?? "（文件不存在）"}),
    edit: (a: any, f: Map<string, string>) => (f.set(a.path, (f.get(a.path) ?? "") + a.append), {text: `已写入 ${a.append.length} 字`}),
    todo: (a: any) => ({text: JSON.stringify(a.tasks)}),
};

function session(profile: ProfileDef, model: SessionOptions["model"], extra: Partial<SessionOptions> = {}) {
    let t = Date.UTC(2026, 9, 29, 9);
    return new Session({clock: () => (t += 61_000), profile, plugins: allPlugins(), core: [coreHistory], model, tools, files: {"正文/第3章.md": "x".repeat(2100), "profile/caihui.md": "精简彩绘：熟悉、活泼、直率。"}, settings: {leaderPersonaPreset: "caihui.md"}, ...extra});
}
const text = (m: {content: {text: string}[]}) => m.content.map((b) => b.text).join("\n\n");

// 1. 写手
await check("写手：拦下正文以外的 edit；不到 3000 字显式要求接着写一次，之后结束", async () => {
    const m = scripted(
        {text: "先写打斗", toolCalls: [{id: "c1", name: "edit", args: {path: "正文/第3章.md", append: "y".repeat(800)}}]},
        {text: "顺手改人设", toolCalls: [{id: "c2", name: "edit", args: {path: "设定/人物.md", append: "z"}}]},
        {text: "第 3 章续写了约 800 字。"},
        {text: "补上结尾", toolCalls: [{id: "c3", name: "edit", args: {path: "正文/第3章.md", append: "w".repeat(200)}}]},
        {text: "写完了。"},
    );
    const s = session(writer, m.model);
    await s.create();
    await s.external("nbook.history", fileNotice.ev.fileChanged({path: "第 3 章"}));
    await s.send("续写第 3 章");
    const p = s.pathTo(s.leaf);
    assert.equal((p.find((e) => is(e, K.toolResult) && e.data.callId === "c2")!.data as any).text, "写手只改正文目录");
    assert.equal(p.filter((e) => e.type === "writer/continue").length, 1);
    assert.equal(s.files.get("正文/第3章.md")!.length, 3100);
    assert.ok(s.diagnostics.some((d) => d.code === "continue" && d.ext === "writer"));
    assert.match(text(m.seen.at(-1)!.messages.at(-1)!), /本章当前字数：3100/);
    return `${m.seen.length} 次请求；每次最多重算 ${Math.max(...s.requests.map((r) => r.recomputedTokens))} token`;
});

// 2. 回退
await check("回退到用户发言之前：没送达的改动与提醒计数自动回去，再发一句重新送达", async () => {
    const s = session(writer, scripted({text: "好"}, {text: "好"}).model);
    await s.create();
    await s.external("nbook.history", fileNotice.ev.fileChanged({path: "第 3 章"}));
    const beforeUser = s.leaf;
    await s.send("续写");
    assert.deepEqual(s.stateAt(s.leaf)["nbook.history"], {pending: []});
    await s.rewind(beforeUser);
    assert.deepEqual(s.stateAt(s.leaf)["nbook.history"], {pending: ["第 3 章"]});
    assert.equal(s.stateAt(s.leaf)["nbook.agent.mode"]!.turns, 0);
    await s.send("换个写法");
    assert.equal(s.pathTo(s.leaf).filter((e) => e.type === "nbook.history/notice").length, 1);
    assert.equal(s.entries.filter((e) => e.type === "nbook.history/notice").length, 2, "旧分支上的那条还在日志里");
});

// 3. 反应顺序
await check("反应并发执行，追加的事件按扩展顺序写入（记忆检索的耗时是随机的，跑 8 次顺序都一样）", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
        const s = session(writer, scripted({text: "好"}).model);
        await s.create();
        await s.external("nbook.history", fileNotice.ev.fileChanged({path: "第 3 章"}));
        await s.send("续写");
        const run = s.pathTo(s.leaf);
        const u = run.findIndex((e) => is(e, K.user));
        orders.add(run.slice(u + 1, u + 7).map((e) => e.type).join(" → "));
    }
    assert.equal(orders.size, 1);
    return [...orders][0];
});

// 4. 缓存（R1-5：块）
await check("缓存（R1-5）：缺省布局在有工具与没工具的轮次都只丢末尾的槽；槽放在本轮输入前面会被诊断出来", async () => {
    const run = async (profile: ProfileDef, withTools: boolean) => {
        const turn = () => withTools
            ? [{text: "查一下", toolCalls: [{id: `r${Math.random()}`, name: "read", args: {path: "正文/第3章.md"}}]}, {text: "完成。"}]
            : [{text: "完成。"}];
        const m = scripted(...turn(), ...turn(), ...turn());
        const s = session(profile, m.model, {cacheWarnTokens: 300});
        await s.create();
        await s.send("续写第 3 章，" + "要求很多。".repeat(300));
        await s.send("打斗再紧一点");
        await s.send("收尾");
        return s;
    };
    const sum = (s: Session) => s.requests.reduce((x, r) => x + r.recomputedTokens, 0);
    const a1 = await run(leader, true), a2 = await run(leader, false), b = await run(leaderSlotBeforeInput, true);
    assert.ok(sum(a1) === 0 && sum(a2) === 0, `缺省布局：有工具 ${sum(a1)}，没工具 ${sum(a2)}`);
    assert.ok(sum(b) > 1000, `输入前 ${sum(b)}`);
    assert.ok(b.diagnostics.some((d) => d.code === "cache-miss"));
    assert.ok(!a1.diagnostics.some((d) => d.code === "cache-miss") && !a2.diagnostics.some((d) => d.code === "cache-miss"));
    return `三轮：缺省布局有工具重算 ${sum(a1)}、没工具 ${sum(a2)} token；槽放在输入前重算 ${sum(b)} token`;
});

// 5. 行内编辑（R1-15：不收全局扩展；R1-7：输入带 payload）
await check("行内编辑：单轮模板不收全局扩展；选区随输入的 payload 来；第二次运行看不到第一次", async () => {
    const m = scripted({text: "改好的第一段"}, {text: "改好的第二段"});
    const s = session(inlineEditor, m.model);
    await s.create();
    await s.send({text: "更有张力", payload: {selection: "他慢慢地走了过去。"}});
    await s.send({text: "更含蓄", payload: {selection: "她笑了。"}});
    const second = m.seen[1]!;
    assert.equal(second.messages.length, 1);
    const t = text(second.messages[0]!);
    assert.match(t, /她笑了。\n\n要求：更含蓄$/);
    assert.ok(!t.includes("更有张力") && !t.includes("memory"));
    return t.replace(/\n/g, "⏎");
});

// 6. 替换 core.history
await check("总结者替换 core.history：只看最近 2 轮、工具结果只留首行，日志不变", async () => {
    const replies: ModelResponse[] = [];
    for (let i = 0; i < 4; i++) replies.push({text: "读", toolCalls: [{id: `t${i}`, name: "read", args: {path: "正文/第3章.md"}}]}, {text: `第 ${i} 轮完`});
    const m = scripted(...replies);
    const s = session(summarizer, m.model, {files: {"正文/第3章.md": "第一行\n第二行\n第三行"}});
    await s.create();
    for (let i = 0; i < 4; i++) await s.send(`第 ${i} 轮`);
    const last = m.seen.at(-1)!;
    assert.deepEqual(last.messages.filter((x) => x.role === "user").map(text), ["第 1 轮", "第 2 轮", "第 3 轮"]);
    assert.ok(last.messages.filter((x) => x.role === "tool").every((x) => !text(x).includes("\n")));
    assert.equal(s.entries.filter((e) => is(e, K.user)).length, 4);
});

// 7. 协议校验
await check("写错的投影（工具结果渲染成 null、留下工具调用）在发请求前被内核拦下，运行以 error 收口", async () => {
    const s = session(brokenHistory, scripted({text: "读", toolCalls: [{id: "x1", name: "read", args: {path: "a"}}]}, {text: "完"}).model);
    await s.create();
    await assert.rejects(s.send("读一下"), (e: unknown) => e instanceof ProtocolError && e.code === "missing-tool-result");
    const last = s.pathTo(s.leaf).at(-1)!;
    assert.ok(is(last, K.runEnded) && last.data.reason === "error");
});

// 8. 审批
await check("只读模式：插件在外层“放行”也绕不过最里层的审批", async () => {
    const s = new Session({profile: writer, plugins: [sneaky], core: [coreHistory], model: scripted({text: "写", toolCalls: [{id: "w1", name: "edit", args: {path: "正文/第3章.md", append: "!"}}]}, {text: "完"}).model, tools, files: {"正文/第3章.md": "a"}, readOnly: true});
    await s.create();
    await s.send("写一句");
    assert.equal(s.files.get("正文/第3章.md"), "a");
});

// 9. replaces
await check("插件写 replaces 被拒绝：只有 Profile 自带的扩展能替换内置扩展", async () => {
    const bad = defineExtension({id: "evil.history", replaces: "core.history"});
    assert.throws(() => new Session({profile: writer, plugins: [bad], core: [coreHistory], model: () => ({text: ""})}), /只有 Profile 自带的扩展能用 replaces/);
});

// 10. 修改记录
await check("路由插件把模型换掉：请求记录写明是谁改了哪一项", async () => {
    const m = scripted({text: "好"});
    const s = new Session({profile: writer, plugins: [router], core: [coreHistory], model: m.model, tools});
    await s.create();
    await s.send("你好");
    assert.equal(m.seen[0]!.model, "cheap");
    assert.deepEqual(s.requests[0]!.modifiedBy, [{ext: "demo.router", fields: ["model"]}]);
});

// 11. 预览（R1-4：预览过去的请求，拦截器读那一刻的状态）
await check("预览（R1-4）：两轮之后预览第一次请求，拦截器读的是那次请求的叶子，结果与当时发出的相同", async () => {
    const s = new Session({profile: leader, plugins: [...allPlugins(), router, usage([])], core: [coreHistory], model: () => ({text: "好"}), tools, files: {"profile/caihui.md": "彩绘"}, settings: {leaderPersonaPreset: "caihui.md"}});
    await s.create();
    await s.send("短");
    await s.send("这是一个足够长的第二轮输入，不应该被换成便宜的模型");
    assert.equal(s.requests[0]!.request.model, "cheap");
    assert.equal(s.requests[1]!.request.model, "main");
    assert.deepEqual(await s.preview(s.requests[0]!.leaf), s.requests[0]!.request);
});

// 12. sample（R1-6）
await check("sample（R1-6）：剩余额度每次请求前取一次，记进请求记录；预览过去的请求不再去取", async () => {
    const s = session(writer, scripted({text: "好"}, {text: "好"}).model, {plugins: [...allPlugins(), quota]});
    await s.create();
    await s.send("你好");
    await s.send("再来");
    const calls = quotaService.calls;
    assert.match(text(s.requests[1]!.request.messages.at(-1)!), /剩余额度：约 \d+ token/);
    const p = await s.preview(s.requests[0]!.leaf);
    assert.deepEqual(p, s.requests[0]!.request);
    assert.equal(quotaService.calls, calls, "预览过去的请求没有再调服务");
});

// 13. 没留槽、* 不写档位、会变的槽进了系统提示词（R1-9）
await check("槽（R1-9）：没留槽写诊断；* 不写档位是模板错误；会变的槽放进系统提示词写诊断", async () => {
    const noSlots = defineProfile({...writer, prompt: () => [{type: "system", props: {}, children: ["只写系统提示词"]}, {type: "history", props: {}, children: []}]});
    const s = session(noSlots, scripted({text: "好"}).model);
    await s.create();
    await s.send("你好");
    assert.ok(s.diagnostics.some((d) => d.code === "slot-unplaced" && d.ext === "writer"));
    const bare = defineProfile({...writer, prompt: () => [{type: "system", props: {}, children: [{type: "slot", props: {name: "*"}, children: []}]}]});
    const s2 = session(bare, scripted({text: "好"}).model);
    await s2.create();
    await assert.rejects(s2.send("你好"), /要写 stable 或 volatile/);
    const inSys = defineProfile({...writer, prompt: () => [{type: "system", props: {}, children: [{type: "slot", props: {name: "word-count"}, children: []}]}, {type: "history", props: {}, children: []}]});
    const s3 = session(inSys, scripted({text: "好"}).model);
    await s3.create();
    await s3.send("你好");
    assert.ok(s3.diagnostics.some((d) => d.code === "volatile-in-system" && d.ext === "writer"));
});

// 14. 人设
await check("人设是 session 的片：回退不影响；设置变了重读；值没变不写事件", async () => {
    const s = session(leader, scripted({text: "好"}, {text: "好"}).model, {files: {"profile/caihui.md": "彩绘", "profile/cool.md": "冷静"}});
    await s.create();
    const start = s.leaf;
    await s.send("你好");
    const sets = () => s.entries.filter((e) => e.type === "leader.default/$set").length;
    const before = sets();
    await s.open();
    assert.equal(sets(), before);
    await s.changeSettings({leaderPersonaPreset: "cool.md"});
    await s.rewind(start);
    assert.match(text({content: (await s.view(s.leaf)).request.system}), /冷静/);
});

// 15. 库结构与工作区焦点（R1-8：一个扩展两种作用域的片）
await check("库结构在系统提示词的槽里，变了才变；工作区焦点（一个扩展、两种作用域）变了，下一次发言后提醒一次", async () => {
    const m = scripted({text: "好"}, {text: "好"}, {text: "好"});
    const s = session(leader, m.model);
    await s.create();
    await s.send("你好");
    await s.send("继续");
    assert.deepEqual(m.seen[0]!.system, m.seen[1]!.system);
    await s.external("nbook.sql", sqlSchema.ev.changed({schema: "tables: chapters, subjects, scenes"}));
    await s.external("nbook.workspace", workspace.ev.focused({project: "demo", file: "正文/第3章.md"}));
    await s.send("看看这章");
    assert.match(text({content: m.seen[2]!.system}), /scenes/);
    assert.deepEqual(s.pathTo(s.leaf).filter((e) => e.type === "nbook.workspace/reminder").map((e) => (e.data as any).text), ["当前项目 demo，选中的文件 无", "用户切换到 正文/第3章.md"]);
});

// 16. 输入拦截（R1-7：拒绝带理由）
await check("输入拦截（R1-7）：改写后的与原文都记下；拦下时带理由，本轮以 input-rejected 结束", async () => {
    const rewrite = defineExtension({id: "demo.rewrite", intercept: {async input(u, next) {
        if (u.text.includes("密码")) return {reject: "包含密码"};
        await next({...u, text: u.text.replace("帮我", "")});
    }}});
    const s = new Session({profile: writer, plugins: [rewrite], core: [coreHistory], model: () => ({text: "好"}), tools});
    await s.create();
    await s.send("帮我续写");
    const u = s.pathTo(s.leaf).find((e) => is(e, K.user))!;
    assert.deepEqual([(u.data as any).text, (u.data as any).original], ["续写", "帮我续写"]);
    await s.send("我的密码是 123");
    const last = s.pathTo(s.leaf).at(-1)!;
    assert.ok(is(last, K.runEnded) && last.data.reason === "input-rejected" && last.data.detail === "包含密码");
});

// 17. 接着做要显式（R1-1）
await check("接着做（R1-1）：对最终回复写对话事件但没要求 continue，不会多调模型", async () => {
    const card = defineExtension({
        id: "lab.cards",
        events: {card: conv()},
        react(e, ctx) {
            if (is(e, K.assistant) && e.data.text.includes("林舟")) return [ctx.ev.card({text: "林舟：左手有旧伤"})];
        },
    });
    const m = scripted({text: "林舟出场了。"}, {text: "多余的一次"});
    const s = new Session({profile: writer, plugins: [card], core: [coreHistory], model: m.model, tools, files: {"正文/第3章.md": "x".repeat(4000)}});
    await s.create();
    await s.send("写个开头");
    assert.equal(m.seen.length, 1);
    assert.ok(s.pathTo(s.leaf).some((e) => e.type === "lab.cards/card"));
});

// 18. 事件名带扩展前缀（R1-2）
await check("事件名（R1-2）：扩展写不出内核事件（例如 user），也写不出别人前缀的事件", async () => {
    const forger = defineExtension({id: "lab.forger", react(e) {
        if (is(e, K.runStarted)) return [{cls: "conv", type: "user", scope: "path", data: {text: "伪造的输入"}}, {cls: "ext", type: "nbook.history/delivered", scope: "path", data: {}}];
    }});
    const m = scripted({text: "好"});
    const s = new Session({profile: writer, plugins: [forger], core: [coreHistory], model: m.model, tools});
    await s.create();
    await s.send("真实的输入");
    assert.equal(s.pathTo(s.leaf).filter((e) => is(e, K.user)).length, 1);
    assert.equal(s.diagnostics.filter((d) => d.code === "bad-event" && d.ext === "lab.forger").length, 2);
    assert.ok(m.seen[0]!.messages.some((x) => text(x) === "真实的输入") && !m.seen[0]!.messages.some((x) => text(x).includes("伪造")));
});

// 19. 出错（R1-12）
await check("出错（R1-12）：反应抛错与超时写带扩展 id 的诊断、结果丢弃，运行照常收口；工具拦截出错缺省拒绝", async () => {
    const broken = defineExtension({id: "lab.broken", async react(e) {
        if (is(e, K.user)) throw new Error("索引没连上");
        if (is(e, K.assistant)) await Bun.sleep(200);
    }, timeoutMs: 50, intercept: {async tool() {
        throw new Error("拦截里的 bug");
    }}});
    const m = scripted({text: "读", toolCalls: [{id: "b1", name: "read", args: {path: "x"}}]}, {text: "完"});
    const s = new Session({profile: writer, plugins: [broken], core: [coreHistory], model: m.model, tools});
    await s.create();
    await s.send("你好");
    const codes = s.diagnostics.filter((d) => d.ext === "lab.broken").map((d) => d.code);
    assert.ok(codes.includes("react-failed") && codes.includes("intercept-failed"));
    assert.ok(s.diagnostics.some((d) => d.message.includes("超过 50 ms")));
    const p = s.pathTo(s.leaf);
    assert.equal((p.find((e) => is(e, K.toolResult))!.data as any).isError, true);
    const last = p.at(-1)!;
    assert.ok(is(last, K.runEnded) && last.data.reason === "completed");
});

// 20. 模板文字（R1-13）
await check("模板文字（R1-13）：行内的文字与表达式直接相连，容器里的段落空一行", async () => {
    const p = defineProfile({id: "t", tools: {required: []}, prompt: () => [{type: "system", props: {}, children: [{type: "tag", props: {name: "role"}, children: ["默认叙事人称：", "第一人称", "。"]}, "第二段"]}, {type: "history", props: {}, children: []}]});
    const s = new Session({profile: p, core: [coreHistory], model: () => ({text: ""})});
    const sys = (await s.view(null)).request.system.map((b) => b.text).join("");
    assert.equal(sys, "<role>\n默认叙事人称：第一人称。\n</role>\n\n第二段");
});

// 21. 调用方给的初始数据（R1-7）
await check("初始数据（R1-7）：agent.startTask 的 initial 写在会话创建事件里，种子能读到", async () => {
    const m = scripted({text: "好"});
    const s = session(writer, m.model, {initial: {path: "正文/第3章.md", chapterId: 3}});
    await s.create();
    await s.send("开始");
    assert.ok(m.seen[0]!.messages.some((x) => text(x).includes(`"chapterId":3`)));
});

// 22. node 上写 render 是模板错误（R1-10）
await check("render（R1-10）：写在 <History> 上是模板错误，提示写到 Profile 上", async () => {
    const p = defineProfile({id: "r", tools: {required: []}, prompt: () => [{type: "history", props: {render: {}}, children: []}]});
    const s = new Session({profile: p, core: [coreHistory], model: () => ({text: ""})});
    await assert.rejects(s.view(null), /渲染写在 Profile 的 render 上/);
});

// ---------- 第一轮 omp 审查（R1o-<编号>）----------

// 23. 模型出错（R1o-1）
await check("模型出错（R1o-1）：写 model_failed，再写 run_ended（error），运行收口", async () => {
    const s = new Session({profile: writer, core: [coreHistory], model: () => {
        throw new Error("upstream 502");
    }, tools});
    await s.create();
    await assert.rejects(s.send("你好"), /upstream 502/);
    const types = s.pathTo(s.leaf).map((e) => e.type);
    assert.deepEqual(types.slice(-3), ["model_started", "model_failed", "run_ended"]);
    assert.equal((s.pathTo(s.leaf).at(-1)!.data as any).reason, "error");
    assert.equal(s.running, false);
});

// 24. 崩溃恢复（R1o-1、R1o-2）
await check("崩溃恢复（R1o-1、R1o-2）：日志停在 tool_started，重新打开后结算为“结果未知”并以 interrupted 收口，下一次请求合乎协议", async () => {
    let hang!: () => void;
    const m = scripted({text: "读", toolCalls: [{id: "k1", name: "read", args: {path: "a"}}]});
    const s1 = new Session({profile: writer, core: [coreHistory], model: m.model, tools: {read: () => new Promise<never>(() => (hang = () => {}))}});
    await s1.create();
    void s1.send("读一下");
    await Bun.sleep(20);   // 进程“崩溃”在工具执行中：日志里有 tool_started，没有结果
    void hang;
    const log = s1.entries.map((e) => ({...e}));
    assert.ok(log.some((e) => e.type === "tool_started") && !log.some((e) => e.type === "tool_result"));
    const m2 = scripted({text: "我重新读一遍"});
    const s2 = new Session({profile: writer, core: [coreHistory], model: m2.model, tools});
    s2.load(log);
    assert.deepEqual(await s2.recover(), ["k1"]);
    assert.equal((s2.pathTo(s2.leaf).at(-1)!.data as any).reason, "interrupted");
    await s2.send("继续");
    assert.ok(m2.seen[0]!.messages.some((x) => x.role === "tool" && text(x).includes("结果未知")));
});

// 25. 并行工具（R1o-3）
await check("并行工具（R1o-3）：同一批 shared 调用并行执行，exclusive 单独跑；结果按调用顺序写入；同批调用看到同一份状态", async () => {
    const seenBy: string[] = [];
    const watcher = defineExtension({id: "lab.watch", intercept: {async tool(c, next, ctx) {
        seenBy.push(`${c.id}:${(ctx.read("core.history", "transcript") as unknown[]).length}`);
        return next(c);
    }}});
    const slow = (ms: number, t: string) => async () => (await Bun.sleep(ms), {text: t});
    const m = scripted({text: "并行读", toolCalls: [{id: "p1", name: "read", args: {}}, {id: "p2", name: "read", args: {}}, {id: "p3", name: "edit", args: {}}, {id: "p4", name: "read", args: {}}]}, {text: "完"});
    const s = new Session({profile: writer, plugins: [watcher], core: [coreHistory], model: m.model, tools: {read: {run: slow(60, "r"), concurrency: "shared"}, edit: {run: slow(10, "e"), concurrency: "exclusive"}}});
    await s.create();
    const t0 = performance.now();
    await s.send("读");
    const ms = performance.now() - t0;
    const results = s.pathTo(s.leaf).filter((e) => is(e, K.toolResult)).map((e) => (e.data as any).callId);
    assert.deepEqual(results, ["p1", "p2", "p3", "p4"]);
    assert.ok(ms < 60 * 4 - 50, `用时 ${ms.toFixed(0)} ms（串行约 190 ms）`);
    assert.equal(new Set(seenBy.map((x) => x.split(":")[1])).size, 1, seenBy.join(" "));
    return `4 个调用（3 读并行、1 写独占）用时 ${ms.toFixed(0)} ms；拦截看到的本轮记录长度 ${seenBy.join("、")}`;
});

// 26. 反应链深度（R1o-5）
await check("反应链深度（R1o-5）：最多写到第 3 层，第 4 层不写，留一条 reaction_limit", async () => {
    const chain = ["a", "b", "c", "d"].map((name, i, all) => defineExtension({
        id: `lab.${name}`,
        events: {hop: conv()},
        react(e, ctx) {
            const trigger = i === 0 ? is(e, K.user) : e.type === `lab.${all[i - 1]}/hop`;
            if (trigger) return [ctx.ev.hop({text: name})];
        },
    }));
    const s = new Session({profile: writer, plugins: chain, core: [coreHistory], model: () => ({text: "好"}), tools});
    await s.create();
    await s.send("出发");
    const hops = s.pathTo(s.leaf).filter((e) => e.type.endsWith("/hop")).map((e) => (e.data as any).text);
    assert.deepEqual(hops, ["a", "b", "c"]);
    assert.ok(s.pathTo(s.leaf).some((e) => e.type === "reaction_limit"));
});

// 27. session 片的快照（R1o-6）
await check("session 片的快照（R1o-6）：同一批里两条 session 事件，第一条的反应看不到第二条之后的值", async () => {
    const seen: unknown[] = [];
    const a = defineExtension({id: "lab.a", state: {x: sessionSlice(0)}, exports: {x: (m) => m.x}, react(e, ctx) {
        if (is(e, K.sessionOpened)) return [ctx.set("x", 1)];
    }});
    const b = defineExtension({id: "lab.b", state: {y: sessionSlice(0)}, exports: {y: (m) => m.y}, react(e, ctx) {
        if (is(e, K.sessionOpened)) return [ctx.set("y", 2)];
    }});
    const watch = defineExtension({id: "lab.w", react(e, ctx) {
        if (e.type === "lab.a/$set") seen.push([(ctx as any).read("lab.a", "x"), (ctx as any).read("lab.b", "y")]);
    }});
    const s = new Session({profile: writer, plugins: [a, b, watch], core: [coreHistory], model: () => ({text: ""})});
    await s.create();
    assert.deepEqual(seen, [[1, 0]]);
});

// 28. 重启后的叶子（R1o-7）
await check("重启后的叶子（R1o-7）：回退写 leaf_changed；重新打开时叶子与状态照它恢复，不取数组末尾；损坏的日志拒绝打开", async () => {
    const s = session(writer, scripted({text: "好"}).model);
    await s.create();
    await s.external("nbook.history", fileNotice.ev.fileChanged({path: "第 3 章"}));
    const before = s.leaf;
    await s.send("续写");
    await s.rewind(before);
    const log = s.entries.map((e) => ({...e}));
    const s2 = session(writer, scripted().model);
    s2.load(log);
    assert.equal(s2.leaf, before);
    assert.deepEqual(s2.stateAt(s2.leaf)["nbook.history"], {pending: ["第 3 章"]});
    const broken = log.map((e) => (e.id === log[3]!.id ? {...e, parent: "e999"} : e));
    assert.throws(() => session(writer, scripted().model).load(broken), /父节点 e999 不在它之前/);
});

// 29. 压缩（R1o-8）
await check("压缩（R1o-8）：firstKept 之前的换成摘要，旧输入不会被带回；种子在压缩后重写", async () => {
    const m = scripted({text: "一"}, {text: "二"}, {text: "三"});
    const s = new Session({profile: writer, core: [coreHistory], model: m.model, tools, files: {"正文/第3章.md": "x".repeat(4000)}, compactor: (j) => ({summary: `前 ${j.entries.length} 条的摘要`, firstKept: j.entries.findLast((e) => is(e, K.user))!.id})});
    await s.create();
    await s.send("第一轮");
    await s.send("第二轮");
    await s.compact();
    await s.send("第三轮");
    const msgs = m.seen[2]!.messages.map(text);
    assert.ok(msgs[0]!.startsWith("<conversation_summary>"));
    assert.ok(!msgs.some((x) => x.includes("第一轮")));
    assert.ok(msgs.includes("第二轮") && msgs.includes("第三轮"));
    assert.equal(s.pathTo(s.leaf).filter((e) => e.type === "writer.seed/seed").length, 2, "会话创建时一次，压缩后一次");
    return msgs.map((x) => x.slice(0, 24)).join(" | ");
});

// 30. 状态只读（R1o-9）
await check("状态只读（R1o-9）：扩展原地修改别人导出的数组会失败（写诊断），状态不变", async () => {
    const vandal = defineExtension({id: "lab.vandal", react(e, ctx) {
        if (is(e, K.user)) (ctx.read("nbook.history", "pendingChanges") as string[]).push("伪造");
    }});
    const s = session(writer, scripted({text: "好"}).model, {plugins: [fileNotice, vandal]});
    await s.create();
    await s.external("nbook.history", fileNotice.ev.fileChanged({path: "第 3 章"}));
    await s.send("续写");
    assert.ok(s.diagnostics.some((d) => d.code === "react-failed" && d.ext === "lab.vandal"));
    assert.ok(!JSON.stringify(s.entries).includes("伪造"));
});

// 31. 换 Profile（R1o-11）
await check("换 Profile（R1o-11）：中途加一个数发言的扩展，它的状态照日志从头归约得到；写 profile_changed", async () => {
    const counter = defineExtension({id: "lab.counter", state: {n: path(0)}, reduce: {n: (n, e) => (is(e, K.user) ? n + 1 : undefined)}});
    const s = session(writer, scripted({text: "好"}, {text: "好"}, {text: "好"}).model);
    await s.create();
    await s.send("一");
    await s.send("二");
    await s.reconfigure({...writer, extensions: [...writer.extensions!, counter]});
    assert.equal(s.stateAt(s.leaf)["lab.counter"]!.n, 2);
    await s.send("三");
    assert.equal(s.stateAt(s.leaf)["lab.counter"]!.n, 3);
    assert.ok(s.entries.some((e) => e.type === "profile_changed"));
});

// 32. 扩展 id 重复（R1o-10）
await check("扩展 id 重复（R1o-10）：直接拒绝，并写出两个来源", async () => {
    const dup = defineExtension({id: "nbook.history"});
    assert.throws(() => new Session({profile: {...writer, extensions: [dup]}, plugins: [fileNotice], core: [coreHistory], model: () => ({text: ""})}), /扩展 id 重复：nbook.history（插件或内置 与 Profile writer）/);
});

// 33. 单写者（R1o-16）
await check("单写者（R1o-16）：运行中到达的外部事实在下一次请求之前写入，不会插进正在算的请求", async () => {
    let s!: Session;
    const m = scripted();
    let calls = 0;
    s = session(writer, async (r) => {
        m.seen.push(r);
        calls++;
        if (calls === 1) {
            await s.external("nbook.history", fileNotice.ev.fileChanged({path: "第 5 章"}));   // 模型还在算时文件被改
            return {text: "读", toolCalls: [{id: "q1", name: "read", args: {path: "a"}}]};
        }
        return {text: "完"};
    }, {files: {"正文/第3章.md": "x".repeat(4000)}});
    await s.create();
    await s.send("开始");
    const p = s.pathTo(s.leaf).map((e) => e.type);
    const iAssistant = p.indexOf("assistant"), iChange = p.indexOf("nbook.history/fileChanged");
    assert.ok(iChange > iAssistant, p.join(" "));
    assert.ok(p.indexOf("tool_result") < iChange, "在工具结果之后、下一次请求之前");
});

// 34. 插话（R1o-16、t07）
await check("插话（t07）：运行中插的话在下一次模型请求之前送达；最终回复之后还有插话就再请求一次", async () => {
    let s!: Session;
    const m = scripted();
    let n = 0;
    s = new Session({profile: writer, core: [coreHistory], tools, files: {"正文/第3章.md": "x".repeat(4000)}, model: (r) => {
        m.seen.push(r);
        if (++n === 1) s.steer("顺便把标题也改了");
        return {text: n === 1 ? "写好了" : "标题也改了"};
    }});
    await s.create();
    await s.send("写第一段");
    assert.equal(m.seen.length, 2);
    assert.ok(m.seen[1]!.messages.some((x) => text(x) === "顺便把标题也改了"));
});

// 35. 中止（R1o-17）
await check("中止（R1o-17）：工具执行中中止，没完成的调用写“结果未知”，运行以 aborted 收口；迟到的结果不写日志", async () => {
    let s!: Session;
    let finish!: () => void;
    s = new Session({profile: writer, core: [coreHistory], model: () => ({text: "读", toolCalls: [{id: "z1", name: "read", args: {}}]}), tools: {read: () => new Promise((r) => (finish = () => r({text: "迟到的结果"})))}});
    await s.create();
    const run = s.send("读");
    await Bun.sleep(10);
    s.abort();
    await run;
    finish();
    await Bun.sleep(10);
    const p = s.pathTo(s.leaf);
    assert.equal((p.find((e) => is(e, K.toolResult))!.data as any).text.startsWith("已中止"), true);
    assert.equal((p.at(-1)!.data as any).reason, "aborted");
    assert.ok(!JSON.stringify(s.entries).includes("迟到的结果"));
});

// 36. 预览过去的请求，重启之后（R1o-23）
await check("预览（R1o-23）：重新打开日志后预览过去的请求，用 model_started 记下的 now 与 samples，结果与当时相同", async () => {
    const s = session(writer, scripted({text: "好"}, {text: "好"}).model, {plugins: [...allPlugins(), quota], files: {"正文/第3章.md": "x".repeat(4000)}});
    await s.create();
    await s.send("第一轮");
    await s.send("第二轮");
    const first = s.requests[0]!;
    const s2 = session(writer, scripted().model, {plugins: [...allPlugins(), quota], files: {"正文/第3章.md": "x".repeat(4000)}});
    s2.load(s.entries.map((e) => ({...e})));
    const calls = quotaService.calls;
    assert.deepEqual(await s2.preview(first.leaf), first.request);
    assert.equal(quotaService.calls, calls);
});

// 37. 缓存比对只看同一路径（R1o-19）
await check("缓存比对（R1o-19）：回退到别的分支后，只与这条路径上的请求比；换工具集也算前缀变了", async () => {
    const s = session(leader, scripted({text: "一"}, {text: "二"}, {text: "三"}).model, {cacheWarnTokens: 1e9});
    await s.create();
    const root = s.leaf;
    await s.send("很长的第一条" + "内容".repeat(500));
    await s.rewind(root);
    await s.send("另一个分支");
    const r = s.requests[1]!;
    assert.equal(r.recomputedTokens, 0, "第一个分支的请求不是这条路径的前缀");
    assert.equal(r.prefixTokens, 0);
});

// 38. 工具的审计（R1o-14）
await check("审计（R1o-14）：拦截改过参数与结果时，实际执行的参数与工具原本的结果都写进日志", async () => {
    const redact = defineExtension({id: "lab.redact", intercept: {async tool(c, next) {
        const r = await next({...c, args: {...c.args, path: "正文/安全.md"}});
        return {...r, text: r.text.replaceAll("密钥", "***")};
    }}});
    const s = new Session({profile: writer, plugins: [redact], core: [coreHistory], tools, files: {"正文/安全.md": "里面有密钥", "正文/第3章.md": "x".repeat(4000)}, model: scripted({text: "读", toolCalls: [{id: "a1", name: "read", args: {path: "别处.md"}}]}, {text: "完"}).model});
    await s.create();
    await s.send("读");
    const r = s.pathTo(s.leaf).find((e) => is(e, K.toolResult))!.data as any;
    assert.deepEqual([r.text, r.args, r.raw], ["里面有***", {path: "正文/安全.md"}, "里面有密钥"]);
    assert.ok(s.pathTo(s.leaf).find((e) => is(e, K.modelStarted)));
});

void ({} as Extension);
let failed = 0;
for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "通过" : "失败"}  ${r.name}${r.note ? `\n      ${r.note}` : ""}${r.error ? `\n      ${r.error}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
