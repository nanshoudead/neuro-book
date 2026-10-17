/**
 * 产品版本常量与包 `package.json` 保持一致：插件兼容检查与内置插件版本都用它，漂移会让第三方插件误判兼容。
 */

import {expect, it} from "bun:test";
import {readFileSync} from "node:fs";

import {PRODUCT_VERSION} from "./product";

it("PRODUCT_VERSION 与 package.json 的 version 一致", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {readonly version?: unknown};
    expect(pkg.version).toBe(PRODUCT_VERSION);
});
