/**
 * 同名提示（docs/specs/workbench/editor.md 输出 56）：同一组里显示名相同的文件标签，名字后面附上能区分它们的最短上级
 * 目录（`…/notes`）；目录一直到根都相同时附根的名字；同一个文件的几种编辑器附编辑器的名字。只看此刻的标签，改名、关掉
 * 一个之后按剩下的重新算。
 */

import {resourceOf} from "./documents/address";

export interface HintSubject {
    readonly id: string;
    /** 标签上显示的名字（预览视图是“预览 x”，与源码标签本来就不同名）。 */
    readonly label: string;
    readonly address: string;
    readonly editor: string;
}

/** 方案根的显示名（`project://` 是作品，`user://` 是用户资产）。 */
export type RootName = (scheme: "project" | "user") => string;

export function tabHints(subjects: ReadonlyArray<HintSubject>, names: {readonly root: RootName; readonly editor: (id: string) => string}): ReadonlyMap<string, string> {
    const hints = new Map<string, string>();
    const byLabel = new Map<string, HintSubject[]>();
    for (const subject of subjects) byLabel.set(subject.label, [...(byLabel.get(subject.label) ?? []), subject]);
    for (const same of byLabel.values()) {
        if (same.length < 2) continue;
        const addresses = [...new Set(same.map((subject) => subject.address))];
        const directory = addresses.length > 1 ? directoryHints(addresses, names.root) : new Map<string, string>();
        for (const subject of same) {
            const parts = [directory.get(subject.address)];
            // 同一个文件开着几种编辑器：再附编辑器名。
            if (same.some((other) => other !== subject && other.address === subject.address)) parts.push(names.editor(subject.editor));
            const hint = parts.filter((part): part is string => part !== undefined).join(" · ");
            if (hint !== "") hints.set(subject.id, hint);
        }
    }
    return hints;
}

/** 每个地址取最短的、在这组里唯一的上级目录后缀；到根仍不唯一时用根名加完整目录。 */
function directoryHints(addresses: ReadonlyArray<string>, root: RootName): ReadonlyMap<string, string> {
    const parents = new Map(addresses.map((address) => {
        const resource = resourceOf(address);
        const segments = resource.path.split("/").slice(0, -1);
        return [address, {segments, scheme: resource.scheme}] as const;
    }));
    const deepest = Math.max(...[...parents.values()].map((parent) => parent.segments.length));
    const hints = new Map<string, string>();
    for (let depth = 1; depth <= deepest && hints.size < addresses.length; depth += 1) {
        const suffix = (address: string): string => parents.get(address)?.segments.slice(-depth).join("/") ?? "";
        for (const address of addresses) {
            if (hints.has(address)) continue;
            const mine = suffix(address);
            const clash = addresses.some((other) => other !== address && suffix(other) === mine);
            const parent = parents.get(address);
            if (!clash && mine !== "" && parent !== undefined) hints.set(address, depth < parent.segments.length ? `…/${mine}` : mine);
        }
    }
    // 一直到根都分不开（不同方案下的同一路径、或文件就在根下）：附根名加完整目录。
    const qualified = (address: string): string => {
        const parent = parents.get(address);
        return parent === undefined ? "" : [root(parent.scheme), ...parent.segments].join("/");
    };
    for (const address of addresses) if (!hints.has(address)) hints.set(address, qualified(address));
    // 根名回退出来的提示可能与别人已经选好的目录后缀重名（目录就叫“作品”）：重名的几个都改用根名加完整目录，这在不同
    // 地址之间一定不同。
    for (const address of addresses) {
        const mine = hints.get(address);
        if (addresses.some((other) => other !== address && hints.get(other) === mine)) {
            for (const other of addresses) if (hints.get(other) === mine) hints.set(other, qualified(other));
        }
    }
    return hints;
}
