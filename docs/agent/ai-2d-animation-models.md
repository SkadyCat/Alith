# AI 生成 2D 动画模型综览（2024-2025）

> 检索时间：2026-03-15 | 来源：DuckDuckGo 实时搜索

---

## 一、开源模型（可本地部署）

### 1. AnimateDiff ⭐⭐⭐⭐⭐
- **定位**：插件式动画生成，接入 SD/SDXL 生成流畅动画
- **特点**：ICLR 2024 Spotlight 论文；plug-and-play，兼容 ComfyUI、WebUI
- **仓库**：https://github.com/guoyww/AnimateDiff
- **WebUI 插件**：https://github.com/continue-revolution/sd-webui-animatediff
- **输入**：文字提示词 / 关键帧图像
- **适合**：角色动画、场景动画、风格化动画

### 2. AnimateAnyone v1/v2 ⭐⭐⭐⭐⭐
- **定位**：单张角色图像 → 驱动姿势动画（Image-to-Video）
- **特点**：阿里 HumanAIGC 出品；v2 已发表于 ICCV 2025；支持环境感知
- **仓库**：https://github.com/HumanAIGC/AnimateAnyone
- **论文**：Animate Anyone 2: High-Fidelity Character Image Animation with Environment Affordance
- **输入**：角色参考图 + 骨骼/姿势序列
- **适合**：2D 角色驱动动画、虚拟主播、游戏角色

### 3. MimicMotion ⭐⭐⭐⭐
- **定位**：基于视频姿态迁移的角色动画
- **特点**：可与 AnimateDiff 联合使用；适合保持角色服装细节
- **参考**：https://civitai.com/articles/7361/animating-characters-with-mimicmotion-animatediff
- **输入**：参考角色图 + 动作参考视频
- **适合**：舞蹈动画、动作迁移

### 4. ToonCrafter ⭐⭐⭐⭐
- **定位**：2D 卡通帧插值 / 动画补帧
- **特点**：专为手绘/卡通风格设计；可做关键帧之间的自动补间
- **适合**：传统手绘动画辅助、卡通片段生成

### 5. LivePortrait ⭐⭐⭐⭐
- **定位**：人脸/肖像驱动动画（Face Animation）
- **特点**：快速推理；支持表情、头部运动驱动
- **适合**：2D 角色面部动画、表情生成

### 6. Wan2.1 (万象) ⭐⭐⭐⭐
- **定位**：开源视频生成模型，支持 T2V（文生视频）/ I2V（图生视频）
- **特点**：阿里 2025 年发布；ComfyUI 原生支持；与 Hailuo 有对比测试
- **参考**：https://www.youtube.com/watch?v=Y2VMkOK8Yc8
- **适合**：2D 场景动画、风格化视频生成

---

## 二、商业/在线平台

| 平台 | 特点 | 链接 |
|------|------|------|
| **DomoAI** | 视频转动漫风格，专为 2D 动画设计 | https://domoai.app |
| **MiniMax Hailuo 02** | 全球 #2 AI 视频模型，1080P 高质量 | https://hailuoai.video |
| **Runway ML** | 多功能视频生成，支持动画风格 | https://runwayml.com |
| **CapCut AI** | 一键 Anime 风格视频转换 | https://capcut.com |
| **LTX Studio** | AI Anime 生成器，角色场景生成 | https://ltx.studio |
| **Adobe Firefly** | Adobe 官方 AI，集成创意流程 | https://firefly.adobe.com |

---

## 三、ComfyUI 工作流推荐

- **视频转动画**：https://comfyui.org/en/video-to-animation-with-ai
- **图片卡通化**：https://comfyui.org/en/transform-cartoon-photos-with-ai
- **2D→3D 动画**：https://openart.ai/workflows/koalanation/2d-to-3d-animation

---

## 四、选型建议

| 需求 | 推荐模型 |
|------|---------|
| 文字生成 2D 动画片段 | AnimateDiff + SD |
| 单张图 → 角色动起来 | AnimateAnyone v2 |
| 动作/舞蹈迁移 | MimicMotion |
| 卡通帧插值补间 | ToonCrafter |
| 面部表情驱动 | LivePortrait |
| 不想部署、直接用 | DomoAI / Hailuo |

---

*数据来源：DuckDuckGo 搜索，检索于 2026-03-15*