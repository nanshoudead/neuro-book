/**
 * 记录等级的依据：`tier.explain`（docs/specs/story/queries.md 的“记录等级”）。只给结构化的数，文字由命令行与网页各自写。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import {StoryError} from "../errors";
import {episodeTier, tiersAt} from "../tiers";
import type {QueryContext} from "./context";

export function tierExplain(ctx: QueryContext, params: StoryParams<"tier.explain">): StoryResult<"tier.explain"> {
    const {view} = ctx;
    const statement = tiersAt(ctx.index, view.at).statement(params.id);
    if (statement) {
        return {
            id: params.id,
            kind: "statement",
            tier: statement.tier,
            prior: statement.prior,
            flag: statement.flag,
            ev: statement.ev,
            window: statement.window,
            signals: {refs: statement.refs, echo: statement.echo},
        };
    }
    const episode = view.episode(params.id);
    if (episode) {
        const tier = episodeTier(episode);
        return {id: params.id, kind: "episode", tier, prior: tier, flag: null, ev: null, window: null, signals: null};
    }
    // 位置之后的记录与不存在的记录同样回答，不多说它是否存在。
    throw new StoryError("record_not_found", `这个阅读位置没有说法或情节 ${params.id}`);
}
