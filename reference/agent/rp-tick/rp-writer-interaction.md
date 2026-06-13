# RP Writer 交互式协作协议

## 概述

rp.writer 从 one-shot 渲染器升级为**交互式协作 agent**：在正式渲染前，先检查 brief 完整性、按需读取前情 prose、向 rp.leader 提问缺失素材，然后融合补充素材完成最终渲染。

**核心设计决策**：
- writer 保留 `read` 工具，限制为"只读 brief 提到的文件"（前情 prose + lorebook 引用）
- Brief 前情提要 = prose 文件引用（writer 按需 read，不是正文摘要）
- Brief 给人物情绪标签（"子爵紧张"），细节由 writer 演绎
- Phase 4a/4c 共用一个 profile（通过 `phase` 字段区分）

## 三阶段流程

```
Phase 4a — writer 素材检查与提问
  → 检查 brief 完整性、按需读前情 prose、提出问题清单（0-5个）
  → 输出：report_result({questions: string[]})

Phase 4b — leader 评估并补充
  → 评估问题合理性、补充素材、拒绝越界问题
  → 输出：supplemental_brief（XML 格式）

Phase 4c — writer 渲染 prose
  → 融合 brief + supplemental_brief → 草稿→自查→写入→润色
  → 输出：直接返回文本（"已将正文写入 xxx.md"）
```

## Phase 4a：素材检查与提问

### 输入

```typescript
{
  phase: 'check',
  brief: string  // 初始 Brief（XML 格式，含前情引用+素材层+剧情骨架）
}
```

Brief 格式见下文"Brief 格式变化"。

### Writer 动作

1. **解析前情引用**：从 `<context_references>` 提取 prose 文件路径
2. **按需读取前情**：不强制全读，writer 自主判断是否需要读（例如剧情骨架提到"延续上一幕的紧张气氛"时读前情）
3. **检查素材完整性**：
   - lorebook 引用是否明确？（例如 brief 提到"血契卷轴"但未给 lorebook 引用）
   - 场景底色是否充分？（光源、气味、空间感）
   - 人物情绪标签是否清晰？（"紧张"是生理紧张还是社交紧张？）
   - LOD 环境音是否足够？（独处等待场景可能需要更多环境音）
4. **提出问题**：0-5 个，按优先级排序

### 提问边界

**允许问的**（设定细节）：
- ✅ "血契卷轴的材质和外观？"
- ✅ "书房的光源除了烛火还有什么？"
- ✅ "仪式大厅的天花板高度大概多少？"
- ✅ "子爵的冠冕是什么材质？"
- ✅ "金色纹路熄灭时有声音吗？"

**不允许问的**（人物动机 / 剧情决策）：
- ❌ "子爵为什么紧张？"（动机）
- ❌ "运动男生接下来会做什么？"（剧情决策）
- ❌ "薇洛丝应该怎么回应？"（用户化身行动）
- ❌ "眼镜女生对薇洛丝的真实态度？"（内心状态，brief 未给出时不问）

**决策树**：
```
问题主语是"什么"/"哪个"/"是否" → 可能是设定细节 → 允许
问题主语是"为什么"/"怎么办" → 可能是动机/决策 → 拒绝
问题涉及 lorebook 引用的具体属性 → 允许
问题涉及人物未说出口的想法 → 拒绝（除非 brief 明确给了情绪标签并说"可深化"）
```

### 输出

```json
{
  "questions": [
    "血契卷轴的材质和外观？",
    "书房的光源除了烛火还有什么？"
  ]
}
```

**空数组快速通道**：`questions: []` 表示无问题，leader 直接跳到 Phase 4c。

## Phase 4b：Leader 评估并补充

### 输入

writer 的 `questions` 数组。

### Leader 动作

1. **逐条评估合理性**：
   - 设定细节（lorebook 引用、场景物理属性、感官信息） → ✓ 允许
   - 人物内心（动机、真实态度、未说出口的想法） → ✗ 拒绝
   - 剧情决策（接下来发生什么、应该怎么做） → ✗ 拒绝

2. **合理问题 → 补充素材**：
   - 优先检索 lorebook（`read` lorebook 引用文件）
   - 如果 lorebook 未定义 → 推理合理设定（基于世界观底色）
   - 补充格式：`<answer>` 标签，简洁直白（50-150 字）

3. **越界问题 → 拒绝**：
   - 格式：`<rejected>` 标签，说明拒绝理由（20-50 字）
   - 理由模板："人物动机由 simulator 裁决，writer 不需要知道"

### 输出

```xml
<supplemental_brief>
  <answer question="血契卷轴的材质和外观？">
    羊皮纸卷轴，边缘烧焦，正面用暗红色墨水书写古语契约文。
    展开约 30cm 长，卷起时拇指粗细。触感粗糙，略有烧焦气味。
  </answer>

  <answer question="书房的光源除了烛火还有什么？">
    西侧窗户透进月光，被窗棂切成斜条纹落在地板上。
    壁炉余烬微红，偶尔爆出火星。没有其他光源。
  </answer>

  <rejected question="子爵为什么紧张？">
    人物动机由 simulator 裁决，writer 不需要知道。
    brief 已给出"紧张"标签，你只需演绎可观察表现。
  </rejected>
</supplemental_brief>
```

## Phase 4c：渲染 prose

### 输入

```typescript
{
  phase: 'render',
  brief: string,
  supplemental_brief?: string  // Phase 4b 产出，可选
}
```

### Writer 动作

1. **融合素材**：
   - 解析 `brief` 的所有层（context_references / material_layer / plot_skeleton / ambient_directives）
   - 如果有 `supplemental_brief`，解析 `<answer>` 标签，将补充素材融入对应位置
   - 忽略 `<rejected>` 标签（已被拒绝的问题不再考虑）

2. **渲染流程**（现有 7 步 workflow）：
   - 脑内打草稿
   - stop-slop 自查
   - write 成稿到 brief 指定的 prose 路径
   - edit 润色复查
   - 一句话说明落点

3. **环境音使用建议**：
   - 解析 `<ambient_directives>` 标签（如"剧情密度高时压到最低"）
   - 从 `<lod_ambient_pool>` 挑选合适数量的事件（high priority 优先）
   - 紧张对话场景：1-2 个环境音，点缀即止
   - 独处等待场景：3-5 个环境音，营造氛围

### 输出

直接返回文本（现有格式）：
```
已将正文写入 simulation/runs/ticks/000003-silence/prose.md
```

## Brief 格式变化

### 新格式结构

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

### 与旧格式对比

| 维度 | 旧格式 | 新格式 |
|------|--------|--------|
| 前情 | 无 | `<context_references>` 文件引用 |
| 场景 | 完整描写（含成品句式） | `<scene_foundation>` 场景底色（关键词） |
| LOD | 全部塞进"场景"段 | `<lod_ambient_pool>` 核心 2-3 个，标注优先级 |
| 人物 | 可感知线索（"后颈微凉"） | `<character_states>` 情绪标签（"紧张"） |
| 剧情 | 分幕完整描写 | `<plot_skeleton>` 事件骨架（beat标签） |

### 兼容性

writer 检测旧格式自动适配：
- 检查是否有 `<context_references>` 标签
- 无新标签 → 视为旧格式，按现有逻辑处理（保持向后兼容）
- 有新标签 → 视为新格式，启用交互式流程

## 风险与缓解

### 风险 1：Phase 4a→4b→4c 增加延迟

**缓解**：
- Phase 4a 支持空数组快速通道（无问题直接跳 4c）
- 限制问题数量上限（5 个）
- 未来优化：leader 预判常见问题，首次 brief 主动补充

### 风险 2：Writer 提问质量低（问越界问题）

**缓解**：
- Prompt 明确边界和反例（"是什么" vs "为什么"）
- Leader 严格拒绝越界问题
- 监控 rejected_questions 频率，调优 prompt

### 风险 3：Leader 判断问题合理性失准

**缓解**：
- Prompt 给出明确规则（问题分类决策树）
- 允许 leader 标注"不确定"，回退到保守拒绝

### 风险 4：Brief 格式迁移破坏现有 Tick

**缓解**：
- Writer 检测旧格式自动适配
- 渐进迁移：新 Tick 用新格式，旧 Tick 不强制改

### 风险 5：Read 工具限制过严（误拦合法读取）

**缓解**：
- 错误信息给出完整允许列表，便于调试
- 支持 lorebook 关键词模糊匹配（未来优化）

## 实现检查清单

- [ ] `builtin-contracts.ts`：定义 RpWriterInputSchema / RpWriterCheckOutputSchema
- [ ] `rp.writer.profile.tsx`：增加阶段说明、read 工具限制、绑定新 schema
- [ ] `rp.leader.profile.tsx`：重写 Brief 生成逻辑、增加 Phase 4b 评估逻辑
- [ ] `writer-brief.md`：增补"信息分层""LOD 原则""前情引用"段
- [ ] `README.md`：Phase 4 拆分说明（4a/4b/4c）
- [ ] 端到端测试：Tick 000003 实际案例验证
