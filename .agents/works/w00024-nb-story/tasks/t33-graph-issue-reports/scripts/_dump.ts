import {truncate, DEFAULT_GRAPH} from "./context-check";
const g = truncate(await Bun.file(DEFAULT_GRAPH).json(), 30);
const ev = (s: any) => s.source.evidence.map((r: any) => `${r.chapter}.${r.from}${r.to !== r.from ? "-" + r.to : ""}`).join(",");
for (const s of g.statements) if (["kinship", "membership", "identity", "social", "possession", "location"].includes(s.family) || s.about.some((a: string) => ["e18-1", "e19-1", "e16-1", "e16-2", "e1-3", "e4-1", "e4-2", "e10-4"].includes(a)))
  console.log(`${s.id} ${s.family}/${s.kind}/${s.certainty} [${s.about.join(",")}] by=${s.source.by ?? "-"} ${ev(s)} ${s.text}`);
