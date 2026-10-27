/**
 * t28：给样例书前 20 章的记录标重要程度（1 到 3 级），比较两遍的稳定性与同结构信号的相关。
 *
 *   bun tier-label.ts --dry                      只构造提示词、估算 token，不发请求
 *   bun tier-label.ts --run 1                    标第一遍，结果写 results/run-1.json
 *   bun tier-label.ts --run 2                    标第二遍
 *   bun tier-label.ts --analyze                  读两遍的结果出报告
 *
 * 端点与密钥只从环境变量读：TIER_BASE_URL（OpenAI 兼容的 /v1 地址）、TIER_MODEL、TIER_API_KEY。不读任何配置文件。
 */

import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {smallDataset} from "../../../../../../packages/nb-story/testing/sample";

const CHAPTERS = 20;
const BATCH = 40;
const HERE = import.meta.dir;
const RESULTS = join(HERE, "..", "results");

type Item = {id: string; kind: "entity" | "statement" | "episode"; chapter: number; text: string};

async function items(): Promise<{items: Item[]; summaries: Map<number, string>}> {
    const d = await smallDataset(CHAPTERS, "tier");
    const out: Item[] = [];
    for (const e of d.entities) out.push({id: e.id, kind: "entity", chapter: e.at.chapter, text: `${e.kind} ${e.label}${e.names.length ? `（${e.names.slice(0, 4).map((n: {text: string}) => n.text).join("、")}）` : ""}`});
    for (const s of d.statements) out.push({id: s.id, kind: "statement", chapter: s.at.chapter, text: `${s.family} ${s.text}`});
    for (const ep of d.episodes) out.push({id: ep.id, kind: "episode", chapter: ep.at.chapter, text: `${ep.title}：${ep.summary}`});
    const summaries = new Map<number, string>();
    for (const s of d.summaries ?? []) summaries.set((s as {at: {chapter: number}}).at.chapter, String((s as {text?: string}).text ?? ""));
    return {items: out, summaries};
}

function batches(all: Item[], seed: number): Item[][] {
    // 按章分组，章内按固定的伪随机顺序打乱（两遍用不同的种子），每批至多 BATCH 条。
    const byChapter = new Map<number, Item[]>();
    for (const item of all) byChapter.set(item.chapter, [...(byChapter.get(item.chapter) ?? []), item]);
    let state = seed;
    const rand = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const result: Item[][] = [];
    for (const [, list] of [...byChapter].sort((a, b) => a[0] - b[0])) {
        const shuffled = [...list].sort(() => rand() - 0.5);
        for (let i = 0; i < shuffled.length; i += BATCH) result.push(shuffled.slice(i, i + BATCH));
    }
    return result;
}

function prompt(batch: Item[], summary: string): string {
    return [
        "下面是一部小说的记忆图里的一批记录（对象、说法、情节）。请给每一条标重要程度：",
        "1 = 主线必需：理解剧情、人物关系或后文伏笔离不开它；",
        "2 = 有用：补充背景或人物性格，问到时有帮助；",
        "3 = 琐碎：一次性的细节，后面几乎不会用到。",
        "整体上 1 级应当是少数。只返回 JSON 数组，每项形如 {\"id\":\"...\",\"tier\":1}，不要解释。",
        summary === "" ? "" : `\n本章概要：${summary}`,
        "\n记录：",
        ...batch.map(item => `${item.id} [${item.kind}] ${item.text}`),
    ].join("\n");
}

async function call(content: string): Promise<{text: string; input: number; output: number}> {
    const base = process.env.TIER_BASE_URL;
    const model = process.env.TIER_MODEL;
    const key = process.env.TIER_API_KEY;
    if (!base || !model || !key) throw new Error("需要环境变量 TIER_BASE_URL、TIER_MODEL、TIER_API_KEY");
    const response = await fetch(`${base.replace(/\/$/u, "")}/chat/completions`, {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${key}`},
        body: JSON.stringify({model, temperature: 0, messages: [{role: "user", content}]}),
    });
    if (!response.ok) throw new Error(`请求失败 ${response.status}：${(await response.text()).slice(0, 200)}`);
    const json = (await response.json()) as {choices: {message: {content: string}}[]; usage?: {prompt_tokens?: number; completion_tokens?: number}};
    return {text: json.choices[0]!.message.content, input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0};
}

const approxTokens = (text: string) => Math.ceil(text.length * 0.7);

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const {items: all, summaries} = await items();
    if (args.includes("--dry")) {
        const bs = batches(all, 1);
        const tokens = bs.reduce((sum, b) => sum + approxTokens(prompt(b, summaries.get(b[0]!.chapter) ?? "")), 0);
        console.log(`记录 ${all.length} 条（对象 ${all.filter(i => i.kind === "entity").length}、说法 ${all.filter(i => i.kind === "statement").length}、情节 ${all.filter(i => i.kind === "episode").length}），${bs.length} 批，每遍输入约 ${tokens} token（粗估）`);
        console.log("第一批提示词前 600 字：\n" + prompt(bs[0]!, summaries.get(bs[0]![0]!.chapter) ?? "").slice(0, 600));
        return;
    }
    const run = args.indexOf("--run");
    if (run >= 0) {
        const n = Number(args[run + 1]);
        const budget = Number(args[args.indexOf("--budget-yuan") + 1] || 3);
        await mkdir(RESULTS, {recursive: true});
        const tiers: Record<string, number> = {};
        let input = 0;
        let output = 0;
        for (const batch of batches(all, n)) {
            const reply = await call(prompt(batch, summaries.get(batch[0]!.chapter) ?? ""));
            input += reply.input;
            output += reply.output;
            // 低谷价（deepseek-flash）粗算：输入 ¥1/M，输出 ¥4/M。
            if ((input * 1 + output * 4) / 1e6 > budget) throw new Error(`超过预算 ¥${budget}，已停下（输入 ${input}、输出 ${output} token）`);
            const match = /\[[\s\S]*\]/u.exec(reply.text);
            if (!match) {
                console.error(`这一批没有解析出 JSON，跳过：${batch[0]!.id}…`);
                continue;
            }
            for (const row of JSON.parse(match[0]) as {id: string; tier: number}[]) if ([1, 2, 3].includes(row.tier)) tiers[row.id] = row.tier;
        }
        await writeFile(join(RESULTS, `run-${n}.json`), JSON.stringify({tiers, input, output}, null, 1));
        console.log(`第 ${n} 遍：标了 ${Object.keys(tiers).length} / ${all.length} 条，输入 ${input}、输出 ${output} token，约 ¥${((input * 1 + output * 4) / 1e6).toFixed(2)}`);
        return;
    }
    if (args.includes("--analyze")) {
        const a = JSON.parse(await readFile(join(RESULTS, "run-1.json"), "utf8")) as {tiers: Record<string, number>};
        const b = JSON.parse(await readFile(join(RESULTS, "run-2.json"), "utf8")) as {tiers: Record<string, number>};
        const both = all.filter(item => a.tiers[item.id] !== undefined && b.tiers[item.id] !== undefined);
        const dist = (t: Record<string, number>) => [1, 2, 3].map(k => both.filter(item => t[item.id] === k).length);
        const same = both.filter(item => a.tiers[item.id] === b.tiers[item.id]).length;
        // 加权 κ（线性权重）
        const k = 3;
        const obs = Array.from({length: k}, () => new Array<number>(k).fill(0));
        for (const item of both) obs[a.tiers[item.id]! - 1]![b.tiers[item.id]! - 1]! += 1;
        const rows = obs.map(r => r.reduce((s, x) => s + x, 0));
        const cols = obs[0]!.map((_, j) => obs.reduce((s, r) => s + r[j]!, 0));
        let num = 0;
        let den = 0;
        for (let i = 0; i < k; i += 1) for (let j = 0; j < k; j += 1) {
            const w = Math.abs(i - j) / (k - 1);
            num += w * obs[i]![j]!;
            den += w * ((rows[i]! * cols[j]!) / both.length);
        }
        console.log(`有效 ${both.length} / ${all.length} 条`);
        console.log(`第一遍分布 1/2/3：${dist(a.tiers).join("/")}；第二遍：${dist(b.tiers).join("/")}`);
        console.log(`完全一致 ${((same / both.length) * 100).toFixed(1)}%，加权 κ ${(1 - num / den).toFixed(3)}`);
        const keep = both.filter(item => Math.min(a.tiers[item.id]!, b.tiers[item.id]!) <= 2).length;
        console.log(`两遍都不是 3 级的占 ${((keep / both.length) * 100).toFixed(1)}%（只留 1、2 级的记录比例）`);
        return;
    }
    console.log("用法见文件头");
}

await main();
