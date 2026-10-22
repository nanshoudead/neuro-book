/**
 * 内置登记一次拿全：角色、工具、消息操作、输入框。宿主写 `createAgentViewRegistry([...builtinContributions, ...自己的])`；
 * 要裁剪或替换某一项时改用四份单独的登记。
 */
import type {AgentViewContribution} from "../registry";
import {builtinComposerContribution} from "./builtin-composer";
import {builtinMessageActionsContribution} from "./builtin-message-actions";
import {builtinRolesContribution} from "./builtin-roles";
import {builtinToolsContribution} from "./builtin-tools";

export const builtinContributions: readonly AgentViewContribution[] = [
    builtinRolesContribution,
    builtinToolsContribution,
    builtinMessageActionsContribution,
    builtinComposerContribution,
];
