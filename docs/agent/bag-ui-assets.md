# 背包 UI 图像资产生成记录

## 生成日期
2026-03-13

## 使用工具

### SDXL 本地服务
- **服务地址**: `http://localhost:8332/api/generate`
- **进程**: PID 76356, `E:\AIGC\SDXL\backend\main.py`
- **模型**: WAI-Illustrious SDXL v1.6 (waiIllustriousSDXL_v160.safetensors)
- **GPU**: RTX 4080 SUPER 16GB

### 调用方式
```python
import requests, os
os.environ.pop("HTTP_PROXY", None)  # 绕过 Clash 代理
requests.post("http://localhost:8332/api/generate", 
    proxies={"http": None, "https": None},
    json={
        "prompt": "...",
        "negative_prompt": "...",
        "width": 512, "height": 512,
        "num_inference_steps": 20,
        "guidance_scale": 7.0,
        "seed": 42
    })
```

## 生成结果

### 背景图（512×512）

| 文件 | 用途 | Seed | 生成时间 |
|------|------|------|---------|
| `bag_background.png` | 背包内部背景（皮革/木格子） | 12345 | 2.56s |
| `bag_panel_border.png` | 面板边框（哥特石框） | 67890 | 2.39s |

### 状态图标（256×256）

| 文件 | 图标 | 用途 | Seed |
|------|------|------|------|
| `icon_hp.png` | ❤️ | 生命值 HP | 1001 |
| `icon_mana.png` | 💎 | 魔法值 MP | 1002 |
| `icon_attack.png` | ⚔️ | 攻击力 | 1003 |
| `icon_defense.png` | 🛡️ | 防御力 | 1004 |
| `icon_speed.png` | 💨 | 移动速度 | 1005 |
| `icon_weight.png` | ⚖️ | 负重/容量 | 1006 |

## 文件位置

```
E:\docs-service\public\images\bag-ui\
  ├── bag_background.png    (394KB)
  ├── bag_panel_border.png  (503KB)
  ├── icon_hp.png           (86KB)
  ├── icon_mana.png         (93KB)
  ├── icon_attack.png       (93KB)
  ├── icon_defense.png      (84KB)
  ├── icon_speed.png        (87KB)
  └── icon_weight.png       (104KB)
```

## 在线访问地址

```
http://localhost:8331/images/bag-ui/bag_background.png
http://localhost:8331/images/bag-ui/icon_hp.png
... (etc)
```

## 其他可用图像生成工具

| 工具 | 地址 | 模型 | 状态 |
|------|------|------|------|
| SDXL Backend | localhost:8332 | WAI-SDXL v1.6 | ✅ 正常 |
| SDXL Service | localhost:8189 | wai-sdxl (代理) | ❌ /generate 500 |
| ComfyUI Wrapper | localhost:8188 | SDXL (ComfyUI格式) | ❌ 后端未配置 |
| GameIcon Scripts | E:\AIGC\GameIcon\ | gameIconInstitute v3.0 | ✅ 可直接运行脚本 |
| SDXL Scripts | E:\AIGC\SDXL\generate.py | WAI-SDXL | ✅ 可直接运行 |

## 注意事项

1. **代理问题**: Python requests 会自动使用 Clash 代理 (127.0.0.1:7890)，访问 localhost 时需要手动绕过
2. **VRAM 占用**: RTX 4080 SUPER 16GB 当前使用 15.7GB，无法同时加载多个大模型
3. **生成速度**: SDXL 20步 512x512 约 2.3-2.6s（GPU 加速）