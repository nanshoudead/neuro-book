/**
 * “打开项目”（`nbook.project.open`）：列出已登记项目，选中即整页导航到 `/?project=<短名>`；输入目录路径则先
 * 登记再导航。窗口一生只绑定一个项目，切换项目就是重新加载（docs/specs/runtime/projects.md 输出第 10 条）。
 * 登记失败时带着原因重新打开选择，用户可以改了再试或取消；命令系统那边的失败只给远程服务不可用这类情形。
 */

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {QuickPick, QuickPickRequest} from "nbook/plugins/workbench/shared/contracts";
import type {DisplayText, TextResolver} from "nbook/shared/localized-text";

import {OPEN_PROJECT_COMMAND, projectsRemoteContract} from "../shared/contracts";
import type {ProjectView} from "../shared/contracts";
import {projectUrl} from "../shared/project-url";
import {projectsText} from "../shared/text";
import {retryTitle} from "./failure-text";

export {OPEN_PROJECT_COMMAND};

export const OPEN_PROJECT_DECLARATION: Omit<WrittenCommandDeclaration, "args"> = {
    category: projectsText("commands.nbook.project.open.category"),
    description: "Open a registered project in this window, or register a directory as a project and open it. The page reloads.",
    effect: "write",
    // 整页重新加载会打断 Agent 自己所在的窗口；先只给人用。
    expose: {agent: "never"},
};

const ACTIVE_STATES: ReadonlySet<ProjectView["state"]> = new Set(["starting", "running", "idle-grace"]);

function request(projects: ReadonlyArray<ProjectView>, title: DisplayText): QuickPickRequest {
    return {
        title,
        placeholder: projectsText("open.placeholder"),
        items: projects.map((project) => ({id: project.name, label: project.name, detail: ACTIVE_STATES.has(project.state) ? projectsText("open.running", {path: project.path}) : project.path})),
        text: {label: (path) => projectsText("open.registerAndOpen", {path})},
        empty: projectsText("open.empty"),
    };
}

export interface OpenProjectHost {
    readonly remote: RemoteClient<typeof projectsRemoteContract>;
    readonly quickPick: QuickPick;
    navigateDocument(url: string): void;
    /** 命令失败的原因按它给出（当前显示语言）。 */
    readonly text: TextResolver;
    /** 登记失败时服务端给的说明原文（中文）记到诊断，不进界面。 */
    recordFailure(reason: string, detail: string): void;
}

export async function openProject(host: OpenProjectHost): Promise<CommandResult<null>> {
    const {remote, quickPick, navigateDocument} = host;
    const fail = (reason: string): CommandResult<null> => ({ok: false, code: "unavailable", reason});
    const listed = await remote.list({});
    if (!listed.ok) return fail(host.text.t(projectsText("open.listFailed", {code: listed.code})));
    let title: DisplayText = projectsText("open.title");
    for (;;) {
        const picked = await quickPick.pick(request(listed.value, title));
        if (picked.kind === "cancelled") return {ok: true, value: null};
        if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
        if (picked.kind === "item") {
            navigateDocument(projectUrl(picked.id));
            return {ok: true, value: null};
        }
        const registered = await remote.register({path: picked.text});
        if (registered.ok) {
            navigateDocument(projectUrl(registered.value.name));
            return {ok: true, value: null};
        }
        // 登记按目录幂等：同一目录再登记得到同一个项目。所以写请求结果未知（unknown-outcome）也折成命令的
        // unavailable、让用户再试是安全的，命令失败码不必另加一个；原因如实写明结果未知。
        if (registered.code === "unknown-outcome") return fail(host.text.t(projectsText("open.unknownOutcome", {cause: registered.cause ?? registered.code})));
        if (registered.code !== "register-failed") return fail(host.text.t(projectsText("open.notCompleted", {code: registered.code})));
        const failure = registered.detail as {readonly reason: string; readonly detail: string};
        host.recordFailure(failure.reason, failure.detail);
        title = retryTitle(failure.reason);
    }
}
