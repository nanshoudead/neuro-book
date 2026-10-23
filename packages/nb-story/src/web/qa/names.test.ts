/**
 * 答案里的人名：去掉括号里的别名、不查固定词、同一范围同一名字只查一次。
 */

import {describe, expect, test} from "bun:test";

import {createNameResolver, nameToLook} from "./names";

describe("人名", () => {
    test("括号里的别名去掉，固定词不查", () => {
        expect(["南嘉鱼（地狱猫）", "苏天晴 (晴)", "读者", " 花铃 ", "（无名）"].map(nameToLook)).toEqual(["南嘉鱼", "苏天晴", null, "花铃", null]);
    });

    test("同一范围同一名字只查一次，同时要的共用请求；换了范围重新查；查询出错当作没有、不进缓存", async () => {
        const asked: string[] = [];
        const resolve = createNameResolver(async name => {
            asked.push(name);
            if (name === "坏") throw new Error("网络");
            return name === "南嘉鱼" ? "e1" : null;
        });
        expect(await Promise.all([resolve("书@38.57#1", "南嘉鱼"), resolve("书@38.57#1", "南嘉鱼（地狱猫）")])).toEqual(["e1", "e1"]);
        expect(await resolve("书@40.1#1", "南嘉鱼")).toBe("e1");
        expect(await resolve("书@38.57#1", "坏")).toBeNull();
        expect(asked).toEqual(["南嘉鱼", "南嘉鱼", "坏"]);
        // 失败（网络）不进缓存：同一范围下次再查。
        expect(await resolve("书@38.57#1", "坏")).toBeNull();
        expect(asked).toEqual(["南嘉鱼", "南嘉鱼", "坏", "坏"]);
    });
});
