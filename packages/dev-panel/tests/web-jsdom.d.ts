// jsdom 的最小类型声明，只写 `web-markdown.test.ts` 用到的成员；不装 `@types/jsdom` 的原因见那个测试顶部的注释。
// 放在 tests/ 下、按 `web-*.ts` 命名，才会被 tsconfig.web-tests.json 收进去（lib 里有 DOM，`Window` 指浏览器的类型）。
// 测试要用新的 jsdom 成员时在这里补上；改回装 `@types/jsdom` 时删掉本文件，两份声明会冲突。
declare module "jsdom" {
    export class JSDOM {
        constructor(html?: string, options?: {url?: string});
        readonly window: Window;
    }
}
