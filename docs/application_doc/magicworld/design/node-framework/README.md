# MagicWorld 技能节点组合框架 (Skill Node Graph Framework)

> **版本**: v1.0  
> **设计目标**: 通过有向图形式的原子节点组合，实现任意技能效果的无限可能性。

---

## 一、设计思路

### 核心哲学

现有系统是**扁平标签匹配**：技能是固定实体，辅助宝石通过 tag 附着其上。  
新框架将技能重新定义为**有向节点图**：技能 = 一组原子节点 + 连接它们的边。

> 类比：就像 Unreal 蓝图/着色器图，每个节点做一件事，通过连线组合出任意结果。

### 两种端口：Exec vs Signal

| 端口类型 | 含义 | 特点 |
|---------|------|------|
| **exec** | 执行流 | 线性、确定性；技能释放时必定流经 |
| **signal** | 事件信号 | 事件驱动；仅当特定事件发生时触发 |

这个区分是整个框架的关键——  
- exec 流控制**主管线**（投射物飞行 → 修饰 → 命中效果）  
- signal 流控制**事件链**（命中时 → 条件判断 → 二次技能）

---

## 二、节点分类（7 大类型）

```
┌─────────────┬──────────────────────────────────────────────────────┐
│  Source     │  技能入口。定义触发方式（主动/被动/光环/反应）        │
│  Delivery   │  效果载体。定义技能如何到达目标（投射/范围/射线...） │
│  Modifier   │  行为修饰。改变 Delivery 的运动轨迹或弹道规则        │
│  Effect     │  最终效果。对目标施加伤害/治疗/增减益/控制           │
│  Condition  │  事件门。监听信号，满足条件时开启二次执行管线         │
│  Transform  │  数据运算。对数值做缩放/加法/随机/插值运算           │
│  Filter     │  目标筛选。从目标列表中按规则筛选子集                │
└─────────────┴──────────────────────────────────────────────────────┘
```

### 2.1 Source 节点（入口）

| subtype | 说明 | 关键参数 |
|---------|------|---------|
| `active_cast` | 玩家主动释放 | mpCost, cooldown, castTime, channeled |
| `passive_proc` | 条件触发被动 | trigger_on, chance, cooldown |
| `aura_pulse` | 光环周期脉冲 | radius, interval, mpPerSec |
| `reaction` | 响应另一技能的信号 | listen_to_skill, listen_signal |

### 2.2 Delivery 节点（载体）

| subtype | 说明 | 关键参数 |
|---------|------|---------|
| `projectile` | 投射物 | speed, range, count, element |
| `area` | 范围爆发 | radius, shape(circle/cone/line/ring), element |
| `beam` | 持续射线 | length, width, tickRate, element |
| `instant` | 即时命中 | targets_count, element |
| `persistent` | 持续场地效果 | duration, radius, interval |
| `summon` | 召唤实体 | entity_id, count, duration, ai_behavior |

**输出端口**：  
- `exec` → 主流程继续  
- `signal:on_hit` → 命中时  
- `signal:on_expire` → 消失/到期时  
- `signal:on_kill` → 击杀时  
- `data:target_list` → 当前命中目标列表

### 2.3 Modifier 节点（轨迹修饰）

| subtype | 说明 | 与什么冲突 |
|---------|------|-----------|
| `split` | 命中或中途分裂为多枚 | fork |
| `fork` | 发射时即分叉 | split |
| `bounce` | 弹跳到相邻目标 | — |
| `pierce` | 穿透目标继续飞行 | — |
| `chain` | 在目标间跳跃传导 | — |
| `homing` | 追踪最近目标 | — |
| `spiral` | 螺旋轨迹 | — |
| `orbit` | 绕释放者旋转 | — |

### 2.4 Effect 节点（效果）

| subtype | 说明 | 关键参数 |
|---------|------|---------|
| `damage` | 瞬间伤害 | base, element, crit_chance, crit_mult |
| `dot` | 持续伤害 | damage_per_tick, duration, interval, stacks, element |
| `heal` | 治疗 | base, hot(持续治疗), duration |
| `buff` | 增益 | stat, amount, duration |
| `debuff` | 减益 | stat, amount, duration |
| `cc` | 控制 | type(freeze/stun/slow/root), duration, magnitude |
| `shield` | 护盾 | amount, duration, element_absorb |
| `drain` | 生命汲取 | amount, return_ratio |
| `mark` | 标记 | mark_id, stack_max, on_consume(effect_ref) |

### 2.5 Condition 节点（事件门）

| subtype | 监听的信号 | 关键参数 |
|---------|----------|---------|
| `on_hit` | signal:on_hit | chance(0~1) |
| `on_crit` | signal:on_hit (含暴击标志) | — |
| `on_kill` | signal:on_kill | — |
| `on_expire` | signal:on_expire | — |
| `on_hp_below` | 目标当前HP | threshold(0~1) |
| `on_stack_max` | 监听某 mark/dot 的层数 | mark_id, stack_count |
| `on_consume_mark` | 消耗标记时 | mark_id |

### 2.6 Transform 节点（数据运算）

用于在 data 端口间做计算，将一个值缩放后传给 Effect 节点的参数。

| subtype | 说明 |
|---------|------|
| `scale` | value × stat_percent（如 攻击力% ） |
| `add` | value + constant |
| `clamp` | min/max 限制 |
| `random` | 随机范围 |
| `lerp` | 按HP/距离等插值 |

### 2.7 Filter 节点（目标筛选）

接收 `data:target_list`，输出筛选后的子集，再传给下级 Delivery/Effect。

| subtype | 说明 |
|---------|------|
| `enemies_only` | 只选敌方 |
| `allies_only` | 只选友方 |
| `self` | 只选释放者自身 |
| `nearest_n` | 最近 N 个 |
| `lowest_hp` | 血量最低者 |
| `has_mark` | 有特定标记的目标 |

---

## 三、端口类型系统

端口只能连接**相同类型**的端口，引擎在图构建阶段做静态校验：

| 类型 | 说明 |
|------|------|
| `exec` | 执行流（必须连接，否则节点不会激活） |
| `signal:on_hit` | 命中信号 |
| `signal:on_expire` | 到期信号 |
| `signal:on_kill` | 击杀信号 |
| `data:number` | 数值 |
| `data:element` | 元素类型 |
| `data:target_list` | 目标列表引用 |
| `data:entity_ref` | 实体引用 |
| `data:effect_ref` | 效果引用 |

---

## 四、执行模型

```
技能释放
   │
   ▼
[Source] ──exec──▶ [Delivery] ──exec──▶ [Modifier*] ──exec──▶ [Effect]
                       │
                  signal:on_hit ──▶ [Condition] ──exec──▶ [Delivery] ──exec──▶ [Effect]
                       │                                      ↑
                  signal:on_kill ──▶ [Condition] ────────────┘
                       │
                  signal:on_expire ──▶ [Condition] ──exec──▶ [Effect]
```

### 执行规则

1. **Source 激活** → 沿 exec 边广度优先执行
2. **Delivery 执行** → 同时注册 signal 监听器（事件驱动）
3. **Modifier 链** → 多个 Modifier 串联在同一 exec 流上，顺序影响结果
4. **Condition** → 收到 signal 时判断，满足则向下传递 exec
5. **递归深度限制** → 最大链深度 = 4（防止无限循环）
6. **同一目标防重复** → 每帧内同一效果对同一目标最多触发一次

---

## 五、平衡系统：节点权重

每个节点有"复杂度权重"，技能图总权重受以下因素限制：

| 限制因素 | 说明 |
|---------|------|
| 技能稀有度 | 普通=10, 魔法=14, 稀有=18, 史诗=24, 传奇=32, 传说=48 |
| 角色等级 | 每5级+1上限 |
| 装备插槽数 | 每个激活插槽+2 |

**各类节点权重：**

| 节点类型 | 基础权重 |
|---------|---------|
| Source | 0（不计）|
| Delivery | 3 |
| Modifier | 2 |
| Effect | 2 |
| Condition | 1 |
| Transform | 1 |
| Filter | 1 |

---

## 六、组合示例

### 示例 A：火球术（简单）

```
[active_cast] →exec→ [projectile(fire)] →exec→ [damage(150%,fire)]
                           │
                      on_hit→ [on_hit] →exec→ [dot(30%,fire,3s)]
```

---

### 示例 B：冰霜裂变穿透箭（中等）

```
[active_cast] →exec→ [projectile(ice,3枚)] →exec→ [pierce(2)] →exec→ [damage(120%,ice)]
                             │
                        on_hit(暴击)→ [on_crit] →exec→ [area(r:5,ice)] →exec→ [cc(freeze,2s)]
```

---

### 示例 C：毒爆连锁（高级，被动反应链）

```
[passive_proc(on_kill)] →exec→ [area(r:8)] →exec→ [mark(poison_mark,max:5)]
                                    │
                               on_hit→ [on_stack_max(5)] →exec→ [area(r:12)] →exec→ [damage(500%,poison)]
```

---

### 示例 D：吸血光环（光环类）

```
[aura_pulse(interval:1s,r:10)] →exec→ [filter:enemies_only] →exec→ [drain(amount:80,return:50%)]
                                                                          │
                                                               data:heal→ [heal(self)]
```

---

## 七、节点图 JSON Schema

```json
{
  "schema_version": "1.0",
  "id": "skill_custom_001",
  "name": "冰裂箭",
  "rarity": "稀有",
  "tags": ["投射物", "冰霜", "持续"],
  "nodes": [
    {
      "id": "n1",
      "type": "source",
      "subtype": "active_cast",
      "label": "主动释放",
      "params": { "mpCost": 35, "cooldown": 10, "castTime": 0.4 }
    },
    {
      "id": "n2",
      "type": "delivery",
      "subtype": "projectile",
      "label": "冰矢",
      "params": { "speed": 22, "range": 30, "count": 1, "element": "ice" }
    },
    {
      "id": "n3",
      "type": "modifier",
      "subtype": "pierce",
      "label": "穿透",
      "params": { "count": 2, "damage_decay": 0.85 }
    },
    {
      "id": "n4",
      "type": "effect",
      "subtype": "damage",
      "label": "冰伤害",
      "params": { "base": "180%", "element": "ice", "crit_chance": 0.1 }
    },
    {
      "id": "n5",
      "type": "condition",
      "subtype": "on_crit",
      "label": "暴击触发",
      "params": {}
    },
    {
      "id": "n6",
      "type": "delivery",
      "subtype": "area",
      "label": "冰爆",
      "params": { "radius": 5, "shape": "circle", "element": "ice" }
    },
    {
      "id": "n7",
      "type": "effect",
      "subtype": "cc",
      "label": "冻结",
      "params": { "type": "freeze", "duration": 2.5 }
    }
  ],
  "edges": [
    { "from": "n1.exec",           "to": "n2.exec" },
    { "from": "n2.exec",           "to": "n3.exec" },
    { "from": "n3.exec",           "to": "n4.exec" },
    { "from": "n2.signal:on_hit",  "to": "n5.signal:on_hit" },
    { "from": "n5.exec",           "to": "n6.exec" },
    { "from": "n6.exec",           "to": "n7.exec" }
  ],
  "meta": {
    "total_weight": 13,
    "max_weight": 18,
    "author": "system"
  }
}
```

---

## 八、运行时引擎（伪代码）

```javascript
class SkillNodeEngine {
  execute(graph, caster, initialTarget) {
    const ctx = new ExecutionContext(caster, initialTarget);
    const source = graph.nodes.find(n => n.type === 'source');
    this._runNode(source, ctx, graph, depth=0);
  }

  _runNode(node, ctx, graph, depth) {
    if (depth > 4) return; // 防递归深度限制

    // 执行节点本体逻辑
    const result = NodeRegistry[node.subtype].execute(node.params, ctx);

    // 沿 exec 边继续主流程
    graph.edgesFrom(node.id, 'exec').forEach(edge => {
      this._runNode(graph.node(edge.to), ctx, graph, depth);
    });

    // 注册 signal 监听器（事件驱动分支）
    result.signals?.forEach(sig => {
      sig.onTrigger((sigCtx) => {
        graph.edgesFrom(node.id, `signal:${sig.name}`).forEach(edge => {
          this._runNode(graph.node(edge.to), sigCtx, graph, depth + 1);
        });
      });
    });
  }
}

// 每个 subtype 注册一个处理器
NodeRegistry['projectile'] = {
  execute(params, ctx) {
    const proj = SpawnProjectile(params, ctx.caster);
    const signals = [
      proj.onHit((target) => ctx.emitSignal('on_hit', target)),
      proj.onExpire(() => ctx.emitSignal('on_expire', null)),
      proj.onKill((target) => ctx.emitSignal('on_kill', target)),
    ];
    return { signals };
  }
};

NodeRegistry['damage'] = {
  execute(params, ctx) {
    const dmg = calcDamage(params.base, params.element, ctx.caster, ctx.target);
    ctx.target.applyDamage(dmg);
    return { signals: [] };
  }
};
```

---

## 九、扩展路线图

| 阶段 | 内容 |
|------|------|
| **v1** | 7类核心节点 + exec/signal 双流 + 静态图校验 |
| **v2** | 可视化节点编辑器（拖拽连线，实时预览权重） |
| **v3** | 动态节点参数（接受 Transform 节点的 data 输入） |
| **v4** | 技能合成（两个技能图合并，产生新的组合效果） |
| **v5** | AI 自动生成节点图（基于描述文本生成技能） |

---

## 十、与现有系统的关系

| 现有概念 | 映射到新框架 |
|---------|------------|
| `skills.json` 的 tags | 由图中节点类型自动推导，无需手填 |
| `supports.json` 的辅助宝石 | 变为预制 Modifier/Effect 节点，插入图中 |
| `delivery_types.json` | 对应 Delivery 节点的 subtype |
| `modifiers.json` | 对应 Modifier 节点的 subtype |
| `effects.json` | 对应 Effect 节点的 subtype |

> **兼容策略**：现有 `skills.json` 可一键转换为只含 `[Source→Delivery→Effect]` 的最简节点图，保持向后兼容。

---

*设计者：爱丽丝 | 2026-03-16*
