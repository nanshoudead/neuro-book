import {describe, expect, it} from "vitest";

import {installationPaths} from "#manager/paths";

describe("Installation Root 路径", () => {
    it("普通安装以根目录作为 State Root", () => {
        const paths = installationPaths("C:/apps/neuro-book");
        expect(paths.state.replaceAll("\\", "/")).toBe("C:/apps/neuro-book");
        expect(paths.manifest.replaceAll("\\", "/").endsWith("/.deploy/installation.json")).toBe(true);
    });

    it("Windows Portable 使用 data State Root", () => {
        const paths = installationPaths("C:/apps/neuro-book", true);
        expect(paths.state.replaceAll("\\", "/")).toBe("C:/apps/neuro-book/data");
    });
});
