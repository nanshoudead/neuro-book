/**
 * `release:smoke` 与 `release:publish` 之间的交接：smoke 把验过的 tarball 放进 `dist/release/`，写下
 * `release-manifest.json`；publish 只发它们，发之前核对提交与 SHA-256。
 */

import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

// 不用 import.meta.dir：publish 的测试在 Node 里导入本文件。
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));

/** smoke 打的 tarball 与清单，在 `dist/` 下，不进 Git。 */
export const RELEASE_DIRECTORY = join(REPOSITORY, "dist", "release");
export const RELEASE_MANIFEST = join(RELEASE_DIRECTORY, "release-manifest.json");

/** 哪个提交上打的、按发布顺序每个包的 tarball（`dist/release/` 下的文件名）与 SHA-256。 */
export type ReleaseManifest = {
    commit: string;
    packages: Array<{name: string; version: string; tarball: string; sha256: string}>;
};

export async function sha256Of(path: string): Promise<string> {
    return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** npm 的 `dist.integrity` 写法（`sha512-<base64>`），用来比对 registry 上已有的版本是不是这份 tarball。 */
export async function integrityOf(path: string): Promise<string> {
    return `sha512-${createHash("sha512").update(await readFile(path)).digest("base64")}`;
}
