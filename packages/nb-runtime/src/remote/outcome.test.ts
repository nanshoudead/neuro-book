/**
 * 提供方方法的结果助手（docs/specs/runtime/plugin-channel.md 的“输入与前置条件”）：`ok`、`fail` 在 async 方法里也推出合同
 * 要求的类型，不用写 `as const`；业务失败的详情按该码的 schema 核对。下面的写法能不能编译就是断言（`bun run typecheck`
 * 检查本文件），用例本身只确认助手的值。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineRemoteService, fail, ok, provideRemote} from "./remote";

const counter = defineRemoteService({
    id: "acme.counter/counter",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        add: {input: Type.Object({words: Type.Integer()}), output: Type.Integer(), effect: "write", errors: {"too-many": Type.Object({max: Type.Integer()}), "closed": Type.Undefined()}},
    },
});

describe("结果助手", () => {
    it("ok 与 fail 在 async 方法里推出合同要求的结果", async () => {
        const provision = provideRemote(counter, () => ({methods: {
            add: async ({words}) => {
                if (words < 0) return fail("closed");
                if (words > 5) return fail("too-many", {max: 5});
                return ok(words);
            },
        }}));
        expect(provision.contract).toBe(counter);
        expect(ok(1)).toEqual({ok: true, value: 1});
        expect(fail("too-many", {max: 5})).toEqual({ok: false, code: "too-many", detail: {max: 5}});
        expect(fail("closed")).toEqual({ok: false, code: "closed", detail: undefined});
    });

    it("详情形状不对、缺详情、码没有声明：编译不过", () => {
        provideRemote(counter, () => ({methods: {
            // @ts-expect-error 详情的 max 要是整数
            add: async () => fail("too-many", {max: "x"}),
        }}));
        provideRemote(counter, () => ({methods: {
            // @ts-expect-error too-many 要带详情
            add: async () => fail("too-many"),
        }}));
        provideRemote(counter, () => ({methods: {
            // @ts-expect-error 合同没有声明 nope
            add: async () => fail("nope"),
        }}));
        expect(true).toBe(true);
    });
});
