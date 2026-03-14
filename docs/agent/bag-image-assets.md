# 背包界面图像资产清单 v2
> 更新: 2026-03-13 14:50  
> 修复: 使用正确LoRA(GameIconResearch_skill4_Lora) + 512x512尺寸

## 一、v2 状态图标（修复版，质量正确）

| 资产 | 尺寸 | 路径 | 说明 |
|------|------|------|------|
| 力量(STR) | 512x512 | /images/icon_str_v2_20260313_144211_5d8b0cf4.png | 铁甲拳头+火焰 |
| 敏捷(DEX) | 512x512 | /images/icon_dex_v2_20260313_144219_77bfdd66.png | 石祭坛+短剑+闪电 |
| 智力(INT) | 512x512 | /images/icon_int_v2_20260313_144227_bdf6b1b5.png | 蓝色魔法符文箱 |
| 体力(VIT) | 512x512 | /images/icon_vit_v2_20260313_144236_fb4cc005.png | 六边形盾牌徽章 |
| 生命药水 | 512x512 | /images/icon_pot_hp_v2_20260313_144239_ad752aac.png | 红色圆形药水瓶 |
| 魔力药水 | 512x512 | /images/icon_pot_mp_v2_20260313_144242_bec9822c.png | 蓝色六棱宝石瓶 |
| 速度药水 | 512x512 | /images/icon_pot_util_v2_20260313_144244_3a642a22.png | 黄色药水 |
| 负重图标 | 512x512 | /images/icon_weight_v2_20260313_144247_c0286106.png | 铁链铁球 |

## 二、装备槽图标（之前已生成，质量好）

| 槽位 | 路径 |
|------|------|
| 靴子 | /images/boot_slot_20260313_141641.png |
| 项链 | /images/amulet_slot_20260313_141730.png |
| 手套 | /images/gloves_slot_20260313_141732.png |
| 腰带 | /images/belt_slot_20260313_141733.png |
| 胸甲 | /images/chest_slot_20260313_141734.png |
| 腿甲 | /images/legs_slot_20260313_141735.png |
| 金币 | /images/gold_icon_20260313_141736.png |
| 血药 | /images/health_pot_20260313_141737.png |

## 三、图像生成系统配置（正确方式）

```
Python:  E:\AIGC\Flux\backend\venv\Scripts\python.exe
模型:    E:\AIGC\GameIcon\models\checkpoints\gameIconInstitute_v30.safetensors
LoRA:    E:\AIGC\GameIcon\models\loras\GameIconResearch_skill4_Lora.safetensors (alpha=0.5)
尺寸:    512x512（不可用128x128，质量极差）
Steps:   20
CFG:     7.0（不是7.5）
调度器:  EulerAncestral
```

## 四、关键经验（避免重蹈覆辙）

| 错误做法 | 正确做法 |
|----------|----------|
| 128x128 尺寸 | 512x512 尺寸 |
| sxz-icons-v5 LoRA | GameIconResearch_skill4_Lora |
| "muscle fist" 抽象描述 | "heavy iron gauntlet fist raised" 具体物体 |
| 用AI生成UI背景面板 | 用PIL程序生成平面背景（更干净）|

## 五、生成脚本
- 图标: `E:\AIGC\GameIcon\generate_bag_icons_v2.py`
- 装备: `E:\AIGC\GameIcon\generate_equip_icons.py`
- 技能: `E:\AIGC\GameIcon\generate_dark_icons.py`
