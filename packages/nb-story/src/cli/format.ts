/**
 * 给人读的输出：每个方法一个格式化函数。出处一律写成“章.段”（docs/specs/story/cli-skill.md 输出 2）。
 * 这里只排版方法结果，不另外过滤或补数据。
 */

import type {Awareness, StoryMethod, StoryResult, Tags} from "../contract/contract";

const STATE_WORDS: Record<Awareness, string> = {knows: "知道", believes: "认为", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道", "no-record": "没有记录"};
const QUESTION_WORDS = {open: "未解", partial: "有进展", answered: "已解"} as const;
const TRACK_WORDS = {resource: "资源", task: "任务", item: "道具"} as const;
const IDENTITY_WORDS = {uncertain: "可能是同一人", unaware: "其实是同一人（不知道）", heard: "其实是同一人（听说）", believes: "其实是同一人（认为）", suspects: "其实是同一人（怀疑）", "no-record": "可能知道（没有记录）"} as const;

function tagText(tags: Tags | null): string {
    if (!tags) return "";
    const kind = tags.kind === "fact" ? "明说" : tags.kind === "claim" ? "角色的说法" : tags.kind === "belief" ? "角色认为" : "";
    return [kind, tags.inferred ? "推断" : ""].filter(Boolean).join("、");
}

function at(refs: readonly string[]): string {
    return refs.length > 0 ? `〔${refs.join("，")}〕` : "";
}

function pageFooter(result: {total: number; items: unknown[]; next: string | null}): string[] {
    return [`共 ${result.total} 条，本页 ${result.items.length} 条${result.next ? `；下一页：--cursor ${result.next}` : ""}`];
}

type Formatter<M extends StoryMethod> = (result: StoryResult<M>) => string[];

const FORMATTERS: {[M in StoryMethod]?: Formatter<M>} = {
    "books.list": result => (result.books.length === 0 ? ["书库里还没有书"] : result.books.map(book => `${book.id}  ${book.title}  ${book.chapters} 章，抽取到 ${book.extractedThrough.chapter}.${book.extractedThrough.paragraph}`)),
    "book.import": result => [`已导入：${result.id}`],
    "book.remove": () => ["已删除"],
    "book.info": result => [
        `${result.title}（${result.id}）`,
        `来源：${result.source.title}，${result.source.file}`,
        `共 ${result.chapters} 章，抽取到 ${result.extractedThrough.chapter}.${result.extractedThrough.paragraph}；阅读位置 ${result.at.chapter}.${result.at.paragraph}`,
        "目录：",
        ...result.toc.map(item => `  ${item.chapter}  ${item.title ?? "（未读）"}`),
    ],
    "book.stats": result => [
        `到 ${result.at.chapter}.${result.at.paragraph} 为止的可见记录：`,
        ...Object.entries(result.visible).map(([key, count]) => `  ${key}  ${count}`),
        "全书抽取统计（全书的，不随阅读位置变）：",
        ...Object.entries(result.extraction.written).map(([key, count]) => `  草稿写了 ${key}  ${count}`),
        ...Object.entries(result.extraction.generated).map(([key, count]) => `  程序生成 ${key}  ${count}`),
    ],
    "chapter.digest": result => [
        result.title,
        "情节：",
        ...result.episodes.map(item => `  ${item.title}：${item.summary} ${at(item.refs)}`),
        ...(result.newEntities.length ? ["新出现：", `  ${result.newEntities.map(item => `${item.label}〔${item.ref}〕`).join("、")}`] : []),
        ...(result.revealedSecrets.length ? ["揭晓的秘密：", ...result.revealedSecrets.map(item => `  ${item.title}〔${item.ref}〕`)] : []),
        ...(result.ledger.length ? ["数值变动：", ...result.ledger.map(item => `  ${item.owner.label} ${item.track} ${item.change === null ? "" : item.change > 0 ? `+${item.change}` : item.change}${item.value === null ? "" : ` → ${item.value}`}〔${item.ref}〕`)] : []),
        ...(result.questions.raised.length ? ["新悬念：", ...result.questions.raised.map(item => `  ${item.text}〔${item.ref}〕`)] : []),
        ...(result.questions.progressed.length ? ["悬念进展：", ...result.questions.progressed.map(item => `  ${item.text}（${item.type === "answered" ? "已解" : "有进展"}）〔${item.ref}〕`)] : []),
    ],
    "entities.list": result => [
        ...result.items.map(item => `${item.id}  ${item.label}（${item.kind}，出场 ${item.mentions}）称呼：${item.names.top.join("、")}${item.names.total > item.names.top.length ? ` 等 ${item.names.total} 个` : ""}${item.entities.length > 1 ? `；同一身份：${item.entities.join("、")}` : ""}`),
        ...pageFooter(result),
    ],
    "entity.card": result => [
        `${result.label}（${result.id}，${result.kind}）`,
        `称呼：${result.names.map(name => `${name.text}〔${name.ref}〕`).join("、")}`,
        ...(result.identities.length ? [`同一身份：${result.identities.map(item => `${item.label}（${item.id}）〔${item.ref}〕`).join("、")}`] : []),
        ...result.facets.map(facet => `${facet.facet}（到第 ${facet.through} 章）：${facet.items.join(" ")}`),
        "秘密：",
        ...result.secrets.map(item => `  ${item.title}：${STATE_WORDS[item.state]}${item.ref ? `〔${item.ref}〕` : ""}`),
        `条数：关系 ${result.counts.relations}，知情 ${result.counts.knowledge}，说法 ${result.counts.statements}，情节 ${result.counts.episodes}`,
    ],
    "entity.knowledge": result => [...result.items.map(item => `${STATE_WORDS[item.state]}：${item.text}${item.how ? `（${item.how}）` : ""} [${tagText(item.tags)}${item.secret ? "、秘密" : ""}] ${at(item.refs)}`), ...pageFooter(result)],
    "entity.statements": result => [...result.items.map(item => `${item.text} [${tagText(item.tags)}] ${at(item.refs)}`), ...pageFooter(result)],
    "entity.episodes": result => [...result.items.map(item => `第 ${item.chapter} 章  ${item.title} ${at(item.refs)}`), ...pageFooter(result)],
    "secrets.matrix": result =>
        result.rows.flatMap(row => [
            `${row.title}（${row.id}）`,
            ...row.cells.map(cell => {
                const column = result.columns.find(item => item.id === cell.column)!;
                const name = column.aliases.length ? `${column.label}（${column.aliases.join("、")}）` : column.label;
                return `  ${name}：${STATE_WORDS[cell.state]}${cell.how ? `，${cell.how}` : ""}${cell.ref ? `〔${cell.ref}〕` : ""}`;
            }),
        ]),
    "graph.relations": result => [
        ...(result.view.perspective === "reader" ? [] : [`视角 ${result.view.perspective}：用了 ${result.view.statements} 条说法`]),
        ...result.edges.map(edge => {
            const label = (id: string) => result.nodes.find(node => node.id === id)?.label ?? id;
            const parts = [
                edge.relation ? `关系${edge.relation.word ? `“${edge.relation.word}”` : ""} ${edge.relation.statements} 条` : "",
                edge.together ? `同场 ${edge.together} 次` : "",
                edge.knows && (edge.knows.ab || edge.knows.ba) ? `认知 ${edge.knows.ab}/${edge.knows.ba}` : "",
                edge.identity ? IDENTITY_WORDS[edge.identity] : "",
            ].filter(Boolean);
            return `${label(edge.a)} — ${label(edge.b)}：${parts.join("，")}`;
        }),
    ],
    "ledger.tracks": result => result.tracks.map(track => `${track.owner.label} ${track.name}（${TRACK_WORDS[track.kind]}）：${track.current ?? "—"}${track.relative ? "（相对值）" : ""}${track.mismatches ? `，${track.mismatches} 处与原文对不上` : ""}〔${track.lastRef}〕`),
    "ledger.track": result => [
        `${result.track.owner.label} ${result.track.name}：${result.track.current ?? "—"}${result.track.relative ? "（相对值）" : ""}`,
        ...result.entries.map(entry => {
            const change = entry.change === null ? "" : entry.change > 0 ? `+${entry.change}` : String(entry.change);
            const balance = entry.balance === null ? (entry.value ?? "") : `${entry.relative ? "相对 " : ""}${entry.balance}`;
            const gap = entry.gap ? `（原文比累加${entry.gap > 0 ? "多" : "少"} ${Math.abs(entry.gap)}）` : "";
            return `  ${entry.op} ${change} → ${balance}${gap} ${entry.reason} ${at(entry.refs)}`;
        }),
    ],
    "questions.list": result => [
        ...result.items.flatMap(item => [
            `${item.text}（${QUESTION_WORDS[item.state]}${item.trivial ? "，琐碎" : ""}）提出 ${at(item.raised.refs)}`,
            ...item.updates.filter(update => update.type !== "raised").map(update => `  ${update.type === "answered" ? "解答" : "进展"}：${update.answer ?? update.note ?? ""} ${at(update.refs)}`),
        ]),
        ...pageFooter(result),
    ],
    timeline: result =>
        result.points.flatMap(point => [
            `${point.day === null ? "日子不明" : `第 ${point.day} 天`}${point.part ? ` ${point.part}` : ""}${point.clock ? ` ${point.clock}` : ""}  ${point.label}${point.relative ? `（${point.relative}）` : ""}${point.flashback ? `  第 ${point.flashback} 章补叙` : ""} ${at(point.refs)}`,
            ...point.episodes.map(episode => `  情节 ${episode.id} ${episode.title}（${episode.who.map(who => who.label).join("、")}${episode.place ? `；${episode.place.label}` : ""}）`),
        ]),
    "episodes.list": result => [
        ...result.items.flatMap(item => [
            `第 ${item.chapter} 章  ${item.title}（${item.who.map(who => (who.as ? `${who.label}，以${who.as}` : who.label)).join("、")}）${item.arcs.length ? "" : "  未归入主线"} ${at(item.refs)}`,
            ...(item.time || item.place ? [`  ${[item.time ? `时间：${item.time.label}` : "", item.place ? `地点：${item.place.label}` : ""].filter(Boolean).join("；")}`] : []),
            `  ${item.summary}`,
            ...item.links.map(link => `  ${link.type} → ${link.to.title}${link.note ? `（${link.note}）` : ""}`),
        ]),
        ...pageFooter(result),
    ],
    "arcs.list": result => (result.through === null ? ["还没有主线"] : [`归纳到第 ${result.through} 章：`, ...result.arcs.map(arc => `${arc.title}（${arc.status === "closed" ? "已结束" : "进行中"}，${arc.episodes.length} 段情节）：${arc.summary}`)]),
    "source.read": result => result.paragraphs.map(paragraph => `${paragraph.chapter}.${paragraph.paragraph}  ${paragraph.text}${paragraph.recordCount ? `  〔${paragraph.recordCount} 条记录〕` : ""}`),
    "source.records": result => (result.records.length === 0 ? ["这一段没有可见的记录"] : result.records.map(record => `${record.type}  ${record.text}${record.tags ? ` [${tagText(record.tags)}]` : ""} ${at(record.refs)}`)),
    search: result => [
        `对象 ${result.counts.entity}、说法 ${result.counts.statement}、原文 ${result.counts.source}`,
        ...result.items.map(item => `${item.kind === "entity" ? "对象" : item.kind === "statement" ? "说法" : "原文"}〔${item.ref}〕 ${item.text}`),
        ...pageFooter(result),
    ],
};

export function formatResult<M extends StoryMethod>(method: M, result: StoryResult<M>): string {
    const formatter = FORMATTERS[method] as Formatter<M> | undefined;
    return formatter ? formatter(result).join("\n") : JSON.stringify(result, null, 2);
}
