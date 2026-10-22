import {describe, expect, it} from "bun:test";
import {createAgentContext} from "./context";

describe("createAgentContext", () => {
    it("缺省什么都没有：没有会话与消息，所有操作都不允许，运行空闲", () => {
        const ctx = createAgentContext();
        expect(ctx.session).toBeNull();
        expect(ctx.messages).toEqual([]);
        expect(Object.values(ctx.interaction).every((allowed) => !allowed)).toBe(true);
        expect(ctx.run).toEqual({status: "idle", phase: ""});
        expect(ctx.composer.models).toEqual([]);
    });

    it("几个区域按字段合并，宿主只写自己有的；其余顶层字段整个替换", () => {
        const ctx = createAgentContext({interaction: {canSend: true, canStop: true}, composer: {recall: ["上一问"]}, now: 42});
        expect(ctx.interaction).toMatchObject({canSend: true, canStop: true, canSteer: false});
        expect(ctx.composer).toMatchObject({recall: ["上一问"], draft: {text: "", version: 0}, modes: []});
        expect(ctx.now).toBe(42);
    });

    it("两次调用互不影响", () => {
        const first = createAgentContext();
        first.composer.recall.push("写进第一份");
        first.branches.m1 = {index: 1, total: 2};
        const second = createAgentContext();
        expect(second.composer.recall).toEqual([]);
        expect(second.branches).toEqual({});
    });
});
