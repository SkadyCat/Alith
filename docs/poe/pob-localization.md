# PoeCharm3 汉化架构分析

## 结论：非侵入式 DLL 层翻译

PoeCharm3 **未修改任何 Lua 源代码**，所有汉化在 DLL 层完成。

---

## 架构组件

### 核心执行层
| 文件 | 大小 | 作用 |
|------|------|------|
| `PoeCharm3.exe` | 16MB | 主程序，替换原版 `Path of Building.exe` |
| `SimpleGraphicExtend.dll` | 1.8MB | 扩展渲染引擎，支持 CJK 字符渲染 |
| `loadall.dll` | 372KB | 加载所有翻译 CSV，拦截字符串渲染 |
| `libquickjs.dll` | 1.3MB | QuickJS JS引擎，用于翻译处理逻辑 |

### 文字渲染支持
| 文件 | 说明 |
|------|------|
| `freetype.dll` | FreeType 字体渲染（支持 TTF/CJK） |
| `harfbuzz.dll` | HarfBuzz 文字塑形（Unicode 分词/排版） |
| `fribidi-0.dll` | 双向文字支持（Unicode BIDI） |

### 字体系统
- **`Data/Fonts/FZ_ZY.ttf`**（9.3MB）：方正综艺中文字体，唯一字体文件
- **`.tgf` 文件**：原版 PoB 字体引用文件（Fontin、Bitstream Vera 等），全部被重定向为 `FZ_ZY.ttf`

TGF 文件格式（JSON）：
```json
{
  "fonts": [{ "file": "FZ_ZY.ttf", "scale": 1.0 }]
}
```
所有 PoB 字体请求（Fontin Regular/Italic/SmallCaps、Liberation Sans、Bitstream Vera）全部映射到同一个中文 TTF。

---

## 翻译数据结构

位置：`Data/Translate/`
- `zh-rCN/`（简体中文，**64个CSV**）
- `zh-rTW/`（繁体中文，19个CSV）
- `ko-KR/`（韩语，80个CSV）

### CSV 格式
简单的 `英文原文,中文译文` 两列 CSV：
```csv
All,全部
Delete,删除
"Build Share",构筑分享
```

### 翻译覆盖范围
| 文件 | 大小 | 内容 |
|------|------|------|
| `statDescriptions.csv` | **4.35MB** | 最大，所有属性描述（DPS、防御等计算结果文本） |
| `tree_sd.csv` | **603KB** | 被动天赋树节点描述 |
| `tree_dn.csv` | **146KB** | 被动天赋树节点名称 |
| `ConfigOptions.csv` | 76KB | 配置选项界面 |
| `passiveTree.csv` | 39KB | 被动树 UI 文本 |
| `Uniques.txt.csv` | 58KB | 传奇物品名称和词缀 |
| `Items_Armour.txt.csv` | 45KB | 护甲物品翻译 |
| `Items_Gems.txt.csv` | 42KB | 技能宝石翻译 |
| `Items_Weapons.txt.csv` | 31KB | 武器翻译 |
| `GUI.csv` | 7KB | 通用 UI 字符串 |
| `Build.csv` | 2KB | 构筑管理 UI |
| `CalcOffence.csv` | 8KB | 攻击计算面板 |

---

## 工作原理（推测）

```
PoeCharm3.exe 启动
  → 加载 loadall.dll（拦截字符串渲染系统）
  → 加载 SimpleGraphicExtend.dll（替换字体渲染为 FreeType + HarfBuzz）
  → 从 Data/Settings.conf 读取语言设置（zh-rCN）
  → 从 Data/Translate/zh-rCN/*.csv 加载所有翻译表到内存
  → 启动 PathOfBuildingCommunity-Portable/（PoB Lua 引擎，全英文）
  → 每次 PoB 渲染一个字符串时，loadall.dll 拦截并返回中文译文
  → FreeType + FZ_ZY.ttf 渲染中文字符到屏幕
```

---

## 关键发现

- **Lua 源码 100% 原版英文**：`Modules/`、`Classes/`、`Data/` 下 0 个中文字符
- **翻译无需重新编译**：CSV 可直接编辑更新翻译
- **支持多语言**：同一架构支持简体中文、繁体中文、韩语
- **字体全局替换**：`.tgf` 文件让所有英文字体全部用中文TTF渲染

---

## 路径参考
```
G:\poegj\PoeCharm3[20251103]-Release-3.5.0\
  PoeCharm3.exe                    # 主程序
  SimpleGraphicExtend.dll          # 渲染扩展
  loadall.dll                      # 翻译加载器
  Data\
    Fonts\
      FZ_ZY.ttf                    # 中文字体 9.3MB
      Fontin.tgf                   # 字体重定向到 FZ_ZY.ttf
    Translate\
      zh-rCN\                      # 简体中文 64个CSV
        statDescriptions.csv       # 最大 4.35MB 属性描述
        tree_sd.csv                # 603KB 天赋树描述
    Settings.conf                  # 当前语言: zh-rCN
  PathOfBuildingCommunity-Portable\ # 标准 PoB 2.60.0，完全未修改
```