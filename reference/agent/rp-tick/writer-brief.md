# Writer Brief 剧本格式

Writer Brief 是 rp.leader 发给 rp.writer 的完整叙事剧本。rp.writer 不持有世界状态，它只消费 Brief 中的信息来渲染正文，但渲染本身是多步的：先打草稿、用 stop-slop 自查、再把成稿写入 Brief 指定的 prose 路径并润色。

## 核心原则

### Brief 本身就是信息过滤器

Brief 里有什么，writer 就知道什么。Brief 里没有的，writer 永远不知道。

不需要单独列"信息控制""do_not_reveal""allowed_internality"——不写进 Brief 的信息对 writer 来说就不存在。

### Brief 的信息分层

Brief 按三层组织信息，rp.writer 在 Phase 4a 检查素材完整性、Phase 4c 融合所有层渲染正文：

**1. 素材层（`<material_layer>`）**：
- **场景底色**（`<scene_foundation>`）：关键词式描述（"仪式大厅，彩色玻璃窗，陈旧木材+蜡烛+香料气味"），不含具体措辞
- **Lorebook 引用**（`<lorebook_refs>`）：writer 可读的内容节点路径（如 `lorebook/magic/召唤术式.md`）
- **人物情绪标签**（`<character_states>`）：情绪关键词（"紧张、底气不足"），细节由 writer 演绎
- **LOD 环境音库**（`<lod_ambient_pool>`）：核心 2-3 个事件，按优先级标注（high/medium/low）

**2. 剧情层（`<plot_skeleton>`）**：
- 事件骨架（`<beat>` 标签），不含具体措辞
- 关键台词可完整给出（但不包含"他愤怒地说""声音越来越大"等演绎）

**3. 前情引用（`<context_references>`）**：
- Prose 文件路径（如 `simulation/runs/ticks/000001-summoned/prose.md`）
- Writer 按需 read（不强制全读），例如剧情骨架提到"延续上一幕的紧张气氛"时读前情

**信息分层的意义**：
- 素材层 = 创作原料（writer 有演绎自由）
- 剧情层 = 必须覆盖的节拍（writer 无剧情决策权）
- 前情引用 = 可选上下文（writer 按需消费）

### Brief 是剧情骨架（不是完整剧本）

Brief 提供剧情骨架和素材层，writer 负责演绎成叙事正文：

**Brief 给什么**：
- 剧情骨架：事件逻辑（"薇洛丝站在原地一动不动"），不是成品句式
- 素材层：场景底色、人物情绪标签、lorebook 引用、LOD 环境音库
- 前情引用：prose 文件路径（writer 按需 read）

**Writer 做什么**：
- 把骨架演绎成具体措辞（"她站在那里，光从身后透过彩色玻璃窗照进来，在地板上投出斑驳的影子"）
- 根据情绪标签选择具体表现（"紧张" → "冠冕又歪了一点，手指攥紧权杖"）
- 按剧情密度选用环境音（紧张对话时少用，独处等待时多用）

**新旧对比示例**：

❌ **旧格式（完整剧本）**：
```
薇洛丝决定走向离她最近的眼镜女生。
此时运动男生的声音正好压过大厅的回音，他在对台阶上穿红袍的老人大声质问：
"到底是什么威胁？你连这都不肯说？"
```

✅ **新格式（剧情骨架）**：
```xml
<plot_skeleton>
  <beat>薇洛丝走向眼镜女生</beat>
  <beat>运动男生向子爵质问威胁内容</beat>
  <beat>台词："到底是什么威胁？你连这都不肯说？"</beat>
</plot_skeleton>
```

Writer 的工作是把这个骨架"演绎"成叙事正文，而不是"补完"缺失的信息。缺失的设定细节（如"卷轴材质"）可在 Phase 4a 提问，缺失的剧情逻辑（如"接下来发生什么"）则不应由 writer 补完。

### 不使用 lorebook 术语

writer 和用户是同一个视角。世界设定用**感官描述**代替**概念名词**：

- ✅ "脚下有一片淡蓝色的光圈在缓缓转动，光圈中有细小的、像文字一样的光在游走"
- ❌ "脚下的知识之环符文光环在转动"
- ✅ "之前那个把你们带到这里的仪式留下的痕迹"
- ❌ "异界召唤术式的残余魔力"

如果用户在故事中还不知道某个概念的名字，Brief 中就不能出现这个名字。

### 不出现后台词汇

Brief 的**叙事正文**中不应出现：`brief`、`tick`、`裁决`、`simulator`、`lorebook`、`actor`、`profile` 等后台词汇。

### Brief 必须指定 prose 输出路径

Brief 末尾必须给 writer 一条 prose 输出路径，告诉它把成稿写到哪里。

- 这条路径是给 writer 的**指令元数据**，不是叙事正文，放在 `</writer_brief>` 之后单独一行；路径里的 `ticks` 等词不受上面叙事禁忌限制。
- 路径形如 `simulation/runs/ticks/{id}-{slug}/prose.md`。`{id}-{slug}` 由 rp.leader 按 `simulation/runs/index.md` 顺序分配；id 用六位补零，slug 用短横线英文短语。
- writer 不发明落点，落点由 rp.leader 决定。writer 会先打草稿、用 stop-slop 自查、再 write 这个路径并 edit 润色，最后用一句话回报落点。
- rp.leader 终稿组装时用同一路径生成标题链接（见 README「组装回复」）。

### Brief 给多少 LOD

从 simulator.leader 返回的 LOD 事件中，rp.leader 挑选**核心 2-3 个**放进 `<lod_ambient_pool>`，按优先级标注（high/medium/low）。

**挑选原则**：
- **剧情相关性优先**：与用户化身行动、NPC 反应、场景转折直接相关的事件（high priority）
- **感官密度平衡**：剧情密集时（快速对话、紧张对峙）只给 1-2 个核心事件；独处等待时给 3-5 个营造氛围
- **可感知性过滤**：只给用户化身当前能感知的事件（视线范围、听觉范围）；远处的、隐藏的、微观的不写进 pool

**Writer 如何使用 LOD**：
- Phase 4c 渲染时，按剧情密度选用：
  - 紧张对话场景（如对峙、审问）：只用 high priority，1-2 个，点缀即止
  - 独处等待场景（如观察、沉默、移动）：用 high + medium，3-5 个，营造氛围
- 解析 `<ambient_directives>` 标签获取使用建议（如"剧情密度高时压到最低"）

**示例**：
```xml
<lod_ambient_pool>
  <event priority="high">洛丽塔火花在薇洛丝注视下变色</event>
  <event priority="medium">厨房炖肉香飘进来</event>
  <event priority="low">横梁鸽子被惊飞</event>
</lod_ambient_pool>

<ambient_directives>
  剧情密度高时（对话快速推进）压到最低；独处等待时可拉满
</ambient_directives>
```

### 前情引用格式

`<context_references>` 标签列出 writer 可按需读取的前情 prose 文件：

```xml
<context_references>
  <prose_file>simulation/runs/ticks/000001-summoned/prose.md</prose_file>
  <prose_file>simulation/runs/ticks/000002-confrontation/prose.md</prose_file>
</context_references>
```

**选择原则**（rp.leader 决策）：
- **直接因果**：本 Tick 剧情骨架明确提到"延续上一幕"、"回应刚才的问题"时，引用上一 Tick
- **伏笔呼应**：本 Tick 揭示前情埋下的伏笔（如"火花变色"在 Tick 000001 埋下，Tick 000003 揭示），引用相关 Tick
- **人物状态延续**：NPC 态度/情绪明显受前情影响（如"子爵底气更虚了"），引用初次互动的 Tick

**Writer 如何使用**：
- Phase 4a 检查素材时，如果剧情骨架提到"延续"、"回应"、"变化"等上下文依赖，按需 read 前情
- 不强制全读：如果骨架已经自洽（如"薇洛丝走向眼镜女生"无明确前情依赖），可不读

**注意**：前情引用不是"正文摘要"，是完整 prose 文件路径。Writer 通过 read 工具读取原文，自主提取相关信息。

## Brief 格式

新格式（支持交互式协作）：

```xml
<writer_brief>
  <context_references>
    <!-- 前情引用：prose 文件路径，writer 按需 read -->
    <prose_file>simulation/runs/ticks/000001-summoned/prose.md</prose_file>
    <prose_file>simulation/runs/ticks/000002-confrontation/prose.md</prose_file>
  </context_references>

  <material_layer>
    <!-- 素材层：设定与状态，不含具体措辞 -->
    <scene_foundation>
      仪式大厅，彩色玻璃窗，陈旧木材+蜡烛+香料气味，地面金色纹路熄灭中
    </scene_foundation>

    <lorebook_refs>
      <ref type="magic">lorebook/magic/召唤术式.md</ref>
      <ref type="item">lorebook/item/血契卷轴.md</ref>
    </lorebook_refs>

    <character_states>
      <state character="子爵">紧张、底气不足</state>
      <state character="运动男生">愤怒、不信任</state>
      <state character="眼镜女生">恐惧、试探性信任</state>
    </character_states>

    <lod_ambient_pool>
      <!-- 核心 2-3 个，按优先级标注 -->
      <event priority="high">洛丽塔火花在薇洛丝注视下变色</event>
      <event priority="medium">厨房炖肉香飘进来</event>
      <event priority="low">横梁鸽子被惊飞</event>
    </lod_ambient_pool>
  </material_layer>

  <plot_skeleton>
    <!-- 剧情骨架：事件逻辑，不是成品句式 -->
    <beat>薇洛丝站在原地一动不动</beat>
    <beat>沉默持续，变成引力场，其他人开始注意她</beat>
    <beat>眼镜女生小声问"你不害怕吗？"</beat>
    <beat>薇洛丝转头看她一眼，不带敌意也不带温度，然后移开</beat>
    <climax>洛丽塔女孩发现火花变色，向薇洛丝展示</climax>
  </plot_skeleton>

  <ambient_directives>
    <!-- 可选：环境音使用建议 -->
    剧情密度高时（对话快速推进）压到最低；独处等待时可拉满
  </ambient_directives>
</writer_brief>

prose 输出路径：simulation/runs/ticks/000003-silence/prose.md
```

**兼容旧格式**：rp.writer 检测到无 `<context_references>` 标签时，自动视为旧格式，按现有逻辑处理（保持向后兼容）。

## 每一幕应该包含

- **谁做了什么**：动作节拍，精确到身体语言
- **谁说了什么**：完整台词，包含语气和停顿
- **环境细节**：从 LOD 提取的、用户化身能感知的事件
- **可选的叙事暗示**：如"可以写成后颈微凉的直觉暗示"
- **可选的比喻建议**：如"像是有人突然在安静的图书馆里敲了一下桌子"

## rp.leader 编剧的工作

rp.leader 收到 simulator.leader 的裁决结果后，以用户化身视角组装 Brief。核心工作：

1. **从裁决结果中提取用户化身能感知的信息**：可见反应、台词、可观察的环境变化
2. **过滤掉用户化身不知道的信息**：其他角色的内心独白、lorebook 隐藏设定、simulator 的推理过程——这些直接不写进 Brief
3. **从 LOD 中挑选核心环境事件（2-3 个）**：用感官语言织入 `<lod_ambient_pool>`，按优先级标注；剧情密集时少选，独处等待时多选
4. **提取人物情绪标签**：从 simulator.leader 的裁决中提取情绪关键词（如"紧张、底气不足"），不给演绎细节
5. **组装剧情骨架**：把裁决结果转为事件逻辑（`<beat>` 标签），不含具体措辞；关键台词可完整给出
6. **选择前情引用**：按直接因果、伏笔呼应、人物状态延续原则，选择 0-3 个前情 prose 文件
7. **指定 prose 输出路径**：按 `simulation/runs/index.md` 顺序分配 `{id}-{slug}`，在 Brief 末尾给出 prose 落点，供 writer 写入、供终稿组装生成标题链接

## 示例

完整示例见 [tick-002-example.md](tick-002-example.md)。

以下是新格式核心结构示例：

```xml
<writer_brief>
  <context_references>
    <prose_file>simulation/runs/ticks/000001-summoned/prose.md</prose_file>
  </context_references>

  <material_layer>
    <scene_foundation>
      仪式大厅，彩色玻璃窗，阳光投出彩色光斑，陈旧木材+蜡烛+香料气味，
      地面金色纹路正在熄灭
    </scene_foundation>

    <lorebook_refs>
      <ref type="magic">lorebook/magic/召唤术式.md</ref>
    </lorebook_refs>

    <character_states>
      <state character="子爵">紧张、底气不足、冠冕不稳</state>
      <state character="运动男生">愤怒、不信任、金色光幕因情绪波动变亮</state>
      <state character="眼镜女生">恐惧、试探性信任、攥紧背包</state>
      <state character="洛丽塔女孩">好奇、专注于火花变化</state>
    </character_states>

    <lod_ambient_pool>
      <event priority="high">洛丽塔火花在薇洛丝注视下变色（红蓝→淡紫）</event>
      <event priority="medium">彩色光斑位置偏移（红光从大厅中央移到眼镜女生方向）</event>
      <event priority="medium">西侧窗户灌风，蜡烛晃动，蜡油啪嗒声</event>
      <event priority="low">横梁鸽子被惊飞，带下灰尘</event>
    </lod_ambient_pool>
  </material_layer>

  <plot_skeleton>
    <beat>薇洛丝决定走向眼镜女生</beat>
    <beat>运动男生正在向子爵质问威胁内容，声音压过大厅回音</beat>
    <beat>台词："到底是什么威胁？你连这都不肯说？"</beat>
    <beat>卫兵视线偏向对峙方向，金属甲胄摩擦声</beat>
    <beat>没人在看薇洛丝这边</beat>
    <beat>薇洛丝走过熄灭的金色纹路，几乎无声</beat>
    <beat>途中看到洛丽塔女孩蹲在地上，火花跳跃</beat>
    <beat>洛丽塔发出轻声"诶……？"（火花让金色纹路短暂亮起）</beat>
    <beat>薇洛丝继续前进，在眼镜女生旁边站定</beat>
    <beat>眼镜女生脚下有淡蓝色光圈，文字符号浮动</beat>
    <beat>红色光斑落在蓝色光圈上，文字泛紫</beat>
    <beat>薇洛丝侧头小声问"有没有事"</beat>
    <beat>眼镜女生肩膀抖了一下，确认有人在跟她说话</beat>
    <beat>台词："我……我没事。"（声音很轻）</beat>
    <beat>台词："你、你也是被召唤过来的吧？"</beat>
    <beat>眼镜女生目光扫过薇洛丝，寻找"光幕/火花/符文"，什么都没有</beat>
    <beat>但她没有露出"哑火"眼神</beat>
    <beat>台词："你……你不害怕吗？"</beat>
    <beat>手指松了一点点，不再那么用力攥背包带</beat>
    <climax>台阶上持杖法师注视薇洛丝，眉头微皱，握杖手收紧，然后移开视线</climax>
    <beat>薇洛丝可能感到后颈微凉（被注视的直觉暗示）</beat>
  </plot_skeleton>

  <ambient_directives>
    对峙场景为远景声音层，不抢主线焦点；
    蜡烛、光斑、鸽子等环境音点缀即止；
    洛丽塔火花变色为 high priority，必须体现
  </ambient_directives>
</writer_brief>

prose 输出路径：simulation/runs/ticks/000003-approach-glasses-girl/prose.md
```
