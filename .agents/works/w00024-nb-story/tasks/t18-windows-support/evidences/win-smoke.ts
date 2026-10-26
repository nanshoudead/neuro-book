/** 在 Windows 上装 tarball 里的 nb-story 并跑一遍（t18 的实测，不进仓库）。参数：tarball 目录。 */
import {mkdirSync, readdirSync, writeFileSync, existsSync} from "node:fs";
import {join} from "node:path";
const tarballs = process.argv[2]!;
const bun = process.execPath;
const root = join(process.env.TEMP!, `nbstory-win-${Date.now()}`);
mkdirSync(root);
const files = readdirSync(tarballs).filter(f => f.endsWith(".tgz"));
const name = (f: string) => "@notnotype/" + f.replace(/^notnotype-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "");
const overrides = Object.fromEntries(files.map(f => [name(f), `file:${join(tarballs, f).replaceAll("\\", "/")}`]));
const app = join(root, "app"); mkdirSync(app);
writeFileSync(join(app, "package.json"), JSON.stringify({name: "s", private: true, dependencies: {"@notnotype/nb-story": overrides["@notnotype/nb-story"]}, overrides}, null, 2));
const ok = (label: string, cond: boolean, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "：" + extra : ""}`); if (!cond) process.exitCode = 1; };
async function run(argv: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(argv, {cwd: app, stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return {out, err, code};
}
const install = await run([bun, "install"]);
ok("bun install", install.code === 0, install.code ? install.err.slice(-400) : "");
const bin = join(app, "node_modules", ".bin");
ok("node_modules/.bin 里有 nbstory", readdirSync(bin).some(f => f.startsWith("nbstory")), readdirSync(bin).filter(f => f.startsWith("nbstory")).join(","));
// nbstory.exe 指向 scoop 的 bun\current（目录联接），ssh 会话里跟不过去（untrusted mount point），这里直接用 bun 跑装好的入口。
const cli = join(app, "node_modules", "@notnotype", "nb-story", "src", "cli.ts");
const nbstory = bun;
const help = await run([nbstory, cli, "--help"]);
ok("nbstory --help", help.code === 0 && help.out.includes("skill"));
const lib = join(root, "library");
const books = await run([nbstory, cli, "books", "--library", lib, "--json"]);
ok("空书库 books", books.code === 0 && JSON.parse(books.out).data.books.length === 0, books.err.slice(0, 300));
const s1 = await run([nbstory, cli, "skill", "install", "--dir", join(root, "skills"), "--json"]);
const s2 = await run([nbstory, cli, "skill", "install", "--dir", join(root, "skills"), "--json"]);
ok("skill install --dir 两次", JSON.parse(s1.out).data?.state === "installed" && JSON.parse(s2.out).data?.state === "unchanged", s1.out + s2.out);
const home = join(root, "home"); mkdirSync(home);
const s3 = await run([nbstory, cli, "skill", "install", "--agent", "codex", "--json"], {USERPROFILE: home});
ok("skill install --agent codex 按 USERPROFILE", JSON.parse(s3.out).data?.path === join(home, ".agents", "skills", "nbstory"), s3.out);
const cfg = join(root, "config.json");
const init = await run([nbstory, cli, "config", "init", "--base-url", "https://api.example.com/v1", "--model", "m1", "--api-key-env", "EXAMPLE_API_KEY", "--config", cfg, "--json"]);
const set = await run([nbstory, cli, "config", "set", "qa.answer", "structured", "--config", cfg, "--json"]);
ok("config init 与 set（要拿配置锁）", init.code === 0 && set.code === 0, (init.err + set.err + set.out).slice(0, 400));
async function serve() {
  const p = Bun.spawn([nbstory, cli, "serve", "--library", lib, "--json"], {cwd: app, stdout: "pipe", stderr: "pipe"});
  const reader = p.stdout.getReader(); const first = await reader.read(); reader.releaseLock();
  return {p, line: new TextDecoder().decode(first.value ?? new Uint8Array()).trim().split("\n")[0] ?? ""};
}
const a = await serve();
const started = JSON.parse(a.line || "{}");
ok("serve 启动", started.ok === true, a.line);
if (started.ok) {
  const login = await fetch(started.data.login, {redirect: "manual"});
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const page = await fetch(started.data.url + "/", {headers: {cookie}});
  const html = await page.text();
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const asset = script ? await fetch(started.data.url + script, {headers: {cookie}}) : null;
  ok("登录后取到网页与脚本", login.status === 302 && page.status === 200 && asset?.status === 200, `${login.status} ${page.status} ${asset?.status} ${script}`);
  const b = await serve();
  const code = await b.p.exited;
  ok("同一书库第二个 serve 退出 3（锁生效）", code === 3, `退出码 ${code}；${b.line.slice(0, 200)}`);
}
a.p.kill(); await a.p.exited;
const c = await serve();
ok("第一个 serve 被强行结束后再启动成功（锁随进程放掉）", JSON.parse(c.line || "{}").ok === true, c.line.slice(0, 200));
c.p.kill(); await c.p.exited;
console.log(`目录：${root}`);
