/** 测试里把命令声明补成登记时的样子：标题补成约定键，与产品里贡献点的 `complete` 同一条路径。 */

import {completeCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";

import {descriptor} from "../plugin";

export function completedCommand(id: string, declaration: WrittenCommandDeclaration): CommandDeclaration {
    return completeCommandDeclaration({plugin: descriptor.id, id, declaration}) as CommandDeclaration;
}
