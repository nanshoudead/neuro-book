/**
 * spike 的场景检查：每个场景对应提案里的一条承诺，跑真的内核、假的模型与工具。
 * 运行：bun check.ts（在 spike 目录里，tsconfig 里的 JSX 设置才生效）
 */

import assert from "node:assert/strict";
import {Session, ProtocolError, type ModelRequest, type ModelResponse, type ProfileDef, type ExtensionDef} from "./kernel.ts";
import {coreHistory} from "./core.ts";
import {allPlugins, fileNotice, focusChanged, router, sneaky, sqlSchemaChanged, usage} from "./examples/plugins.ts";
import {brokenHistory, inlineEditor, leader, leaderSlotBeforeInput, setSelection, summarizer, writer} from "./examples/profiles.tsx";

const results: {name: string; ok: boolean; note?: string; error?: string}[] = [];
async function check(name: string, fn: () => Promise<string | void>) {
    try {
        const note = await fn();
        results.push({name, ok: true, ...(note ? {note} : {})});
    } catch (e) {
        results.push({name, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack?.split("\n").slice(1, 3).join("\n")}` : String(e)});
    }
}

/** 假模型：按顺序给出写好的回复；收到的请求都记下来。 */
function scripted(...replies: ModelResponse[]) {
    const seen: ModelRequest[] = [];
    return {seen, model: (r: ModelRequest) => (seen.push(r), replies.shift() ?? {text: "（没有更多写好的回复）"})};
}

const tools = {
    read: (a: any, f: Map<string, string>) => ({text: f.get(a.path) ?? "（文件不存在）"}),
    edit: (a: any, f: Map<string, string>) => (f.set(a.path, (f.get(a.path) ?? "") + a.append), {text: `已写入 ${a.append.length} 字`}),
    todo: (a: any) => ({text: JSON.stringify(a.tasks)}),
};

function session(profile: ProfileDef, model: (r: ModelRequest) => ModelResponse, extra: Partial<ConstructorParameters<typeof Session>[0]> = {}) {
    let t = Date.UTC(2026, 9, 29, 9);
    return new Session({clock: () => (t += 61_000), profile, plugins: allPlugins(), core: [coreHistory], model, tools, files: {"正文/第3章.md": "x".repeat(2100), "profile/caihui.md": "精简彩绘：熟悉、活泼、直率。"}, settings: {leaderPersonaPreset: "caihui.md"}, ...extra});
}

const types = (s: Session) => s.pathTo(s.leaf).map((e) => e.type);

// 1. 写手：续写、字数、接着写、挡住正文以外的 edit
await check("写手：拦下正文以外的 edit，不到 3000 字接着写一次，之后结束", async () => {
    const m = scripted(
        {text: "先写打斗", toolCalls: [{id: "c1", name: "edit", args: {path: "正文/第3章.md", append: "y".repeat(800)}}]},
        {text: "顺手改人设", toolCalls: [{id: "c2", name: "edit", args: {path: "设定/人物.md", append: "z"}}]},
        {text: "第 3 章续写了约 800 字。"},
        {text: "补上结尾", toolCalls: [{id: "c3", name: "edit", args: {path: "正文/第3章.md", append: "w".repeat(200)}}]},
        {text: "写完了。"},
    );
    const s = session(writer, m.model);
    await s.create();
    await s.external("nbook.history", {cls: "ext", type: "nbook.history/file-changed", data: {path: "第 3 章"}});
    await s.send("续写第 3 章");
    const path = s.pathTo(s.leaf);
    const blocked = path.find((e) => e.type === "tool_result" && e.data.callId === "c2");
    assert.equal(blocked?.data.text, "写手只改正文目录");
    assert.ok(!s.files.has("设定/人物.md"));
    assert.equal(path.filter((e) => e.type === "writer/continue").length, 1);
    assert.equal(s.files.get("正文/第3章.md")!.length, 3100);
    assert.equal(types(s).at(-1), "run_ended");
    // 字数在请求最末尾，每次请求都换，但只丢最后一小段
    const last = m.seen.at(-1)!;
    assert.match(last.messages.at(-1)!.content, /本章当前字数：3100/);
    const worst = Math.max(...s.requests.map((r) => r.recomputedTokens));
    return `${m.seen.length} 次请求；每次最多重算 ${worst} token`;
});

// 2. 回退：扩展状态跟着回去
await check("回退到用户发言之前：没送达的改动与提醒计数自动回去，再发一句重新送达", async () => {
    const m = scripted({text: "好"}, {text: "好"});
    const s = session(writer, m.model);
    await s.create();
    await s.external("nbook.history", {cls: "ext", type: "nbook.history/file-changed", data: {path: "第 3 章"}});
    const beforeUser = s.leaf;
    await s.send("续写");
    assert.deepEqual(s.stateAt(s.leaf)["nbook.history"], {pending: []});
    s.rewind(beforeUser);
    assert.deepEqual(s.stateAt(s.leaf)["nbook.history"], {pending: ["第 3 章"]});
    assert.equal((s.stateAt(s.leaf)["nbook.agent/mode"] as any).turns, 0);
    await s.send("换个写法");
    const notices = s.pathTo(s.leaf).filter((e) => e.type === "nbook.history/notice");
    assert.equal(notices.length, 1);
    assert.equal(s.entries.filter((e) => e.type === "nbook.history/notice").length, 2, "旧分支上的那条还在日志里");
});

// 3. 同一条事件的反应：写入顺序不受快慢影响
await check("反应并发执行，追加的事件按扩展顺序写入（记忆检索的耗时是随机的，跑 8 次顺序都一样）", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
        const s = session(writer, scripted({text: "好"}).model);
        await s.create();
        await s.external("nbook.history", {cls: "ext", type: "nbook.history/file-changed", data: {path: "第 3 章"}});
        await s.send("续写");
        const run = s.pathTo(s.leaf);
        const u = run.findIndex((e) => e.type === "user");
        orders.add(run.slice(u + 1, u + 6).map((e) => `${e.source}:${e.type}`).join(" → "));
    }
    assert.equal(orders.size, 1);
    return [...orders][0];
});

// 4. 缓存：会变的槽放在末尾 vs 放在本轮输入前面
await check("缓存：会变的槽放末尾只丢一小段；放在本轮输入前面，每次请求重算本轮记录、下一轮重算上一轮", async () => {
    const run = async (profile: ProfileDef) => {
        const turn = () => [
            {text: "查一下", toolCalls: [{id: `r${Math.random()}`, name: "read", args: {path: "正文/第3章.md"}}]},
            {text: "再改一下", toolCalls: [{id: `e${Math.random()}`, name: "edit", args: {path: "正文/第3章.md", append: "y".repeat(50)}}]},
            {text: "完成。"},
        ];
        const m = scripted(...turn(), ...turn());
        const s = session(profile, m.model, {cacheWarnTokens: 500});
        await s.create();
        await s.send("续写第 3 章");
        await s.send("打斗再紧一点");
        return s;
    };
    const a = await run(leader), b = await run(leaderSlotBeforeInput);
    const sum = (s: Session) => s.requests.reduce((x, r) => x + r.recomputedTokens, 0);
    // 在 leader 的请求里，会变的槽本例中只有“工作区焦点”之类持久提醒以外的东西；为了有会变的槽，看写手
    assert.ok(sum(b) > sum(a) * 3, `末尾 ${sum(a)}，输入前 ${sum(b)}`);
    assert.ok(b.diagnostics.some((d) => d.startsWith("缓存：")));
    return `两轮共 ${a.requests.length} 次请求：放末尾共重算 ${sum(a)} token；放在输入前共重算 ${sum(b)} token`;
});

// 5. 行内编辑：单轮模板，没有历史
await check("行内编辑：没有 <History>，输入放进固定消息里；第二次运行看不到第一次", async () => {
    const m = scripted({text: "改好的第一段"}, {text: "改好的第二段"});
    const s = session(inlineEditor, m.model);
    await s.create();
    await s.external("inline", setSelection("他慢慢地走了过去。"));
    await s.send("更有张力");
    await s.external("inline", setSelection("她笑了。"));
    await s.send("更含蓄");
    const second = m.seen[1]!;
    assert.equal(second.messages.length, 1);
    assert.match(second.messages[0]!.content, /她笑了。[\s\S]*要求：[\s\S]*更含蓄/);
    assert.ok(!second.messages[0]!.content.includes("更有张力"));
    assert.equal(s.entries.filter((e) => e.type === "user").length, 2, "两次输入都在日志里");
    return second.messages[0]!.content.replace(/\n+/g, " ⏎ ");
});

// 6. 替换 core.history：只看最近 2 轮，工具结果只留首行；日志里还是全部
await check("总结者替换 core.history：只看最近 2 轮、工具结果只留首行，日志不变", async () => {
    const replies: ModelResponse[] = [];
    for (let i = 0; i < 4; i++) replies.push({text: "读", toolCalls: [{id: `t${i}`, name: "read", args: {path: "正文/第3章.md"}}]}, {text: `第 ${i} 轮完`});
    const m = scripted(...replies);
    const s = session(summarizer, m.model, {files: {"正文/第3章.md": "第一行\n第二行\n第三行"}});
    await s.create();
    for (let i = 0; i < 4; i++) await s.send(`第 ${i} 轮`);
    const last = m.seen.at(-1)!;
    const users = last.messages.filter((x) => x.role === "user").map((x) => x.content);
    assert.deepEqual(users, ["第 1 轮", "第 2 轮", "第 3 轮"]);
    assert.ok(last.messages.filter((x) => x.role === "tool").every((x) => !x.content.includes("\n")));
    assert.equal(s.entries.filter((e) => e.type === "user").length, 4);
    assert.ok(!s.exts.some((x) => x.def.id === "nb-memory"), "按标签排除了记忆");
});

// 7. 协议校验兜底
await check("写错的历史投影（去掉工具结果、留下工具调用）在发请求前被内核拦下", async () => {
    const m = scripted({text: "读", toolCalls: [{id: "x1", name: "read", args: {path: "a"}}]}, {text: "完"});
    const s = session(brokenHistory, m.model);
    await s.create();
    await assert.rejects(s.send("读一下"), (e: unknown) => e instanceof ProtocolError && e.code === "missing-tool-result");
});

// 8. 审批在最里层，插件绕不过
await check("只读模式：插件在外层“放行”也绕不过最里层的审批", async () => {
    const m = scripted({text: "写", toolCalls: [{id: "w1", name: "edit", args: {path: "正文/第3章.md", append: "!"}}]}, {text: "完"});
    const s = new Session({profile: writer, plugins: [sneaky], core: [coreHistory], model: m.model, tools, files: {"正文/第3章.md": "a"}, readOnly: true});
    await s.create();
    await s.send("写一句");
    assert.equal(s.files.get("正文/第3章.md"), "a");
    assert.equal(s.pathTo(s.leaf).find((e) => e.type === "tool_result")!.data.text, "只读模式：拒绝写入");
});

// 9. 插件不能替换内置扩展
await check("插件写 replaces 被拒绝：只有 Profile 自带的扩展能替换内置扩展", async () => {
    const bad: ExtensionDef = {id: "evil.history", replaces: "core.history", setup: () => ({})};
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

// 11. 预览 = 真实请求
await check("预览不调模型，算出的请求与随后真实发出的相同（跑模型拦截链，最里层截下）", async () => {
    const log: ModelRequest[] = [];
    const s = new Session({profile: leader, plugins: [...allPlugins(), router, usage(log)], core: [coreHistory], model: () => ({text: "好"}), tools, files: {"profile/caihui.md": "彩绘"}, settings: {leaderPersonaPreset: "caihui.md"}});
    await s.create();
    await s.send("你好");
    // 回到“发请求那一刻”的叶子做预览
    const at = s.requests[0]!.leaf;
    const p = await s.preview(at);
    assert.deepEqual(p, s.requests[0]!.request);
});

// 12. 没留槽
await check("Profile 没留某个槽：内容丢弃并写诊断", async () => {
    const noSlots: ProfileDef = {...writer, prompt: () => [{type: "system", props: {}, children: ["只写系统提示词"]}, {type: "history", props: {}, children: []}]};
    const s = session(noSlots, scripted({text: "好"}).model);
    await s.create();
    await s.send("你好");
    assert.ok(s.diagnostics.some((d) => d.includes("Profile 没留槽 word-count")));
    assert.ok(s.diagnostics.some((d) => d.includes("Profile 没留槽 sql-schema")));
});

// 13. 会话级状态：人设
await check("人设是会话级：回退不影响；设置变了重读；值没变不写事件", async () => {
    const s = session(leader, scripted({text: "好"}, {text: "好"}, {text: "好"}).model, {files: {"profile/caihui.md": "彩绘", "profile/cool.md": "冷静"}});
    await s.create();
    const start = s.leaf;
    await s.send("你好");
    const setsBefore = s.entries.filter((e) => e.type === "leader.default/persona/set").length;
    await s.open();   // 重新打开会话：值没变，不写
    assert.equal(s.entries.filter((e) => e.type === "leader.default/persona/set").length, setsBefore);
    await s.changeSettings({leaderPersonaPreset: "cool.md"});
    s.rewind(start);
    const req = s.buildRequest();
    assert.match(req.system, /冷静/);
});

// 14. 库结构与工作区焦点
await check("库结构在系统提示词的槽里，变了才变；工作区焦点变了，下一次发言后提醒一次", async () => {
    const m = scripted({text: "好"}, {text: "好"}, {text: "好"});
    const s = session(leader, m.model);
    await s.create();
    await s.send("你好");
    await s.send("继续");
    assert.equal(m.seen[0]!.system, m.seen[1]!.system);
    await s.external("nbook.sql", sqlSchemaChanged("tables: chapters, subjects, scenes"));
    await s.external("nbook.workspace/focus", focusChanged("demo", "正文/第3章.md"));
    await s.send("看看这章");
    assert.match(m.seen[2]!.system, /scenes/);
    const reminders = s.pathTo(s.leaf).filter((e) => e.type === "nbook.workspace/reminder/reminder").map((e) => e.data.text);
    assert.deepEqual(reminders, ["当前项目 demo，选中的文件 无", "用户切换到 正文/第3章.md"]);
});

// 15. 输入拦截：改写与拦下
await check("输入拦截：改写后的与原文都记下；拦下时本轮以 input-rejected 结束", async () => {
    const rewrite: ExtensionDef = {id: "demo.rewrite", setup: () => ({intercept: {async input(t, next) {
        if (t.includes("密码")) return;   // 拦下
        await next(t.replace("帮我", ""));
    }}})};
    const s = new Session({profile: writer, plugins: [rewrite], core: [coreHistory], model: () => ({text: "好"}), tools});
    await s.create();
    await s.send("帮我续写");
    const u = s.pathTo(s.leaf).find((e) => e.type === "user")!;
    assert.deepEqual([u.data.text, u.data.original], ["续写", "帮我续写"]);
    await s.send("我的密码是 123");
    assert.equal(s.pathTo(s.leaf).at(-1)!.data.reason, "input-rejected");
});

void fileNotice;
let failed = 0;
for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "通过" : "失败"}  ${r.name}${r.note ? `\n      ${r.note}` : ""}${r.error ? `\n      ${r.error}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
