import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseJsonObject, streamLuna } from "./luna.ts";
import { formatPosition, formatSpan, ledgerState, questionStatus, secretTable, uniqueName, visible } from "./query.ts";
import type { Dataset, Position } from "./schema.ts";

// 尺子：拿一次抽取的图去对 checklist-ch1-20.json 里的关键记录。
// 账本、任务、时间、秘密知情表这些程序能算的直接读图；来源归属、身份、诚实边界这类让模型看筛出的记录判。
// 每条的结论：对、部分、错、缺。另记“已标待核实”：判这一条所依据的记录里有管线标了待核实的（unverified 字段，
// 或模型合并写在说明开头的“待核实”），作答者被要求先读原文核对，这种错和不带标记的错分开数。用法：
//   bun --env-file=<仓库根>/.env check.ts --run <含 dataset-v9.json 的目录> --out <输出目录> [--only L1,S1] [--reuse <旧 results.json>]
// --reuse：模型判的那几条直接沿用旧结果（不再调用模型，结论不会因为重判而变），只重算程序判的部分和待核实标记。

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { run: { type: "string" }, out: { type: "string" }, only: { type: "string" }, checklist: { type: "string" }, reuse: { type: "string" } } });
if (!values.run || !values.out) throw new Error("用法：check.ts --run <目录> --out <目录> [--only 编号,编号]");
const only = values.only ? new Set(values.only.split(",")) : null;

type Verdict = "对" | "部分" | "错" | "缺";
interface ReadAt { chapter: number; paragraph?: number }
type Check =
    | { kind: "ledger-value"; owner?: string; track: string[]; expect: number; op?: "eq" | "lt" }
    | { kind: "ledger-holdings"; owner: string; held: string[][]; notHeld?: string[][] }
    | { kind: "ledger-spends"; owner: string; track: string[]; spends: { amount: number; keywords: string[] }[]; forbidAmounts?: number[]; forbidKeywords?: string[] }
    | { kind: "ledger-task"; owner: string; task: string[]; state: string[]; progress?: string }
    | { kind: "time-relation"; a: Position; b: Position; relation: "same" | "next" }
    | { kind: "secret-table"; secret: string[]; exclude?: string[]; about?: string; rows: { who: string; state: string[]; knowsBasis?: string[] }[] }
    | { kind: "records"; keywords?: string[]; entities?: string[]; expect: string; absentIsCorrect?: boolean };
interface Item { id: string; category: string; readAt: ReadAt; from: string[]; text: string; check: Check }
interface Result { id: string; category: string; kind: string; readAt: string; text: string; verdict: Verdict; detail: string; hits?: string[]; usage?: unknown; flagged?: boolean; flaggedIds?: string[] }
/** 一条核对的结论，连同判它所依据的记录编号（用来查这些记录有没有被标待核实）。 */
type Outcome = Pick<Result, "verdict" | "detail" | "hits" | "usage"> & { ids?: string[] };

const checklist = JSON.parse(await readFile(values.checklist ?? resolve(here, "checklist-ch1-20.json"), "utf8")) as { items: Item[] };
const dataset = JSON.parse(await readFile(resolve(values.run, "dataset-v9.json"), "utf8")) as Dataset;
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const reused = new Map<string, Result>(values.reuse ? (JSON.parse(await readFile(resolve(values.reuse), "utf8")) as { results: Result[] }).results.map(item => [item.id, item]) : []);

const recordById = new Map<string, { unverified?: string; how?: string; reason?: string }>([...dataset.statements, ...dataset.knowledge, ...dataset.ledger].map(item => [item.id, item]));
/** 管线标了待核实的记录：程序合并写 unverified；模型合并（--drafts 2 默认）把“待核实：”写在知情的 how、账本的 reason 开头。
 * 模型合并给说法标的 certainty candidate 不算，规则里它本来就用于没确认的身份，分不出是谁标的。 */
const isFlagged = (id: string): boolean => {
    const record = recordById.get(id);
    return !!record && (!!record.unverified || !!record.how?.startsWith("待核实") || !!record.reason?.startsWith("待核实"));
};

const CHANNEL_ZH: Record<string, string> = { narrator: "旁白", speech: "台词", thought: "心理", document: "文字", author: "作者" };
const KIND_ZH: Record<string, string> = { fact: "事实", claim: "说法", belief: "信念" };
const STATE_ZH: Record<string, string> = { knows: "知道", believes: "相信", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道", "can-infer": "可推断", none: "没有记录" };
const ENTITY_KIND_ZH: Record<string, string> = { person: "人物", persona: "身份", group: "组织", place: "地点", item: "物品", concept: "概念", task: "任务", other: "其他" };

/** “读到第 N 章末”换算成段落位置；章数超出图的范围时取图的末尾。 */
function endOf(readAt: ReadAt): Position {
    if (readAt.paragraph !== undefined) return { chapter: readAt.chapter, paragraph: readAt.paragraph };
    const source = dataset.sources.find(item => item.chapter === readAt.chapter);
    const last = source?.paragraphs.length ?? Math.max(0, ...dataset.beats.filter(item => item.chapter === readAt.chapter).map(item => item.to));
    return { chapter: readAt.chapter, paragraph: last || 1 };
}
const has = (text: string | undefined | null, keywords: string[]): boolean => !!text && keywords.some(keyword => text.includes(keyword));
/** 名字对应的对象编号：此时可见、某个称呼或整理标签里带这个名字的全部对象（本人和马甲都算）。 */
function idsOf(name: string, readAt: Position): Set<string> {
    if (name === "读者") return new Set(["reader"]);
    const exact = dataset.entities.filter(item => visible(item.at, readAt) && item.names.some(entry => visible(entry.at, readAt) && entry.text === name));
    const loose = exact.length ? exact : dataset.entities.filter(item => visible(item.at, readAt) && (item.label.includes(name) || item.names.some(entry => visible(entry.at, readAt) && entry.text.includes(name))));
    return new Set(loose.map(item => item.id));
}
const nameOf = (id: string | null | undefined, readAt: Position): string => {
    if (!id) return "";
    if (id === "reader") return "读者";
    const entity = dataset.entities.find(item => item.id === id);
    return entity ? uniqueName(dataset, entity, readAt) : id;
};
const itemName = (id: string, readAt: Position): string => { const entity = dataset.entities.find(item => item.id === id); return entity ? `${uniqueName(dataset, entity, readAt)} ${entity.label}` : id; };

function checkLedgerValue(check: Extract<Check, { kind: "ledger-value" }>, readAt: Position): Outcome {
    const owners = check.owner ? idsOf(check.owner, readAt) : null;
    const tracks = ledgerState(dataset, readAt).filter(track => (!owners || owners.has(track.owner)) && has(track.track, check.track));
    if (!tracks.length) return { verdict: "缺", detail: "图里没有这个量" };
    const valued = tracks.filter(track => track.value !== undefined);
    if (!valued.length) return { verdict: "缺", detail: `有量“${tracks.map(track => track.track).join("、")}”但没有数值（${tracks.map(track => track.state ?? "无状态").join("、")}）` };
    const track = valued.sort((a, b) => b.entries.length - a.entries.length)[0]!;
    const ok = check.op === "lt" ? track.value! < check.expect : track.value === check.expect;
    return { verdict: ok ? "对" : "错", detail: `${nameOf(track.owner, readAt)} 的“${track.track}”= ${track.value}（${track.entries.length} 笔，最近 ${formatPosition(track.entries.at(-1)!.at)}）`, ids: track.entries.map(entry => entry.id) };
}

function checkHoldings(check: Extract<Check, { kind: "ledger-holdings" }>, readAt: Position): Outcome {
    const owners = idsOf(check.owner, readAt);
    const tracks = ledgerState(dataset, readAt).filter(track => owners.has(track.owner) && track.holdings.length);
    if (!tracks.length) return { verdict: "缺", detail: "图里没有持有物记录" };
    const held = tracks.flatMap(track => track.holdings.filter(entry => entry.count > 0).map(entry => itemName(entry.item, readAt)));
    const found = check.held.filter(keywords => held.some(name => has(name, keywords)));
    const wrong = (check.notHeld ?? []).filter(keywords => held.some(name => has(name, keywords)));
    const detail = `持有：${held.join("、") || "无"}；要求的 ${check.held.length} 项里有 ${found.length} 项${wrong.length ? `；不该持有却持有：${wrong.map(keywords => keywords[0]).join("、")}` : ""}`;
    const ids = tracks.flatMap(track => track.entries.filter(entry => entry.item).map(entry => entry.id));
    if (wrong.length) return { verdict: "错", detail, ids };
    if (found.length === check.held.length) return { verdict: "对", detail, ids };
    return { verdict: found.length ? "部分" : "缺", detail, ids };
}

const SPEND_OPS = new Set(["spend", "lose", "use"]);
function checkSpends(check: Extract<Check, { kind: "ledger-spends" }>, readAt: Position): Outcome {
    const owners = idsOf(check.owner, readAt);
    const entries = dataset.ledger.filter(item => visible(item.at, readAt) && owners.has(item.owner) && has(item.track, check.track)).sort((a, b) => a.at.chapter - b.at.chapter || a.at.paragraph - b.at.paragraph);
    const describe = (entry: typeof entries[number]) => `${formatPosition(entry.at)} ${entry.op} ${entry.amount ?? entry.value ?? ""} ${entry.item ? itemName(entry.item, readAt) : ""} ${entry.reason}`.trim();
    const textOf = (entry: typeof entries[number]) => `${entry.item ? itemName(entry.item, readAt) : ""} ${entry.reason} ${entry.track}`;
    const spends = entries.filter(entry => SPEND_OPS.has(entry.op) && entry.amount !== undefined);
    const forbiddenAmount = spends.filter(entry => (check.forbidAmounts ?? []).includes(entry.amount!));
    const forbiddenText = entries.filter(entry => has(textOf(entry), check.forbidKeywords ?? []));
    // 一笔购买可能记成“神典石 spend 500”，也可能只记成“道具 get 探查器（花费 500）”，还可能只记了得到道具没写价钱。
    // 前两种算对上，第三种算对了一半：道具在、价钱不在。
    const gets = dataset.ledger.filter(item => visible(item.at, readAt) && owners.has(item.owner) && (item.op === "get" || item.op === "gain"));
    const used = new Set<string>();
    let full = 0, half = 0;
    for (const expected of check.spends) {
        const spend = spends.find(entry => !used.has(entry.id) && entry.amount === expected.amount && (!expected.keywords.length || has(textOf(entry), expected.keywords)));
        const get = gets.find(entry => !used.has(entry.id) && has(textOf(entry), expected.keywords));
        if (spend) { used.add(spend.id); full++; }
        else if (get) { used.add(get.id); if (get.reason.includes(String(expected.amount))) full++; else half++; }
    }
    const detail = `支出 ${spends.length} 笔：${spends.map(describe).join("；") || "无"}。要求的 ${check.spends.length} 笔里对上 ${full} 笔${half ? `，另有 ${half} 笔只记了得到道具没记价钱` : ""}${forbiddenAmount.length ? `；不该有的金额：${forbiddenAmount.map(describe).join("；")}` : ""}${forbiddenText.length ? `；不该有的记录：${forbiddenText.map(describe).join("；")}` : ""}`;
    const ids = [...used, ...forbiddenAmount.map(entry => entry.id), ...forbiddenText.map(entry => entry.id)];
    if (forbiddenAmount.length || forbiddenText.length) return { verdict: "错", detail, ids };
    if (!check.spends.length) return { verdict: "对", detail, ids };
    if (full === check.spends.length) return { verdict: "对", detail, ids };
    if (!full && !half) return { verdict: spends.length ? "错" : "缺", detail, ids: spends.map(entry => entry.id) };
    return { verdict: "部分", detail, ids };
}

function checkTask(check: Extract<Check, { kind: "ledger-task" }>, readAt: Position): Outcome {
    const owners = idsOf(check.owner, readAt);
    const tracks = ledgerState(dataset, readAt).filter(track => owners.has(track.owner) && has(track.track, check.task));
    if (!tracks.length) return { verdict: "缺", detail: "图里没有这个任务的量" };
    const states = tracks.map(track => `${track.track}：${track.state ?? (track.value !== undefined ? String(track.value) : "无")}`);
    const stateOf = (track: typeof tracks[number]) => track.state ?? String(track.value ?? "");
    const stateOk = tracks.some(track => has(stateOf(track), check.state));
    // 进度数字（0/10）常被模型省掉，状态对、进度缺算部分，不算错。
    const progressOk = !check.progress || tracks.some(track => stateOf(track).includes(check.progress!));
    return { verdict: stateOk && progressOk ? "对" : stateOk ? "部分" : "错", detail: states.join("；"), ids: tracks.map(track => track.entries.at(-1)!.id) };
}

function dayAt(position: Position): { day?: number; detail: string } {
    const beat = dataset.beats.find(item => item.chapter === position.chapter && item.from <= position.paragraph && position.paragraph <= item.to);
    if (!beat) return { detail: `${formatPosition(position)} 没有段落块` };
    const time = beat.time ? dataset.times.find(item => item.id === beat.time) : undefined;
    if (!time) return { detail: `${formatPosition(position)} 的段落块没有时间点` };
    return { day: time.day, detail: `${formatPosition(position)}→${time.id} 第 ${time.day ?? "?"} 天${time.part ? ` ${time.part}` : ""}` };
}
function checkTime(check: Extract<Check, { kind: "time-relation" }>): Outcome {
    const a = dayAt(check.a), b = dayAt(check.b);
    const detail = `${a.detail}；${b.detail}`;
    if (a.day === undefined || b.day === undefined) return { verdict: "缺", detail };
    const ok = check.relation === "same" ? a.day === b.day : b.day === a.day + 1;
    return { verdict: ok ? "对" : "错", detail };
}

function checkSecret(check: Extract<Check, { kind: "secret-table" }>, readAt: Position): Outcome {
    const aboutIds = check.about ? idsOf(check.about, readAt) : null;
    const secrets = dataset.secrets.filter(secret => visible(secret.at, readAt) && has(secret.title, check.secret) && !has(secret.title, check.exclude ?? []) && (!aboutIds || secret.about.some(id => aboutIds.has(id))));
    if (!secrets.length) return { verdict: "缺", detail: `图里没有这个秘密（此时可见的秘密：${dataset.secrets.filter(secret => visible(secret.at, readAt)).map(secret => secret.title).join("；") || "无"}）` };
    let best: { score: number; verdict: Verdict; detail: string; ids: string[] } | null = null;
    for (const secret of secrets) {
        const peopleIds = check.rows.flatMap(row => [...idsOf(row.who, readAt)]);
        const table = secretTable(dataset, secret, readAt, peopleIds);
        const lines: string[] = [], sources: string[] = [];
        let ok = 0, wrong = 0, missing = 0;
        for (const row of check.rows) {
            const ids = idsOf(row.who, readAt);
            const rows = table.filter(entry => ids.has(entry.who));
            // 本人和马甲可能各有一行，取有记录的那一行；都没有记录就是缺。
            const found = rows.find(entry => entry.state !== "none") ?? rows[0];
            if (!found || found.state === "none") { missing++; lines.push(`${row.who}：没有记录（要求 ${row.state.map(state => STATE_ZH[state] ?? state).join("/")}）`); continue; }
            // 表里这一行取自哪条知情记录，取法与 secretTable 一致：明写的优先，取最新的一条。
            const written = found.history.filter(entry => !entry.derived);
            const source = (written.length ? written : found.history).at(-1);
            if (source) sources.push(source.id);
            // knowsBasis 限定“知道”只能是推断出来的（例如秘典知不知道她是重生者，原文没有明写）；怀疑、相信不受限。
            const stateOk = row.state.includes(found.state), basisOk = found.state !== "knows" || !row.knowsBasis || row.knowsBasis.includes(found.basis);
            if (stateOk && basisOk) ok++; else wrong++;
            lines.push(`${row.who}：${STATE_ZH[found.state] ?? found.state}${found.basis === "inferred" ? "（推断）" : ""}${found.how ? `，${found.how}` : ""}（要求 ${row.state.map(state => STATE_ZH[state] ?? state).join("/")}${row.knowsBasis ? `，知道须为${row.knowsBasis.join("/")}` : ""}）${stateOk && basisOk ? "" : " ←不符"}`);
        }
        const verdict: Verdict = wrong ? "错" : ok === check.rows.length ? "对" : ok ? "部分" : "缺";
        const score = ok * 2 - wrong * 2 - missing;
        if (!best || score > best.score) best = { score, verdict, detail: `秘密“${secret.title}”：${lines.join("；")}`, ids: sources };
    }
    return { verdict: best!.verdict, detail: best!.detail, ids: best!.ids };
}

/** 此时可见、文字里带关键词（或与指定对象有关）的记录，排成模型能读的行。 */
function collectRecords(check: Extract<Check, { kind: "records" }>, readAt: Position): { id: string; line: string }[] {
    const keywords = check.keywords ?? [];
    const entityIds = new Set((check.entities ?? []).flatMap(name => [...idsOf(name, readAt)]));
    const matchText = (text: string) => !keywords.length || has(text, keywords);
    const matchEntity = (ids: (string | null | undefined)[]) => !entityIds.size || ids.some(id => id && entityIds.has(id));
    const lines: { id: string; line: string }[] = [];
    for (const item of dataset.entities) {
        if (!visible(item.at, readAt)) continue;
        const names = item.names.filter(name => visible(name.at, readAt)).map(name => name.note ? `${name.text}（${name.note}）` : name.text);
        if (!(matchText(`${item.label} ${names.join(" ")}`) && matchEntity([item.id]))) continue;
        lines.push({ id: item.id, line: `${item.id}　[对象·${ENTITY_KIND_ZH[item.kind] ?? item.kind}] ${item.label}｜称呼：${names.join("、") || "无"}` });
    }
    for (const item of dataset.statements) {
        if (!visible(item.at, readAt)) continue;
        if (!(matchText(item.text) && matchEntity([...item.about, item.holder, item.source.by]))) continue;
        const source = `${CHANNEL_ZH[item.source.channel] ?? item.source.channel}${item.source.by ? `，出自 ${nameOf(item.source.by, readAt)}` : ""}${item.source.to.length ? `，对 ${item.source.to.map(id => nameOf(id, readAt)).join("、")}` : ""}${item.source.mode !== "assert" ? `，${item.source.mode}` : ""}`;
        lines.push({ id: item.id, line: `${item.id}　[说法] ${item.text}｜来源：${source}｜类型：${KIND_ZH[item.kind] ?? item.kind}${item.holder ? `（持有人 ${nameOf(item.holder, readAt)}）` : ""}｜${item.basis === "inferred" ? "推断" : "明说"}${item.neg ? "｜否定" : ""}${item.certainty !== "certain" ? "｜存疑" : ""}${item.secret ? `｜秘密 ${item.secret}` : ""}｜出处 ${item.source.evidence.map(formatSpan).join("、")}` });
    }
    for (const item of dataset.secrets) {
        if (!visible(item.at, readAt)) continue;
        if (!(matchText(item.title) && matchEntity(item.about))) continue;
        lines.push({ id: item.id, line: `${item.id}　[秘密] ${item.title}（${item.about.map(id => nameOf(id, readAt)).join("、")}）` });
    }
    for (const item of dataset.knowledge) {
        if (!visible(item.at, readAt) || item.derived) continue;
        const target = dataset.secrets.find(secret => secret.id === item.about)?.title ?? dataset.statements.find(statement => statement.id === item.about)?.text ?? item.about;
        if (!(matchText(`${target} ${item.how ?? ""}`) && matchEntity([item.who]))) continue;
        lines.push({ id: item.id, line: `${item.id}　[知情] ${nameOf(item.who, readAt)} 对“${target}”：${STATE_ZH[item.state] ?? item.state}${item.how ? `，${item.how}` : ""}｜${item.basis === "inferred" ? "推断" : "明说"}｜出处 ${item.evidence.map(formatSpan).join("、")}` });
    }
    for (const item of dataset.questions) {
        if (!visible(item.at, readAt)) continue;
        if (!(matchText(item.text) && matchEntity(item.about))) continue;
        const status = questionStatus(item, readAt);
        const updates = status.updates.map(update => `${formatPosition(update.at)} ${update.type === "answered" ? "解答" : update.type === "partial" ? "部分解答" : "再提起"}${update.note ? `：${update.note}` : ""}`);
        lines.push({ id: item.id, line: `${item.id}　[疑问] ${item.text}（${formatPosition(item.at)} 提出，${status.state === "answered" ? "已解答" : status.state === "partial" ? "部分解答" : "未解"}）${updates.length ? `｜进展：${updates.join("；")}` : ""}` });
    }
    for (const item of dataset.ledger) {
        if (!visible(item.at, readAt)) continue;
        const text = `${item.track} ${item.reason} ${item.item ? itemName(item.item, readAt) : ""}`;
        if (!(matchText(text) && matchEntity([item.owner, item.item]))) continue;
        lines.push({ id: item.id, line: `${item.id}　[账本] ${nameOf(item.owner, readAt)} 的“${item.track}”${item.op} ${item.amount ?? item.value ?? ""}${item.item ? ` ${itemName(item.item, readAt)}` : ""}｜${item.reason}｜出处 ${item.evidence.map(formatSpan).join("、")}` });
    }
    for (const item of dataset.episodes) {
        if (!visible(item.at, readAt)) continue;
        if (!(matchText(`${item.title} ${item.summary} ${item.outcome ?? ""}`) && matchEntity(item.who.flatMap(who => [who.e, who.as])))) continue;
        lines.push({ id: item.id, line: `${item.id}　[情节] ${item.title}：${item.summary}${item.outcome ? `｜结果：${item.outcome}` : ""}｜出处 ${item.evidence.map(formatSpan).join("、")}` });
    }
    return lines.slice(0, 80);
}

const judgeSystem = `你是记忆图的核对员。给你一条应当成立的核对项，和记忆图里与它有关的记录（已按读者读到的位置筛过，只有此前可见的记录）。记录里的“来源”是这句话在原文里由谁、以什么方式说出；“类型”是程序登记的断言类型：事实＝旁白确认，说法＝某人说的，信念＝某人心里的看法。
归属看文字和来源两处：说法文字里已经写明“按某人的说法”“某人认为、认定、猜测”“她所说的”的，归属就算清楚，不因为类型一栏标成“事实”就判错；只有文字和来源都把别人的话、角色的判断当成不带归属的事实时才算错。
判断只有四种：
- 对：记录明确支持核对项（核对项要求“不应有”的，图里确实没有或明说没有也算对）；
- 部分：有相关记录但只支持一部分，或措辞含糊、没分清来源；
- 错：有记录与核对项相反，例如把猜测记成事实、把说话人记成另一个人、记了不该有的内容；
- 缺：没有与核对项相关的记录。
只输出 JSON：{"verdict":"对|部分|错|缺","reason":"一句话说明依据，引用记录编号","hits":["支持或违反核对项的记录编号"]}`;

async function judgeRecords(item: Item, check: Extract<Check, { kind: "records" }>, readAt: Position): Promise<Outcome> {
    const records = collectRecords(check, readAt);
    await writeFile(resolve(out, `records-${item.id}.txt`), `${records.map(record => record.line).join("\n")}\n`);
    if (!records.length) return check.absentIsCorrect ? { verdict: "对", detail: "没有相关记录，而核对项要求的正是没有" } : { verdict: "缺", detail: "没有与关键词相关的记录" };
    const user = `【核对项】读到 ${formatPosition(readAt)} 为止：${item.text}\n【判断标准】${check.expect}\n\n【记忆图里的相关记录】\n${records.map(record => record.line).join("\n")}`;
    const result = await streamLuna([{ role: "system", content: judgeSystem }, { role: "user", content: user }], { maxTokens: 800, effort: "minimal", json: true });
    if (result.error || !result.content) return { verdict: "缺", detail: `判定失败：${result.error ?? "空回复"}`, usage: result.usage };
    let parsed: { verdict?: string; reason?: string; hits?: string[] };
    try { parsed = parseJsonObject(result.content); } catch { return { verdict: "缺", detail: `判定回复不是 JSON：${result.content.slice(0, 120)}`, usage: result.usage }; }
    const verdict = (["对", "部分", "错", "缺"] as Verdict[]).find(option => option === parsed.verdict) ?? "缺";
    return { verdict, detail: parsed.reason ?? "", hits: parsed.hits ?? [], usage: result.usage };
}

const results: Result[] = [];
let cost = 0;
for (const item of checklist.items) {
    if (only && !only.has(item.id)) continue;
    const readAt = endOf(item.readAt);
    const check = item.check;
    let outcome: Outcome;
    const previous = reused.get(item.id);
    try {
        if (check.kind === "ledger-value") outcome = checkLedgerValue(check, readAt);
        else if (check.kind === "ledger-holdings") outcome = checkHoldings(check, readAt);
        else if (check.kind === "ledger-spends") outcome = checkSpends(check, readAt);
        else if (check.kind === "ledger-task") outcome = checkTask(check, readAt);
        else if (check.kind === "time-relation") outcome = checkTime(check);
        else if (check.kind === "secret-table") outcome = checkSecret(check, readAt);
        else if (previous) outcome = { verdict: previous.verdict, detail: previous.detail, hits: previous.hits, usage: previous.usage, ids: previous.hits };
        else { outcome = await judgeRecords(item, check, readAt); outcome.ids = outcome.hits; }
    } catch (error) {
        outcome = { verdict: "缺", detail: `核对程序出错：${String(error)}` };
    }
    if (previous && previous.verdict !== outcome.verdict) console.error(`${item.id}：沿用旧结果时程序判的结论变了（${previous.verdict} → ${outcome.verdict}）`);
    const usage = previous ? undefined : outcome.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
    if (usage) cost += ((usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0)) * 1 / 1e6 + (usage.prompt_tokens_details?.cached_tokens ?? 0) * 0.02 / 1e6 + (usage.completion_tokens ?? 0) * 4 / 1e6;
    const { ids, ...kept } = outcome;
    const flaggedIds = (ids ?? []).filter(isFlagged);
    results.push({ id: item.id, category: item.category, kind: check.kind, readAt: formatPosition(readAt), text: item.text, ...kept, flagged: flaggedIds.length > 0, flaggedIds });
    console.log(`${item.id}\t${outcome.verdict}${flaggedIds.length ? "（已标待核实）" : ""}\t${outcome.detail.slice(0, 160)}`);
}

const count = (verdict: Verdict) => results.filter(item => item.verdict === verdict).length;
const flaggedCount = (verdict: Verdict) => results.filter(item => item.verdict === verdict && item.flagged).length;
const byCategory = Object.fromEntries([...new Set(results.map(item => item.category))].map(category => {
    const items = results.filter(item => item.category === category);
    return [category, { 总数: items.length, 对: items.filter(item => item.verdict === "对").length, 部分: items.filter(item => item.verdict === "部分").length, 错: items.filter(item => item.verdict === "错").length, 缺: items.filter(item => item.verdict === "缺").length }];
}));
const summary = { run: resolve(values.run), items: results.length, 对: count("对"), 部分: count("部分"), 错: count("错"), 缺: count("缺"), 已标待核实: { 对: flaggedCount("对"), 部分: flaggedCount("部分"), 错: flaggedCount("错") }, byCategory, judgeCostYuan: Number(cost.toFixed(4)) };
await writeFile(resolve(out, "results.json"), `${JSON.stringify({ summary, results }, null, 1)}\n`);
const table = ["| 编号 | 类别 | 读到 | 核对项 | 结论 | 说明 |", "| --- | --- | --- | --- | --- | --- |", ...results.map(item => `| ${item.id} | ${item.category} | ${item.readAt} | ${item.text} | ${item.verdict}${item.flagged ? "（已标待核实）" : ""} | ${item.detail.replace(/\|/g, "／").replace(/\n/g, " ")} |`)];
const flags = summary.已标待核实;
await writeFile(resolve(out, "results.md"), `# 尺子核对结果\n\n图：\`${summary.run}\`\n\n${results.length} 条：对 ${summary.对}、部分 ${summary.部分}、错 ${summary.错}、缺 ${summary.缺}；依据记录里有标了待核实的：对 ${flags.对}、部分 ${flags.部分}、错 ${flags.错}；模型判定费用 ${summary.judgeCostYuan} 元。\n\n${table.join("\n")}\n`);
console.log(JSON.stringify(summary));
