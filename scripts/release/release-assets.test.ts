import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {currentProductPlatform, PRODUCT_ASSET_NAMES} from "nbook/packages/neuro-book-manager/src/platform";
import {PRODUCT_PLATFORMS} from "nbook/packages/neuro-book-manager/src/types";
import {runCapture} from "nbook/scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Release宿主合同", () => {
    it("拒绝把当前.output包装成其他平台资产", async () => {
        const current = currentProductPlatform();
        const foreign = PRODUCT_PLATFORMS.find((platform) => platform !== current)!;
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-platform-"));
        roots.push(outputRoot);

        await expect(runCapture("bun", [
            "scripts/release/release-assets.ts",
            "product",
            "--platform", foreign,
            "--output", join(outputRoot, PRODUCT_ASSET_NAMES[foreign]),
        ], {cwd: ROOT})).rejects.toThrow(`当前宿主${current}不能包装${foreign}`);
    });
});
