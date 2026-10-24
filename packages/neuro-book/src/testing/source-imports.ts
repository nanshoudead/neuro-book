/**
 * 测试里读源码的导入：架构测试（`src/architecture.test.ts`）与 SDK 的公开面闭包（`src/sdk/surface.test.ts`）共用。用
 * TypeScript 编译器读语法树，不用正则：一行写两条语句、导入跨行、模板字符串写的动态导入都读得到，注释里的示例不算。
 * `.vue` 文件只读 `<script>` 块。动态导入只认字面量的模块名，拼出来的（`import(base + name)`）读不到，这类写法由代码评审拦。
 */

import ts from "typescript";

export interface SourceImport {
    readonly specifier: string;
    /** `import type …`、`export type … from`：不带出实现。`import {type A}` 仍算运行时的导入。 */
    readonly typeOnly: boolean;
    readonly dynamic: boolean;
}

export function sourceImports(path: string, text: string): SourceImport[] {
    const code = path.endsWith(".vue") ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)].map((match) => match[1]!).join("\n") : text;
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const found: SourceImport[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            found.push({specifier: node.moduleSpecifier.text, typeOnly: node.importClause?.isTypeOnly === true, dynamic: false});
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
            found.push({specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly, dynamic: false});
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [argument] = node.arguments;
            if (argument !== undefined && ts.isStringLiteralLike(argument)) found.push({specifier: argument.text, typeOnly: false, dynamic: true});
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}
