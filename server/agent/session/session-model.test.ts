import {describe, expect, it} from "vitest";
import {canonicalSessionModel, sessionModelsEqual} from "nbook/server/agent/session/session-model";

describe("session model canonicalizer", () => {
    it("删除 undefined 后与 JSONL round-trip 保持相等", () => {
        const model = {id: "model", provider: "local", compat: {field: undefined}, headers: undefined};
        const roundTrip = JSON.parse(JSON.stringify(model));
        expect(canonicalSessionModel(model as never)).toEqual(roundTrip);
        expect(sessionModelsEqual(model as never, roundTrip)).toBe(true);
    });

    it("真实 metadata 变化仍能被检测", () => {
        expect(sessionModelsEqual({id: "model", provider: "local", maxTokens: 1} as never, {id: "model", provider: "local", maxTokens: 2} as never)).toBe(false);
    });
});
