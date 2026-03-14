# Bag2 UI 图像资产 v2

> 生成时间：2026-03-13  
> 生成方法：SDXL 背景 + GameIcon 图标（修正版）

## 生成方案

| 资产类型 | 模型 | 服务 | 问题 |
|---------|------|------|------|
| 背景/面板 | WAI-Illustrious SDXL v1.6 | http://localhost:8332 | 之前错用了图标模型 |
| 属性/药水图标 | GameIcon Institute v3.0 + sxz-icons LoRA | diffusers | 触发词和prompt优化 |

## 资产清单

### 背景图（SDXL 生成）

| 用途 | 文件 | 尺寸 |
|------|------|------|
| 主背景面板 | /images/20260313_144744_e4a3279f.png | 768x512 |
| 子面板底图 | /images/20260313_144747_940435fc.png | 512x512 |

### 图标（GameIcon + LoRA 生成）

| 用途 | 文件 | 尺寸 |
|------|------|------|
| STR 力量 | /images/ui_icon_str_20260313_144820.png | 128x128 |
| DEX 敏捷 | /images/ui_icon_dex_20260313_144822.png | 128x128 |
| INT 智力 | /images/ui_icon_int_20260313_144824.png | 128x128 |
| VIT 活力 | /images/ui_icon_vit_20260313_144825.png | 128x128 |
| HP 药水 | /images/ui_icon_hp_20260313_144827.png | 128x128 |
| MP 药水 | /images/ui_icon_mp_20260313_144829.png | 128x128 |
| 速度药水 | /images/ui_icon_spd_20260313_144830.png | 128x128 |
| 金币 | /images/ui_icon_gold_20260313_144832.png | 128x128 |
| 负重 | /images/ui_icon_weight_20260313_144834.png | 128x128 |

## 为什么之前失败

旧版问题：
1. 背景用了 gameIconInstitute + icon LoRA → 输出图标风格拼贴，不是材质纹理
2. Prompt 混合了"dungeon scene"和图标模型触发词 → 模型不知道该生成什么
3. SDXL prompt 没有加足够的反动漫负面词

新版修正：
1. 背景用 SDXL (8332)，强力负面词压制动漫风
2. 图标用 GameIcon + LoRA，必须以 "Game Icon Research Institute, game icons," 触发
3. 图标 prompt 描述具体视觉元素（颜色、形状、材质），不描述概念
