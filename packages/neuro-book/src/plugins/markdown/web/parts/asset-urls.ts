/**
 * 图片的地址 → 可显示的 URL（docs/specs/workspace/markdown-dialect.md 输出 18）：作品里的文件与用户资产经文件服务的字节路由
 * （`rawUrl`，同源，浏览器按 ETag 校验缓存）；外部图片原样；别的不显示。磁盘上的文件变了，它的地址加一个版本号，订阅者据此重新
 * 取（`MarkdownImage` 的 `refresh`）。
 *
 * 字节路由的 URL 不占资源，没有要释放的东西；`MarkdownImage` 的 `release` 由这里给空函数。
 */

import type {InjectionKey} from "vue";

import type {FilesService, Scheme, WatchMessage} from "nbook/plugins/files/shared/contracts";

import {classifyTarget} from "../../shared/targets";

export interface AssetUrls {
    /** `base` 是图片所在文件的地址；返回可显示的 URL 与它对应的资源地址（外部图片为 null），不显示为 null。 */
    resolve(base: string | null, src: string): {readonly url: string; readonly address: string | null} | null;
    /** 资源地址的文件在磁盘上变了（改写、删除、改名、失同步）时调用；返回取消订阅。 */
    onChange(address: string, listener: () => void): () => void;
    dispose(): void;
}

export function createAssetUrls(files: Pick<FilesService, "rawUrl" | "watch">): AssetUrls {
    const versions = new Map<string, number>();
    const listeners = new Map<string, Set<() => void>>();
    const stops = new Map<Scheme, () => void>();
    /** 失同步时全部地址的版本一起加：不知道哪些变了。 */
    let epoch = 0;

    const changed = (address: string): void => {
        versions.set(address, (versions.get(address) ?? 0) + 1);
        for (const listener of [...(listeners.get(address) ?? [])]) listener();
    };
    /**
     * `path` 本身与它下面的文件（改名与删除对后代生效）。`path` 本身总是加版本：此刻没有图片在显示它，之后显示时也要换新 URL；
     * 后代只能从订阅者里找。
     */
    const changedUnder = (scheme: Scheme, path: string): void => {
        const prefix = `${scheme}://${path}`;
        changed(prefix);
        for (const address of [...listeners.keys()]) if (address.startsWith(`${prefix}/`)) changed(address);
    };
    const onMessage = (scheme: Scheme) => (message: WatchMessage): void => {
        if (message.kind === "resync") {
            epoch += 1;
            for (const address of [...listeners.keys()]) changed(address);
            return;
        }
        if (message.kind !== "batch") return;
        for (const event of message.events) {
            changedUnder(scheme, event.path);
            if (event.type === "renamed") changedUnder(scheme, event.from);
        }
    };
    const watching = (scheme: Scheme): void => {
        if (!stops.has(scheme)) stops.set(scheme, files.watch(scheme, onMessage(scheme)));
    };

    return {
        resolve: (base, src) => {
            const target = classifyTarget(src, base);
            if (target.kind === "external") return {url: src, address: null};
            if ((target.kind !== "work" && target.kind !== "user") || target.address === null) return null;
            const raw = files.rawUrl(target.address);
            if (raw === null) return null;
            const version = (versions.get(target.address) ?? 0) + epoch;
            return {url: version === 0 ? raw : `${raw}?v=${String(version)}`, address: target.address};
        },
        onChange: (address, listener) => {
            const scheme: Scheme = address.startsWith("user://") ? "user" : "project";
            watching(scheme);
            const set = listeners.get(address) ?? new Set();
            set.add(listener);
            listeners.set(address, set);
            return () => {
                set.delete(listener);
                if (set.size === 0) listeners.delete(address);
            };
        },
        dispose: () => {
            for (const stop of stops.values()) stop();
            stops.clear();
            listeners.clear();
        },
    };
}

/** `nbook.markdown` 交组件时连同方言目录一起给（`../plugin.ts` 的包装）；没有时图片不显示。 */
export const markdownAssetsKey: InjectionKey<AssetUrls> = Symbol("nbook.markdown/assets");
