# nbstory 命令参考

通用选项：`--library <目录>`（书库，默认 `~/.local/share/nbstory/`）、`--json`。书级命令另有 `--book <书 id>`（书库只有一本书时可省）与 `--at <章或章.段>`；列表命令另有 `--limit <条数>`（默认 50，至多 500）与 `--cursor <游标>`（取下一页，游标在上一页输出的末尾）。`<对象>` 可以写 id、名字或任一称呼。

| 命令 | 用途 | 例子 |
|---|---|---|
| `books` | 列出书库里的书 | `nbstory books` |
| `import <文件> --title <书名> [--id <书 id>]` | 把 V9 记忆图收进书库 | `nbstory import dataset-v9.json --title 转生反派萝莉 --id fox` |
| `remove <书>` | 从书库删除一本书 | `nbstory remove fox` |
| `info` | 书的信息与目录（之后的章只有章号） | `nbstory info --at 38` |
| `stats` | 到阅读位置为止的可见记录数，与全书抽取统计 | `nbstory stats --at 38` |
| `chapter <章>` | 这一章的情节、新出现的对象、揭晓的秘密、数值变动、悬念 | `nbstory chapter 37 --at 38` |
| `find <名字或称呼> [--kind <类别>]` | 找对象：称呼、同一身份、出场次数 | `nbstory find 狐狐 --at 38` |
| `card <对象> [--perspective <对象>]` | 人物卡：称呼与首次出现、同一身份、概况、秘密、条数 | `nbstory card 苏天晴 --at 38` |
| `knowledge <对象> [--state <状态>] [--query <字>]` | 他知道的事（状态：knows、believes、suspects、heard、read、unaware） | `nbstory knowledge 苏天晴 --state unaware --at 38` |
| `statements <对象> [--query <字>] [--tiers] [--max-tier 1\|2\|3]` | 关于他的说法，带明说、角色的说法、角色认为、推断；`--tiers` 每条带等级（1 主线、2 有用、3 次要），`--max-tier 2` 藏起 3 级（作答找证据时不要藏） | `nbstory statements 南嘉鱼 --at 38` |
| `appearances <对象> [--query <字>]` | 他参与的情节 | `nbstory appearances 苏天晴 --query 风信子 --at 38` |
| `ties <对象>` | 他和每个对象的关系一览：关系词、身份连接、一句说明、同场与认知的条数 | `nbstory ties 苏天晴 --at 38` |
| `between <对象> <另一个>` | 两人之间的全部说法（按章，带类别与出处）、一起出场的情节、互相知道的事 | `nbstory between 苏天晴 南嘉鱼 --at 38` |
| `knows` | 秘密矩阵：每个秘密、读者与各人物（带读者此时知道的化名）的知情状态、怎么知道的与出处 | `nbstory knows --at 38` |
| `relations [--perspective <对象>] [--kinds <类别,…>] [--min-together <次>] [--include-anonymous true]` | 人物之间的关系词、同场次数、认知条数与身份连接；带视角时按那个人知道的 | `nbstory relations --perspective 苏天晴 --at 38` |
| `ledger` | 各项数值、任务、道具的当前值 | `nbstory ledger --at 38` |
| `track <名目> [--owner <对象>]` | 一项的流水，原文报数与累加对不上的差额 | `nbstory track 神典石 --at 38` |
| `questions [--state open\|partial\|answered] [--sort recent\|raised] [--query <字>]` | 悬念与每次进展 | `nbstory questions --state open --at 38` |
| `timeline [--order story\|source]` | 时间线（按故事时间或按章），补叙标出；每个点下列出这一刻的情节、参与者与地点 | `nbstory timeline --at 38` |
| `episodes [--arc <主线 id>] [--query <字>] [--tiers]` | 情节：参与者（以化名出场时写出化名）、故事时间、地点、概要、与前情的连接、所属主线 | `nbstory episodes --query 风信子 --at 38` |
| `arcs` | 当前这一批主线 | `nbstory arcs --at 38` |
| `why <说法或情节 id>` | 这条为什么是这个等级：模型给的先验、后文有没有引用或再提起 | `nbstory why s4-1 --at 38` |
| `search <文字> [--kinds entity,statement,source]` | 搜对象、说法、原文 | `nbstory search 神典石 --at 38.57` |
| `read <章[.段[-段]]>` | 读原文：一章、一段或一个范围（`38.48-81`） | `nbstory read 38.30-40 --at 38` |
| `para <章.段>` | 引用某一段的记录 | `nbstory para 38.36 --at 38` |
| `serve [--port <端口>] [--open]` | 启动查看器的独立服务，打印登录链接 | `nbstory serve --open` |

退出码：0 成功；1 查询失败（错误码见 `--json` 输出）；2 用法错误；3 `serve` 启动失败（例如这个书库已有服务）。
