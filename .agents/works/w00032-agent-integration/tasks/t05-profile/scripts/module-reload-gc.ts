// t05 实测：重新导入的 Profile 模块能不能被 GC 回收。用法：SIZE=<字节> bun module-reload-gc.ts <same-path|new-path|new-path-evict> <临时目录> <次数>
// 每轮写一个约 200 KB 的模块并导入，丢掉引用后强制 GC，看导出对象有没有被回收、堆有没有涨。
import {writeFileSync} from "node:fs";
import {heapStats} from "bun:jsc";
const mode = process.argv[2]; // "same-path"（删 require.cache 再导入）或 "new-path"（每次新文件名）
const dir = process.argv[3];
let collected = 0;
const registry = new FinalizationRegistry(() => { collected++; });
const filler = (i: number) => `export const blob = ${JSON.stringify("x".repeat(Number(process.env.SIZE ?? 200000)) + i)};\nexport const marker = {i: ${i}};\n`;
const heap = () => { Bun.gc(true); return (heapStats().heapSize / 1e6).toFixed(1); };
console.log(mode, "start heapMB", heap(), "rssMB", (process.memoryUsage().rss / 1e6).toFixed(0));
const N = Number(process.argv[4] ?? 400);
for (let i = 0; i < N; i++) {
  const path = mode === "same-path" ? `${dir}/p.ts` : `${dir}/p-${i}.ts`;
  writeFileSync(path, filler(i));
  if (mode === "same-path") delete require.cache[path];
  const m = await import(path);
  if (mode === "new-path-evict" && i > 0) delete require.cache[`${dir}/p-${i - 1}.ts`];
  registry.register(m.marker, i);
}
for (let k = 0; k < 5; k++) { Bun.gc(true); await Bun.sleep(50); }
console.log(mode, "end   heapMB", heap(), "rssMB", (process.memoryUsage().rss / 1e6).toFixed(0), "markers collected", collected, "/", N);
