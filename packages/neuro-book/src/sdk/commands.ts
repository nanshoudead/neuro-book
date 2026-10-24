/**
 * 插件 SDK 的 `/commands`：内置插件 `nbook.commands` 的命令（docs/specs/workbench/commands.md）：贡献命令的助手，以及从代码
 * 执行、查询命令的服务 `commandServiceKey`（入口要在 `dependencies` 里声明它）。服务端也加载。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {command} from "./command-helpers";
export type {CommandHelper} from "./command-helpers";

export {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
export type {CommandDeclaration, CommandFailure, CommandFailureCode, CommandImplementation, CommandResult, CommandService} from "nbook/plugins/commands/shared/contracts";
