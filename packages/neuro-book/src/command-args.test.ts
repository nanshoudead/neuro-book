/**
 * 已登记命令的参数都能画成表单（docs/specs/ui/forms.md“给下游的映射”的命令参数）：命令面板以后按 `args` 直接画
 * nb-form 的表单，所以每条命令的 `args` 都要被 `checkDescription` 判为可结构化编辑，不能退回 JSON 编辑或不合格。
 *
 * 收集内置插件的全部命令：产品与开发清单的各运行位置的定义表，加清单一级的声明式贡献；命令的声明是静态的，没有只在
 * 运行期才登记的。示例插件（`examples/`）与测试用插件不在内，第三方插件的命令要在加载时另行检查。不合格的按“命令
 * id：分类 问题码”列出。
 */

import {describe, expect, it} from "bun:test";

import {checkDescription} from "@notnotype/nb-form";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {developmentPlugins} from "nbook/development-manifest";
import {productPlugins} from "nbook/manifest";
import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {projectPluginDefinitions} from "nbook/project/plugins";
import {serverPluginDefinitions} from "nbook/server/plugins";
import {developmentBrowserPluginDefinitions} from "nbook/web/development-plugins";
import {browserPluginDefinitions} from "nbook/web/plugins";

interface Contribution {
    readonly capability: string;
    readonly id: string;
    readonly declaration?: unknown;
}

function commandDeclarations(): Map<string, CommandDeclaration> {
    const contributions: Contribution[] = [...productPlugins, ...developmentPlugins].flatMap((descriptor) => descriptor.contributions ?? []);
    const tables: ReadonlyArray<Readonly<Record<string, PluginDefinition>>> = [serverPluginDefinitions, projectPluginDefinitions, browserPluginDefinitions, developmentBrowserPluginDefinitions];
    for (const definition of tables.flatMap((table) => Object.values(table))) {
        contributions.push(...(definition.contributions ?? []));
        for (const entry of definition.entries) contributions.push(...(entry.contributions ?? []));
    }
    // 同一条命令可能在几个运行位置各声明一次，按 id 去重。
    return new Map(contributions.filter((contribution) => contribution.capability === COMMANDS_POINT).map((contribution) => {
        if (contribution.declaration === undefined) throw new Error(`命令 ${contribution.id} 的贡献没有声明`);
        return [contribution.id, contribution.declaration as CommandDeclaration];
    }));
}

describe("命令参数", () => {
    it("每条已登记命令的 args 都能结构化编辑", () => {
        const declarations = commandDeclarations();
        // 收集本身没有漏掉定义表：几个插件的命令都在。
        expect([...declarations.keys()]).toEqual(expect.arrayContaining(["nbook.app.reload", "nbook.files.rename", "nbook.editor.go-to-line", "nbook.settings.open"]));
        const rejected = [...declarations].flatMap(([id, declaration]) => {
            const check = checkDescription(declaration.args);
            return check.status === "structured" ? [] : [`${id}：${check.status} ${check.problems.map((problem) => `${problem.path || "/"} ${problem.code}`).join("，")}`];
        });
        expect(rejected).toEqual([]);
    });
});
