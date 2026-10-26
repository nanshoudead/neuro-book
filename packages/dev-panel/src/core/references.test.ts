import {describe, expect, test} from "bun:test";
import {cssReferences, scriptImports, srcsetUrls} from "./references.js";

describe("引用的提取", () => {
    test("srcset 按候选语法：地址里的逗号与 data: 地址不被切开，候选之间的逗号可以不跟空格", () => {
        expect(srcsetUrls("assets/a,b.png 1x, data:image/png;base64,iVBOR,AAA 2x")).toEqual(["assets/a,b.png", "data:image/png;base64,iVBOR,AAA"]);
        expect(srcsetUrls("small.webp 480w,large.webp 1080w")).toEqual(["small.webp", "large.webp"]);
        expect(srcsetUrls(" one.png, two.png ")).toEqual(["one.png", "two.png"]);
        expect(srcsetUrls("pic.png (min-width: 1px, x) 1x, b.png")).toEqual(["pic.png", "b.png"]);
    });

    test("样式表：url() 的三种引号与 @import；注释里的不算；行号从 0 起", () => {
        const css = '@import "base.css";\n/* url(old.png) */\n.a { background: url( \'img/a.png\' ) }\n@font-face { src: url(fonts/f.woff2) format("woff2") }\n.b { background: url(data:image/png;base64,AA) }';
        expect(cssReferences(css)).toEqual([
            {target: "base.css", lineOffset: 0},
            {target: "img/a.png", lineOffset: 2},
            {target: "fonts/f.woff2", lineOffset: 3},
            {target: "data:image/png;base64,AA", lineOffset: 4},
        ]);
    });

    test("脚本：静态 import、再导出、动态 import 的字面量；裸模块名与 import.meta、拼出来的地址不算", () => {
        const js = [
            'import {a,\n  b} from "./lib/a.mjs";',
            "import './side.js';",
            'export * from "../shared/x.js";',
            'import vue from "vue";',
            'const lazy = import("./lazy.js");',
            "const tpl = import(`./tpl.js`);",
            "const dyn = import(`./${name}.js`);",
            "const url = new URL('./data.json', import.meta.url);",
            'import x from "https://cdn.example/x.js";',
        ].join("\n");
        expect(scriptImports(js).map((entry) => entry.target)).toEqual(["./lib/a.mjs", "./side.js", "../shared/x.js", "./lazy.js", "./tpl.js", "https://cdn.example/x.js"]);
        expect(scriptImports(js)[1]).toEqual({target: "./side.js", lineOffset: 2});
    });

    test("样式表按 CSS 的分词：字符串里的注释界符不吞掉规则，字符串里的 url() 不算，地址按转义解码，坏的 url() 不算", () => {
        const css = [
            '.a::before { content: "/*"; }',
            ".a { background: url(real.png) }",
            '.b::before { content: "*/ url(in-string.png)"; }',
            ".c { background: url(pic\\ name.png) }",
            '.d { background: url("q\\"uote.png") } .e { background: url(\\31 x.png) }',
            ".f { background: url(bad name.png) } .g { background: my-url(not.png) }",
            "/* @import 'old.css'; */ @import /* 注释 */ 'new.css';",
            ".h { background: url(   " + " ".repeat(64),
        ].join("\n");
        expect(cssReferences(css)).toEqual([
            {target: "real.png", lineOffset: 1},
            {target: "pic name.png", lineOffset: 3},
            {target: 'q"uote.png', lineOffset: 4},
            {target: "1x.png", lineOffset: 4},
            {target: "new.css", lineOffset: 6},
        ]);
    });

    test("脚本按记号识别 import：注释、字符串、模板字符串与正则里写的不算，记号之间可以夹注释，模板插值里的照样算", () => {
        const js = [
            '// import "./commented.js";',
            "/* import './block.js'; */",
            'const sample = `import "./in-template.js"`;',
            "const text = 'import(\"./in-string.js\")';",
            "const re = /['\"]/; const half = total / 2; import /* webpackChunkName: \"real\" */ \"./real.js\";",
            "export {a}",
            "export {b} from './b.js'",
            "const lazy = `${await import('./in-expr.js')}`; foo.import('./member.js');",
            "import {",
            "  c, // 注释",
            '} from "./c.js"',
        ].join("\n");
        expect(scriptImports(js)).toEqual([
            {target: "./real.js", lineOffset: 4},
            {target: "./b.js", lineOffset: 6},
            {target: "./in-expr.js", lineOffset: 7},
            {target: "./c.js", lineOffset: 8},
        ]);
    });
});
