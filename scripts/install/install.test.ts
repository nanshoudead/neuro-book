import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {beforeAll, describe, expect, it} from "vitest";

const scriptPath = resolve(import.meta.dirname, "install.sh");
let script = "";

beforeAll(async () => {
    script = await readFile(scriptPath, "utf8");
});

describe("POSIX Stage 0平台合同", () => {
    it.each([
        ["bun-linux-x64", "951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f", "9fd36f87e4b90b07632b987a2e4ec81ca15a62c81bf983190cea6d715be2ad74"],
        ["bun-linux-aarch64", "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b", "37141662ebed915a2ab89313156e455e2a1374395f5f6760d06407f49406f086"],
        ["bun-darwin-x64", "4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633", "ea2f223e94bb2f4bf3050895113c3cf346438f6fa0501c8532284e063f72f7a0"],
        ["bun-darwin-aarch64", "d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620", "e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233"],
    ])("固定%s的archive与executable checksum", (asset, archiveSha256, executableSha256) => {
        expect(script).toContain(asset);
        expect(script).toContain(archiveSha256);
        expect(script).toContain(executableSha256);
    });

    it("Darwin使用shasum，Linux保留glibc与sha256sum门禁", () => {
        expect(script).toContain("shasum -a 256");
        expect(script).toContain("sha256sum");
        expect(script).toContain('[ "$HOST_OS" = "Linux" ] && ! getconf GNU_LIBC_VERSION');
    });

    it("缓存损坏时删除整版Runtime并重新下载", () => {
        expect(script.indexOf('if [ "$cached_valid" != true ]')).toBeLessThan(script.indexOf('rm -rf "$RUNTIME_ROOT"'));
        expect(script.indexOf('rm -rf "$RUNTIME_ROOT"')).toBeLessThan(script.indexOf('curl -fsSL "$ASSET_URL"'));
        expect(script).toContain("Stage 0 缺少命令");
    });
});
