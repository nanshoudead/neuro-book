# 按汇点类型与文件归类（规则写在代码里，可复查）。输入 rows.tsv：file, area, kind, lang
import collections, sys
rows=[l.rstrip("\n").split("\t") for l in open("rows.tsv") if l.strip()]
UI_SURFACED_THROWS={"neuro-book/src/web/host/window.ts","neuro-book/src/web/host/connection.ts","neuro-book/src/web/boot.ts"}
cat=collections.Counter(); surfaced=collections.Counter(); disp=collections.Counter(); catches=collections.Counter()
for f,a,k,l in rows:
    if k.startswith("catch"):
        catches[(a,k)]+=1; continue
    if k.startswith("模板"):
        disp[a]+=1; continue
    fixture = a.startswith("app:plugins/lab") or a=="app:plugin-sdk/examples"
    if fixture: c="夹具与示例"
    elif k.startswith("{ok:false}"):
        if l=="none": c="码或无文字"
        elif a=="nb-ui": c="诊断"
        elif l=="expr": c="透传（语言取决于上游）"
        elif l=="en" and "+reason" in k and "code" not in k: c="码或无文字"
        else: c="用户文案（结果字段里的句子）"
    else:
        c="诊断"
        if f in UI_SURFACED_THROWS and (k.startswith("throw") or k.startswith("class")): surfaced[a]+=1
    cat[(a,c)]+=1
areas=sorted({a for a,_ in cat})
cols=["诊断","用户文案（结果字段里的句子）","透传（语言取决于上游）","码或无文字","夹具与示例"]
print("| 区域 | "+" | ".join(cols)+" | 合计 | 其中诊断进入界面 | 模板显示汇点 | catch |")
print("|---|"+"---|"*(len(cols)+4))
tot=collections.Counter()
for a in areas:
    vals=[cat[(a,c)] for c in cols]
    for c,v in zip(cols,vals): tot[c]+=v
    ncatch=sum(v for (aa,k),v in catches.items() if aa==a)
    print(f"| {a} | "+" | ".join(map(str,vals))+f" | {sum(vals)} | {surfaced[a]} | {disp[a]} | {ncatch} |")
print("| 合计 | "+" | ".join(str(tot[c]) for c in cols)+f" | {sum(tot.values())} | {sum(surfaced.values())} | {sum(disp.values())} | {sum(catches.values())} |")
