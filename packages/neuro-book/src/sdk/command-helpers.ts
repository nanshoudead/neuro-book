/**
 * `nbook.commands` 的贡献助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：命令。SDK 的 `/commands` 导出它，服务端也加载。
 */

import {Type} from "typebox";
import type {Static, TObject, TSchema} from "typebox";

import {COMMANDS_POINT, runsWithoutArgs} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, CommandImplementation, CommandResult} from "nbook/plugins/commands/shared/contracts";

import {bound, COMMAND_SEGMENT, contributionId, localizedText} from "./plugin";
import type {BoundImplementation, ContributionHelper, PluginBuilder, Text} from "./plugin";

export interface CommandHelper<Id extends string = string, Args = unknown> extends ContributionHelper<typeof COMMANDS_POINT, Id, CommandDeclaration> {
    readonly where: "anywhere";
    /** 执行命令；`args` 已按声明的 schema 校验过。 */
    implement(run: (args: Args) => CommandResult<unknown> | Promise<CommandResult<unknown>>): BoundImplementation<typeof COMMANDS_POINT, Id>;
}

/**
 * 对象 schema 收紧成不许多余字段的一份（命令参数的规则）：没写 `additionalProperties` 的补成 `false`，返回新对象、不改传进来的；
 * 写了别的值时抛错。
 */
function strictObject(schema: TSchema, noun: string): TSchema {
    const record = schema as unknown as {readonly type?: unknown; readonly additionalProperties?: unknown};
    if (record.type !== "object") throw new TypeError(`${noun}必须是对象 schema`);
    if (record.additionalProperties === false) return schema;
    if (record.additionalProperties !== undefined) throw new TypeError(`${noun}不许多余字段：additionalProperties 不写或写 false`);
    return Object.defineProperties({}, {...Object.getOwnPropertyDescriptors(schema), additionalProperties: {value: false, enumerable: true, writable: false, configurable: true}}) as TSchema;
}

/**
 * 命令；`args` 缺省为空对象，没写 `additionalProperties` 的补成 `false`。不带参数过不了校验的命令在命令面板里执行不了：
 * 这种命令要写 `expose: {human: false}`，否则加载即抛错。
 */
export function command<const Id extends string, const Name extends string, Args extends TObject = TObject<{}>>(plugin: PluginBuilder<Id>, options: Omit<CommandDeclaration, "title" | "category" | "args"> & {
    readonly name: Name;
    readonly title: Text;
    readonly category?: Text;
    readonly args?: Args;
}): CommandHelper<`${Id}.${Name}`, Static<Args>> {
    const id = contributionId(plugin.id, options.name, "命令", COMMAND_SEGMENT);
    const {name: _name, title, category, args, ...rest} = options;
    const schema = strictObject(args ?? Type.Object({}), `命令 ${id} 的 args `);
    if (!runsWithoutArgs(schema) && rest.expose?.human !== false) {
        const required = (schema as {readonly required?: ReadonlyArray<string>}).required ?? [];
        const which = required.length > 0 ? `有必填项（${required.join("、")}）` : "收不下空对象";
        throw new TypeError(`命令 ${id} 的参数${which}，命令面板不收集参数：参数改成可选，或者写 expose: {human: false} 只给 Agent 与代码用`);
    }
    const declaration: CommandDeclaration = {...rest, title: localizedText(title), ...(category === undefined ? {} : {category: localizedText(category)}), args: schema};
    return {
        id,
        contribution: {capability: COMMANDS_POINT, id, declaration},
        where: "anywhere",
        activationEvents: [],
        implement: (run) => bound(COMMANDS_POINT, id, {run: (input: unknown) => run(input as never)} satisfies CommandImplementation),
    };
}
