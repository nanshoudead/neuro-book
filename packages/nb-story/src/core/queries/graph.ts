/**
 * 图：`graph.relations`、`graph.book`、`graph.storyline`（docs/specs/story/queries.md 输出 16、17、18）。
 * 只给点与线，位置由使用方排。
 */

import type {RelationEdge, StoryParams, StoryResult} from "../../contract/contract";
import type {EntityKind, Statement} from "../dataset";
import {READER, readerGrouping} from "../identity";
import {participantNodes, perspectiveStatements, type QueryContext} from "./context";

/** 关系图默认画的类别：人物与组织（身份是人物的化名，算人物）。 */
const DEFAULT_KINDS: readonly EntityKind[] = ["person", "persona", "group"];
const RELATION_FAMILIES = new Set(["kinship", "social", "membership"]);
/**
 * 亲属词 → 关系图上的写法。“母亲”“祖母”这类带方向的词不知道谁是谁的，写成对称的“亲子”“祖孙”；
 * 对称的并列词（姐妹、夫妻……）原样用。先列的先匹配，所以复合词（同父异母、姑侄）排在单字词前面。
 */
const KINSHIP_WORDS: readonly (readonly [word: string, shown: string])[] = [
    ...["姐妹", "兄弟", "姐弟", "兄妹", "父女", "母女", "父子", "母子", "叔侄", "夫妻", "祖孙"].map(word => [word, word] as const),
    ...["姑侄", "姑母", "舅甥", "姨甥", "伯侄"].map(word => [word, "叔侄"] as const),
    ...["同父异母", "同母异父", "堂兄", "堂姐", "堂弟", "堂妹", "表兄", "表姐", "表弟", "表妹", "兄长", "姐姐", "哥哥", "弟弟", "妹妹"].map(word => [word, "亲属"] as const),
    ...["母亲", "父亲", "父母", "爸爸", "妈妈", "儿子", "女儿", "子女", "孩子"].map(word => [word, "亲子"] as const),
    ...["祖母", "祖父", "外祖", "爷爷", "奶奶", "外婆", "外公", "孙子", "孙女"].map(word => [word, "祖孙"] as const),
    ...["亲属", "亲人", "亲戚", "家人"].map(word => [word, "亲属"] as const),
];
/** 社交类说法里认作关系称谓的词，沿用 w00024 t01 关系图定稿时的词表。 */
const SOCIAL_WORDS = ["朋友", "同桌", "同学", "室友", "舍友", "搭档", "对手", "敌人", "师徒", "恋人", "邻居", "同伴", "队友", "上司", "下属", "雇主", "契约"];
/** 故事线的行数。 */
const STORYLINE_LANES = 12;

/**
 * 点的全部称呼（搜索按别名查用）：点里每个对象在阅读位置之前已出现的称呼，去重，不含显示名。`view` 已按阅读位置裁过，
 * 所以不会带出之后才揭晓的称呼。
 */
function aliasesOf(ctx: QueryContext, node: string): string[] {
    const label = ctx.grouping.labels.get(node);
    const names = new Set<string>();
    for (const id of ctx.grouping.members.get(node) ?? []) for (const name of ctx.view.entity(id)!.names) if (name.text !== label) names.add(name.text);
    return [...names];
}

function pairKey(a: string, b: string): [string, string, string] {
    return a < b ? [a, b, `${a}|${b}`] : [b, a, `${b}|${a}`];
}

/** 一对点的关系词：亲属词 → 社交称谓 → “所属”，都没有时为 null（输出 16）。 */
export function relationWord(statements: readonly Statement[]): string | null {
    const labels = (family: string) => statements.filter(statement => statement.family === family).map(statement => statement.label ?? statement.text);
    // 亲属说法里找不到亲属词的不算（“直系后辈”是魔女的师承辈分，不是血亲）：往下看社交称谓与所属。
    const kinship = labels("kinship");
    const kin = KINSHIP_WORDS.find(([word]) => kinship.some(label => label.includes(word)));
    if (kin !== undefined) return kin[1];
    const social = labels("social");
    const word = SOCIAL_WORDS.find(candidate => social.some(label => label.includes(candidate)));
    if (word) return word;
    return labels("membership").length > 0 ? "所属" : null;
}

/** 每对点同场的情节数。 */
function togetherCounts(ctx: QueryContext): Map<string, number> {
    const counts = new Map<string, number>();
    for (const episode of ctx.view.episodes) {
        const nodes = participantNodes(ctx, episode).sort();
        for (let i = 0; i < nodes.length; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
                const key = `${nodes[i]}|${nodes[j]}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
    }
    return counts;
}

export function relationsGraph(ctx: QueryContext, params: StoryParams<"graph.relations">): StoryResult<"graph.relations"> {
    const {view, grouping} = ctx;
    const kinds = new Set(params.kinds ?? DEFAULT_KINDS);
    const minTogether = params.minTogether ?? 1;
    const isAnonymous = (node: string) => (grouping.members.get(node) ?? []).every(id => view.entity(id)!.anonymous);
    // 无名的点（可见称呼全是泛称）默认不画：它们的出场与同场是泛称撑起来的（输出 22）。
    const nodeIds = [...grouping.members.keys()].filter(node => kinds.has(view.entity(node)!.kind) && (params.includeAnonymous === true || !isAnonymous(node)));
    const included = new Set(nodeIds);

    const statements = perspectiveStatements(ctx);
    const relationByPair = new Map<string, Statement[]>();
    for (const statement of statements) {
        if (!RELATION_FAMILIES.has(statement.family)) continue;
        const nodes = [...new Set(statement.about.map(id => grouping.nodeOf.get(id)).filter((node): node is string => node !== undefined && included.has(node)))];
        for (let i = 0; i < nodes.length; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
                const [, , key] = pairKey(nodes[i]!, nodes[j]!);
                const list = relationByPair.get(key);
                if (list) list.push(statement);
                else relationByPair.set(key, [statement]);
            }
        }
    }

    // 认知：a 知道关于 b 的条数（知情记录所指说法的 about 含 b）。只在读者视角给。
    const knowsByPair = new Map<string, {ab: number; ba: number}>();
    if (grouping.perspective === READER) {
        for (const item of view.knowledge) {
            const a = grouping.nodeOf.get(item.who);
            const statement = view.statement(item.about);
            if (a === undefined || !included.has(a) || !statement) continue;
            for (const target of new Set(statement.about.map(id => grouping.nodeOf.get(id)))) {
                if (target === undefined || target === a || !included.has(target)) continue;
                const [left, , key] = pairKey(a, target);
                const entry = knowsByPair.get(key) ?? {ab: 0, ba: 0};
                if (left === a) entry.ab += 1;
                else entry.ba += 1;
                knowsByPair.set(key, entry);
            }
        }
    }

    const together = togetherCounts(ctx);
    const identityByPair = new Map(grouping.identity.filter(pair => included.has(pair.a) && included.has(pair.b)).map(pair => [`${pair.a}|${pair.b}`, pair.identity]));
    const keys = new Set([...relationByPair.keys(), ...knowsByPair.keys(), ...identityByPair.keys(), ...[...together.entries()].filter(([key, count]) => {
        const [a, b] = key.split("|");
        return count >= minTogether && included.has(a!) && included.has(b!);
    }).map(([key]) => key)]);

    const edges: RelationEdge[] = [...keys].sort().map(key => {
        const [a, b] = key.split("|") as [string, string];
        const relation = relationByPair.get(key);
        const count = together.get(key) ?? 0;
        return {
            a,
            b,
            relation: relation ? {word: relationWord(relation), statements: relation.length} : null,
            together: count >= minTogether ? count : 0,
            knows: grouping.perspective === READER ? (knowsByPair.get(key) ?? {ab: 0, ba: 0}) : null,
            identity: identityByPair.get(key) ?? null,
        };
    });

    // 可选的视角总按读者视角列：P 时至少有一条知情记录的人物。
    const reader = readerGrouping(view);
    return {
        nodes: nodeIds
            .sort((a, b) => grouping.mentions.get(b)! - grouping.mentions.get(a)! || (a < b ? -1 : 1))
            .map(node => ({id: node, label: grouping.labels.get(node)!, kind: view.entity(node)!.kind, mentions: grouping.mentions.get(node)!, entities: [...(grouping.members.get(node) ?? [])], names: aliasesOf(ctx, node), ...(isAnonymous(node) ? {anonymous: true} : {})})),
        edges,
        view: {
            perspective: grouping.perspective,
            statements: statements.length,
            unmerged: grouping.identity.map(pair => ({a: pair.a, b: pair.b, identity: pair.identity})),
        },
        perspectives: [...reader.members.keys()]
            .filter(node => {
                const kind = view.entity(node)!.kind;
                const members = reader.members.get(node) ?? [];
                return (kind === "person" || kind === "persona") && view.knowledge.some(item => members.includes(item.who));
            })
            .sort((a, b) => reader.mentions.get(b)! - reader.mentions.get(a)! || (a < b ? -1 : 1))
            .map(node => ({id: node, label: reader.labels.get(node)!})),
    };
}

export function bookGraph(ctx: QueryContext, params: StoryParams<"graph.book">): StoryResult<"graph.book"> {
    const {view, grouping} = ctx;
    const grain = params.grain ?? "arc";
    const types = new Set(params.types ?? ["entity", "arc", "episode", "secret"]);
    const nodes: StoryResult<"graph.book">["nodes"] = [];
    const edges: StoryResult<"graph.book">["edges"] = [];
    const entityNodes = new Set<string>();
    const touch = (entity: string) => {
        const node = grouping.nodeOf.get(entity);
        if (node !== undefined) entityNodes.add(node);
        return node;
    };

    if (grain === "arc" && types.has("arc")) {
        for (const arc of view.arcs.arcs) {
            nodes.push({id: arc.id, type: "arc", label: arc.title, weight: arc.episodes.length});
            const counts = new Map<string, number>();
            for (const id of arc.episodes) {
                for (const node of participantNodes(ctx, view.episode(id)!)) {
                    counts.set(node, (counts.get(node) ?? 0) + 1);
                }
            }
            for (const [node, count] of [...counts].sort()) {
                entityNodes.add(node);
                edges.push({a: node, b: arc.id, type: "participates", count});
            }
        }
    }
    if (grain === "episode" && types.has("episode")) {
        for (const episode of view.episodes) {
            nodes.push({id: episode.id, type: "episode", label: episode.title, weight: episode.who.length});
            for (const node of participantNodes(ctx, episode).sort()) {
                entityNodes.add(node);
                edges.push({a: node, b: episode.id, type: "participates", count: 1});
            }
            for (const link of episode.links) edges.push({a: episode.id, b: link.to, type: "link", count: 1});
        }
    }
    if (types.has("secret")) {
        for (const secret of view.secrets) {
            nodes.push({id: secret.id, type: "secret", label: secret.title, weight: secret.statements.length});
            for (const node of [...new Set(secret.about.map(touch))].sort()) if (node !== undefined) edges.push({a: node, b: secret.id, type: "about", count: 1});
        }
    }
    if (types.has("question")) {
        for (const question of view.questions) {
            nodes.push({id: question.id, type: "question", label: question.text, weight: question.updates.length});
            for (const node of [...new Set(question.about.map(touch))].sort()) if (node !== undefined) edges.push({a: node, b: question.id, type: "about", count: 1});
        }
    }
    if (types.has("entity")) {
        const relations = new Map<string, number>();
        for (const statement of view.statements) {
            if (!RELATION_FAMILIES.has(statement.family)) continue;
            const ends = [...new Set(statement.about.map(id => grouping.nodeOf.get(id)).filter((node): node is string => node !== undefined && entityNodes.has(node)))].sort();
            for (let i = 0; i < ends.length; i += 1) for (let j = i + 1; j < ends.length; j += 1) relations.set(`${ends[i]}|${ends[j]}`, (relations.get(`${ends[i]}|${ends[j]}`) ?? 0) + 1);
        }
        for (const [key, count] of [...relations].sort()) {
            const [a, b] = key.split("|") as [string, string];
            edges.push({a, b, type: "relation", count});
        }
        for (const node of [...entityNodes].sort()) nodes.unshift({id: node, type: "entity", label: grouping.labels.get(node)!, weight: grouping.mentions.get(node)!, names: aliasesOf(ctx, node)});
    }
    const present = new Set(nodes.map(node => node.id));
    return {nodes, edges: edges.filter(edge => present.has(edge.a) && present.has(edge.b))};
}

export function storyline(ctx: QueryContext): StoryResult<"graph.storyline"> {
    const {view, grouping} = ctx;
    const episodeNodes = view.episodes.map(episode => ({episode, nodes: participantNodes(ctx, episode).filter(node => DEFAULT_KINDS.includes(view.entity(node)!.kind))}));
    const appearances = new Map<string, number>();
    for (const {nodes} of episodeNodes) for (const node of nodes) appearances.set(node, (appearances.get(node) ?? 0) + 1);
    const chosen = [...appearances].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, STORYLINE_LANES).map(([node]) => node);
    const picked = new Set(chosen);
    const meet = new Map<string, number>();
    for (const {nodes} of episodeNodes) {
        const inLanes = nodes.filter(node => picked.has(node)).sort();
        for (let i = 0; i < inLanes.length; i += 1) for (let j = i + 1; j < inLanes.length; j += 1) meet.set(`${inLanes[i]}|${inLanes[j]}`, (meet.get(`${inLanes[i]}|${inLanes[j]}`) ?? 0) + 1);
    }
    const weight = (a: string, b: string) => meet.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
    // 交汇最多的放中间；之后每次取与已排的交汇最多的那个，放到与它交汇更多的一端（同分放右端、按 id）。
    const total = (node: string) => chosen.reduce((sum, other) => sum + (other === node ? 0 : weight(node, other)), 0);
    const remaining = [...chosen].sort((a, b) => total(b) - total(a) || (a < b ? -1 : 1));
    const order: string[] = remaining.length > 0 ? [remaining.shift()!] : [];
    while (remaining.length > 0) {
        remaining.sort((a, b) => order.reduce((sum, node) => sum + weight(b, node), 0) - order.reduce((sum, node) => sum + weight(a, node), 0) || (a < b ? -1 : 1));
        const next = remaining.shift()!;
        if (weight(next, order[0]!) > weight(next, order.at(-1)!)) order.unshift(next);
        else order.push(next);
    }
    return {
        lanes: order.map(node => ({id: node, label: grouping.labels.get(node)!})),
        dots: episodeNodes.flatMap(({episode, nodes}) => nodes.filter(node => picked.has(node)).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(lane => ({episode: episode.id, title: episode.title, chapter: episode.at.chapter, lane}))),
    };
}
