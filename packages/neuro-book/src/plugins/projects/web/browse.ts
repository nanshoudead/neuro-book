/**
 * 列服务端上的一个目录给目录选择器（`PathPickerDialog`）：书架的“打开已有作品”、新建时的“浏览…”与设置窗口“作品”分区的
 * “更改…”走同一条路径（docs/specs/workbench/bookshelf.md 输出 12、21）。失败原因按当前语言写好（经 `text`），给选择器显示。
 */

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {TextResolver} from "nbook/shared/localized-text";

import type {BrowseEntry, projectsRemoteContract} from "../shared/contracts";
import {projectsText} from "../shared/text";
import {failureReason, registerFailureReason} from "./failure-text";

export interface BrowseListing {
    readonly path: string;
    readonly parent: string | null;
    readonly entries: ReadonlyArray<BrowseEntry>;
}

export type BrowseOutcome = {readonly ok: true; readonly value: BrowseListing} | {readonly ok: false; readonly message: string};

/** 列一个目录（null 或空白为作品目录）。 */
export async function browseDirectory(remote: RemoteClient<typeof projectsRemoteContract>, path: string | null, text: TextResolver): Promise<BrowseOutcome> {
    // 空白按省略处理：合同里的 path 至少一个字符，“省略”才表示作品目录；作品目录没读到、位置框被清空时宿主会给空串。
    const result = await remote.browse(path === null || path.trim() === "" ? {} : {path});
    if (result.ok) return {ok: true, value: result.value};
    const detail = result.detail as {readonly reason?: string; readonly detail?: string} | undefined;
    const why = result.code === "invalid-parent" ? registerFailureReason(text, detail?.reason ?? "") : failureReason(text, result.code, result.detail);
    return {ok: false, message: text.t(projectsText("shelf.browseFailed", {reason: why}))};
}
