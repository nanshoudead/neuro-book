import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

import {resolveReleaseManifest} from "#manager/manifest-store";

const SHA = "a".repeat(64);
const REVISION = "b".repeat(40);

let temporaryRoot: string | null = null;

afterEach(async () => {
    vi.unstubAllGlobals();
    if (temporaryRoot) await rm(temporaryRoot, {recursive: true, force: true});
    temporaryRoot = null;
});

describe("Release resolver", () => {
    it("跳过最新但尚未装配的 Release", async () => {
        const complete = release("v1.0.0", false);
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("api.github.com")) {
                return Response.json([
                    {tag_name: "v1.1.0", prerelease: false, draft: false, assets: []},
                    complete.github,
                ]);
            }
            return Response.json(complete.manifest);
        }));
        expect((await resolveReleaseManifest("stable")).version).toBe("1.0.0");
    });

    it("显式版本缺 manifest 时报告尚未装配", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json([
            {tag_name: "v1.1.0", prerelease: false, draft: false, assets: []},
        ])));
        await expect(resolveReleaseManifest("stable", "1.1.0")).rejects.toThrow("尚未完成装配");
    });

    it("canary 接受任意合法 prerelease tag", async () => {
        const complete = release("v1.1.0-beta.2", true);
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => String(input).includes("api.github.com")
            ? Response.json([complete.github])
            : Response.json(complete.manifest)));
        expect((await resolveReleaseManifest("canary")).version).toBe("1.1.0-beta.2");
    });

    it("可从本地候选Manifest解析尚未公开最终索引的Release", async () => {
        temporaryRoot = await mkdtemp(join(tmpdir(), "manager-release-manifest-"));
        const candidate = release("v1.1.0-beta.2", true).manifest;
        const manifestPath = join(temporaryRoot, "release-manifest.json");
        await writeFile(manifestPath, JSON.stringify(candidate), "utf8");

        const resolved = await resolveReleaseManifest("canary", undefined, manifestPath);

        expect(resolved).toEqual(candidate);
    });

    it("显式Manifest与version互斥且不能绕过channel", async () => {
        temporaryRoot = await mkdtemp(join(tmpdir(), "manager-release-manifest-"));
        const candidate = release("v1.1.0-beta.2", true).manifest;
        const manifestPath = join(temporaryRoot, "release-manifest.json");
        await writeFile(manifestPath, JSON.stringify(candidate), "utf8");

        await expect(resolveReleaseManifest("canary", "1.1.0-beta.2", manifestPath)).rejects.toThrow("不能同时使用");
        await expect(resolveReleaseManifest("stable", undefined, manifestPath)).rejects.toThrow("channel");
    });
});

function release(tag: string, prerelease: boolean) {
    const version = tag.slice(1);
    const root = `https://github.com/notnotype/neuro-book/releases/download/${tag}`;
    const urls = {
        manifest: `${root}/release-manifest.json`,
        source: `${root}/neuro-book-source.zip`,
        windows: `${root}/neuro-book-product-windows-x64.zip`,
        linux: `${root}/neuro-book-product-linux-x64-glibc.tar.gz`,
        portable: `${root}/neuro-book-windows-x64.zip`,
    };
    return {
        github: {
            tag_name: tag,
            prerelease,
            draft: false,
            assets: [
                {name: "release-manifest.json", browser_download_url: urls.manifest},
                {name: "neuro-book-source.zip", browser_download_url: urls.source},
                {name: "neuro-book-product-windows-x64.zip", browser_download_url: urls.windows},
                {name: "neuro-book-product-linux-x64-glibc.tar.gz", browser_download_url: urls.linux},
                {name: "neuro-book-windows-x64.zip", browser_download_url: urls.portable},
            ],
        },
        manifest: {
            schemaVersion: 2,
            version,
            channel: prerelease ? "canary" : "stable",
            sourceRevision: REVISION,
            minManagerVersion: "0.1.0",
            source: {url: urls.source, sha256: SHA, bytes: 1},
            products: [
                {url: urls.windows, sha256: SHA, bytes: 1, platform: "windows-x64", sourceRevision: REVISION},
                {url: urls.linux, sha256: SHA, bytes: 1, platform: "linux-x64-glibc", sourceRevision: REVISION},
            ],
            windowsPortable: {url: urls.portable, sha256: SHA, bytes: 1},
            ghcr: {ref: `ghcr.io/notnotype/neuro-book:${tag}`, digest: `sha256:${SHA}`, sourceRevision: REVISION},
        },
    };
}
