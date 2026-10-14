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
});
