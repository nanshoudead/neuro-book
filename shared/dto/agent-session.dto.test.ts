import {describe, expect, it} from "vitest";
import {AgentInvokeRequestDtoSchema, AgentSessionQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

describe("AgentInvokeRequestDtoSchema", () => {
    it("要求 prompt、steer、followup 携带 message 或 input", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "steer",
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "followup",
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "steer",
            message: {text: "调整"},
        }).success).toBe(true);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "followup",
            input: {plotId: "plot-1"},
        }).success).toBe(true);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "prompt",
            input: {plotId: "plot-1"},
        }).success).toBe(true);
    });

    it("拒绝 continue 携带 message 或 input", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "continue",
            message: {text: "不应出现"},
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "continue",
            input: {plotId: "plot-1"},
        }).success).toBe(false);
    });

    it("拒绝前端提交内部 caller identity", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "prompt",
            message: {text: "hello"},
            caller: {kind: "agent"},
        }).success).toBe(false);
    });
});

describe("AgentSessionQueryDtoSchema", () => {
    it("只接受 recovery、history、systemPrompt 三种严格判别查询", () => {
        expect(AgentSessionQueryDtoSchema.parse({})).toEqual({});
        expect(AgentSessionQueryDtoSchema.parse({view: "recovery"})).toEqual({view: "recovery"});
        expect(AgentSessionQueryDtoSchema.parse({view: "history", cursor: "cursor-1"})).toEqual({
            view: "history",
            cursor: "cursor-1",
        });
        expect(AgentSessionQueryDtoSchema.parse({view: "systemPrompt"})).toEqual({view: "systemPrompt"});

        expect(AgentSessionQueryDtoSchema.safeParse({view: "history"}).success).toBe(false);
        expect(AgentSessionQueryDtoSchema.safeParse({cursor: "cursor-1"}).success).toBe(false);
        expect(AgentSessionQueryDtoSchema.safeParse({view: "systemPrompt", cursor: "cursor-1"}).success).toBe(false);
        expect(AgentSessionQueryDtoSchema.safeParse({view: "recovery", cursor: "cursor-1"}).success).toBe(false);
    });
});
