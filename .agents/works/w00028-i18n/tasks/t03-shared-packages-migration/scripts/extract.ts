// 从 HEAD 版本取出全部双语字面量：<常量名>.<键>[.<子字段>] → {zh, en}
import {readFileSync} from "node:fs";
const out: Record<string, {"zh-CN": string; "en-US": string}> = {};
let count = 0;
for (const file of process.argv.slice(2)) {
    let block = "";
    for (const line of readFileSync(file, "utf8").split("\n")) {
        const c = /^(?:export )?const (\w+)/u.exec(line);
        if (c) block = c[1]!;
        const lead = /^\s*("?[\w-]+"?):/u.exec(line);
        const re = /(?:(\w+): )?\{"zh-CN": ("(?:[^"\\]|\\.)*"), "en-US": ("(?:[^"\\]|\\.)*")\}/gu;
        for (const m of line.matchAll(re)) {
            count += 1;
            const leadKey = lead ? lead[1]!.replace(/"/gu, "") : "?";
            const sub = m[1];
            const path = sub && sub !== leadKey ? `${block}.${leadKey}.${sub}` : `${block}.${leadKey}`;
            if (path in out) throw new Error(`dup ${path}`);
            out[path] = {"zh-CN": JSON.parse(m[2]!), "en-US": JSON.parse(m[3]!)};
        }
    }
}
console.log(JSON.stringify(out, null, 1));
console.error("count", count);
