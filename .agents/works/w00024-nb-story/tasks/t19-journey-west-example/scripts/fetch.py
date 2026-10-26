"""从维基文库取《西遊記》100 回的 wikitext，去掉模板与标记，拼成一个 TXT（繁体）。"""
import json, re, sys, time, urllib.parse, urllib.request
OUT = sys.argv[1]
API = "https://zh.wikisource.org/w/api.php"
def fetch(n):
    page = f"西遊記/第{n:03d}回"
    q = urllib.parse.urlencode({"action": "parse", "page": page, "prop": "wikitext", "format": "json", "formatversion": "2"})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "nbstory-example/0.1 (https://github.com/notnotype/neuro-book)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["parse"]["wikitext"]
def inline(wt):
    # 行内模板换成正文：異文取第一種，参校取所注的字，补缺字换成对应的字；其余（页头、页脚、版权）由 clean 删掉。
    wt = re.sub(r"\{\{另\|([^|}]*)(?:\|[^}]*)?\}\}", r"\1", wt)
    wt = re.sub(r"\{\{參\|([^|}]*)(?:\|[^}]*)?\}\}", r"\1", wt)
    # 繁简转换标记 -{zh-hans:甲;zh-hant:乙}- 取繁体那一种（之后整本统一转简体）；-{甲}- 取甲。
    wt = re.sub(r"-\{[^}]*?zh-hant:([^;}]*)[^}]*\}-", r"\1", wt)
    wt = re.sub(r"-\{([^}]*)\}-", r"\1", wt)
    return re.sub(r"\{\{CJK-New-Char\|([0-9A-Fa-f]+)[^}]*\}\}", lambda m: chr(int(m.group(1), 16)), wt)
def clean(wt):
    wt = inline(wt)
    m = re.search(r"\|\s*section\s*=\s*(.*)", wt)
    title = re.sub(r"<br\s*/?>", "　", m.group(1)).strip() if m else ""
    body = re.sub(r"\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}", "", wt, flags=re.S)
    body = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", body, flags=re.S)
    body = re.sub(r"<br\s*/?>", "", body)
    body = re.sub(r"<[^>]+>", "", body)
    body = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", body)
    body = re.sub(r"'''?", "", body)
    lines = []
    for line in body.splitlines():
        line = line.strip().lstrip(":").strip()
        if line and not line.startswith(("__", "[[Category", "[[分類")):
            lines.append(line)
    return title, lines
chapters = []
import os
for n in range(1, 101):
    cached = f"/tmp/claude-1000/xyj/raw/{n:03d}.wiki"
    if os.path.exists(cached):
        wt = open(cached, encoding="utf-8").read()
        title, lines = clean(wt)
        if not title.startswith("第"): sys.exit(f"第 {n} 回的标题不对：{title!r}")
        chapters.append(title + "\n\n" + "\n\n".join(lines))
        continue
    for attempt in range(3):
        try:
            wt = fetch(n); break
        except Exception as e:
            print(f"第 {n} 回第 {attempt+1} 次失败：{e}", file=sys.stderr); time.sleep(3)
    else:
        sys.exit(f"第 {n} 回取不到")
    open(f"/tmp/claude-1000/xyj/raw/{n:03d}.wiki", "w", encoding="utf-8").write(wt)
    title, lines = clean(wt)
    if not title.startswith("第"): sys.exit(f"第 {n} 回的标题不对：{title!r}")
    chapters.append(title + "\n\n" + "\n\n".join(lines))
    time.sleep(0.5)
open(OUT, "w", encoding="utf-8").write("\n\n".join(chapters) + "\n")
print("ok", len(chapters))
