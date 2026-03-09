# PoB 伤害计算流程文档

> 本文档记录 pob-web 应用中对 Path of Building 伤害数值的解析与计算流程。
> 参考构筑：冬潮烙印（女巫 Elementalist Lv73，定罪波 Wave of Conviction L17）

---

## 一、总体计算公式

```
单次平均命中 = base_avg × inc_factor × more_product × crit_scale
```

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `base_avg` | 基础伤害均值（含技能基础 + 附加伤害×效率） | 2214 |
| `inc_factor` | 增伤系数 = `1 + inc_total / 100` | 6.73 (573%) |
| `more_product` | 各"更多"乘区连乘 | 1.0（无乘区） |
| `crit_scale` | 暴击均摊系数 | 1.078 |
| **最终** | `computed_avg_hit` | **14900** |

> PoB 原始值：`AverageHit = 15373`，吻合率 **96.9%**

---

## 二、基础伤害（Base）

### 2.1 来源

基础伤害 = 技能自身基础值 + Σ（附加伤害词条 × 技能效率）

| 字段 | 含义 |
|------|------|
| `base_min` | 基础伤害下限 | 
| `base_max` | 基础伤害上限 |
| `base_avg` | 均值 = `(base_min + base_max) / 2` |
| `damage_effectiveness` | 技能对附加伤害的效率系数（如 3.2 = 320%） |
| `available_effectiveness` | 当前构筑中所有附加伤害词条 × effectiveness 之和 |

### 2.2 计算过程（法术）

```
base_avg = 技能宝石自带基础 + 附加元素/物理伤害词条 × damage_effectiveness
```

- `damage_effectiveness`（定罪波 L17）= **3.2**
- 意味着：如有 "+100 点火焰伤害" 词条，实际贡献 100 × 3.2 = **320** 点基础

### 2.3 技能标签（影响哪些增伤词条有效）

`skill_tags`：`['Spell', 'Mine', 'Projectile', 'Totem', 'Lightning', 'Trap', 'Elemental', 'Fire', 'Cold', 'Area', 'Physical']`

增伤词条生效的前提：词条的伤害类型标签必须与技能标签有交集。

---

## 三、增伤区（Inc Multipliers，加法叠加）

**性质**：所有"增加伤害"词条 **加法** 叠加为一个数值。

```
inc_factor = 1 + inc_total / 100
```

### 3.1 天赋树节点（inc_nodes_detail）

每个节点包含：

| 字段 | 含义 |
|------|------|
| `mod` | 词条中文描述 |
| `pct` | 增伤百分比（如 10.0 = 10%） |
| `source` | 节点名称 |
| `node_id` | 天赋树节点 ID（用于前端定位高亮） |
| `_en` | 英文原文 |

示例（共 31 个节点，合计 ~520%）：
```json
{"mod": "元素伤害增加 10%", "pct": 10.0, "source": "元素伤害", "node_id": "4184"}
{"mod": "法术伤害增加 10%", "pct": 10.0, "source": "法术伤害", "node_id": "17579"}
```

### 3.2 装备词条（inc_items_detail）

每个词条包含：

| 字段 | 含义 |
|------|------|
| `mod` | 词条中文描述 |
| `pct` | 增伤百分比 |
| `source` | 装备栏位+名称 |
| `slot_en` | 英文栏位（用于前端高亮装备格） |
| `item_name` | 装备名称 |

示例（共 2 条，合计 ~53%）：
```json
{"mod": "法术伤害增加 10%", "pct": 10.0, "slot_en": "Ring 1", "item_name": "Vortex Gyre"}
{"mod": "法术伤害增加 43%", "pct": 43.0, "slot_en": "Weapon 1", "item_name": "Dire Spire"}
```

### 3.3 汇总

```
inc_total = Σ inc_nodes + Σ inc_items = ~520 + ~53 = 573%
inc_factor = 1 + 5.73 = 6.73
```

---

## 四、乘区（More Multipliers，乘法叠加）

**性质**：每个"更多伤害"来源相互 **乘法** 叠加。

```
more_product = Π (1 + m.mult)   对所有 m in more_chain
```

每个乘区节点（`more_chain`）包含：

| 字段 | 含义 |
|------|------|
| `mult` | 乘数（如 0.39 = 更多 39%） |
| `name_cn` | 来源名称（中文） |
| `name_en` | 来源名称（英文） |
| `stat` | 原始 stat 字符串 |

> 当前构筑无乘区（`more_chain = []`），故 `more_product = 1.0`

常见乘区来源（其他构筑中可能出现）：
- 辅助宝石：增倍、集中效果、无情等
- 主动技能本身的更多系数
- 天赋树特定节点

---

## 五、暴击均摊（Crit Scaling）

暴击不增加每次命中伤害，而以概率均摊的方式体现：

```
crit_scale = 1 + crit_chance × (crit_multi - 1)
```

| 字段 | 含义 | 示例 |
|------|------|------|
| `crit_chance` | 暴击率（%） | 7.8% |
| `crit_multi` | 暴击倍率 | 1.0（即 100%，未加成） |
| `crit_scale` | 均摊系数 | `1 + 0.078 × 0` = 1.0... |

> 注：crit_scale=1.078 说明实际 crit_multi > 1（约 2.0×），PoB 内部取值与显示有差异。

---

## 六、DPS 汇总

| 字段 | 含义 | 示例值 |
|------|------|--------|
| `computed_avg_hit` | 我们计算的单次命中 | 14,900 |
| `pob_avg_hit` | PoB 内 AverageHit 原始值 | 15,373 |
| `TotalDPS` | PoB 总 DPS（命中×速度×...） | 32,503 |
| `Speed` | 攻击/施法速度（次/秒） | 2.11 |
| `CombinedDPS` | 综合DPS（含点燃/DOT等） | 114,667 |

---

## 七、API 接口

### 请求

```http
POST http://localhost:7893/api/analyze/doc
Content-Type: application/json

{"doc_path": "poe/pob_list/冬潮烙印.md"}
```

### 响应结构

```json
{
  "success": true,
  "build": {
    "class": "...",
    "level": 73,
    "stats": [...],
    "skills": [...],
    "items": [...],
    "tree": {...},
    "damage_breakdown": {
      "skill_name": "Wave of Conviction",
      "skill_cn": "定罪波",
      "gem_level": 17,
      "slot": "...",
      "base_min": 1771,
      "base_max": 2657,
      "base_avg": 2214.0,
      "damage_effectiveness": 3.2,
      "available_effectiveness": 2213.9,
      "skill_tags": ["Spell", "Elemental", ...],
      "inc_nodes_detail": [...],
      "inc_items_detail": [...],
      "inc_total": 573.0,
      "inc_factor": 6.73,
      "more_chain": [],
      "more_product": 1.0,
      "crit_chance": 7.8,
      "crit_multi": 1.0,
      "crit_scale": 1.078,
      "computed_avg_hit": 14900,
      "pob_avg_hit": 15373,
      "pob_derived_inc_pct": null
    }
  }
}
```

---

## 八、前端渲染（drawDmgTree）

前端用 Canvas 绘制树状图，每个乘区作为独立 **Layer**：

```
[DPS] → [单次命中] → [基础伤害] → [增伤叠加] → [乘区0] → [乘区1] → [暴击均摊]
         ↓
      叶节点区域（最底部）
      ├── 🌳 天赋节点增伤（N条，点击可跳转到天赋树）
      └── ⚔️ 装备词条增伤（N条，点击可高亮装备栏）
```

- **点击天赋叶节点**：调用 `goToNode(node_id)` 跳转天赋树并高亮
- **点击装备叶节点**：调用 `goToSlot(slot_en)` 切换装备Tab并高亮对应格

---

## 九、已知误差与局限

| 问题 | 原因 | 误差量 |
|------|------|--------|
| computed vs PoB AverageHit ~3% 差异 | 部分 stat 未捕获（如抵抗穿透、双手武器加成等） | ~473 |
| more_chain 可能遗漏乘区 | stat 解析规则不完整 | 待优化 |
| 暴击倍率读取不准 | crit_multi 字段来源需进一步验证 | 影响 crit_scale |

---

*文档生成：pob-web agent，参考构筑：冬潮烙印（Elementalist）*