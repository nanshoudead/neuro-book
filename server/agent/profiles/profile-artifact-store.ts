import {copyFile, mkdir, stat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {PROFILE_COMPILED_DIR_NAME, type ProfileArtifactManifestItem} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {AgentProfile, AgentProfileIssueCode} from "nbook/server/agent/profiles/types";

/**
 * 按内容寻址 sha 加载 compiled profile artifact。该组件只负责 artifact import，
 * 不读源码、不判 freshness、不写 manifest。
 */
export class ProfileArtifactStore {
    /**
     * 从指定 profile root 的 `.compiled/artifacts/<sha>.mjs` 加载 profile。
     */
    async importProfile(profileRoot: string, item: ProfileArtifactManifestItem): Promise<AgentProfile> {
        const artifactPath = join(profileRoot, PROFILE_COMPILED_DIR_NAME, item.artifactFileName);
        const importPath = await this.prepareImportPath(artifactPath, item);
        const mod = await import(pathToFileURL(importPath).href) as {
            default?: unknown;
        };
        const profile = mod.default;
        if (!this.isProfile(profile)) {
            throw new ProfileArtifactStoreError("invalid_export", `compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
        }
        return profile;
    }

    /**
     * Bun 会忽略 file URL query 的模块缓存差异；复制到带 hash 的物理路径后再 import。
     */
    private async prepareImportPath(artifactPath: string, item: ProfileArtifactManifestItem): Promise<string> {
        const cacheRoot = resolve(process.cwd(), ".agent", "workspace", "profile-import-cache");
        const safeArtifactName = item.artifactFileName.split(/[\\/]+/).join("__");
        const importPath = join(cacheRoot, safeArtifactName.replace(/\.mjs$/u, `.${item.artifactSha256.slice(0, 16)}.mjs`));
        const existing = await stat(importPath).catch(() => null);
        if (existing?.size === item.artifactBytes) {
            return importPath;
        }
        await mkdir(cacheRoot, {recursive: true});
        await copyFile(artifactPath, importPath);
        return importPath;
    }

    private isProfile(value: unknown): value is AgentProfile {
        return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "initialSchema" in value
            && "tools" in value
            && "rootToolKeys" in value
            && "prepare" in value
            && typeof (value as {prepare?: unknown}).prepare === "function",
        );
    }
}

/**
 * artifact import 阶段的可分类错误，供 catalog 转成稳定 issue code。
 */
export class ProfileArtifactStoreError extends Error {
    constructor(readonly code: AgentProfileIssueCode, message: string) {
        super(message);
    }
}
