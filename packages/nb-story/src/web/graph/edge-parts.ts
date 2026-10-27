/**
 * 关系图上一对点之间哪几种联系现在画出来（docs/specs/story/viewer.md 输出 22）：关系说法层、同场层（同场次数不低于门槛）、
 * 认知层（人物卡小图和角色视角不画）。画布组件与“只画最强的线”共用这一条规则：先决定画哪些联系，再对画出来的线排名，
 * 否则被隐藏的层里的强线会挤掉真正可见的线、让点变成孤点（w00024 t29/t30 实现审查第 4 条）。
 */

export interface EdgeFacts {
    statements: number;
    together: number;
    ab: number;
    ba: number;
    identity: unknown;
}

export interface EdgeParts {
    /** 画关系说法。 */
    relation: boolean;
    /** 画同场。 */
    co: boolean;
    /** 画 A 知道关于 B 的认知条数（不画为 0）。 */
    ab: number;
    ba: number;
}

export function edgeParts(edge: EdgeFacts, layers: readonly string[], minCo: number, knowsAllowed: boolean): EdgeParts {
    return {
        relation: layers.includes("relation") && edge.statements > 0,
        co: layers.includes("co") && edge.together >= minCo,
        ab: layers.includes("know") && knowsAllowed ? edge.ab : 0,
        ba: layers.includes("know") && knowsAllowed ? edge.ba : 0,
    };
}

/** 一条线至少画出一种联系（身份线不在这里算，它单独画）。 */
export const hasParts = (parts: EdgeParts): boolean => parts.relation || parts.co || parts.ab > 0 || parts.ba > 0;

/** 画出来的这条线的强度：生效的联系的条数之和。 */
export const partsStrength = (edge: EdgeFacts, parts: EdgeParts): number => (parts.relation ? edge.statements : 0) + (parts.co ? edge.together : 0) + parts.ab + parts.ba;
