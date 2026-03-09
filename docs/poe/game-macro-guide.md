# POE1 屏幕宏游戏辅助 - 技术指南

> 研究日期：2026-03-07  
> ⚠️ **重要提示：请先阅读风险说明**

---

## 一、GGG 官方政策（必读）

### ✅ 允许的行为
- **简单按键宏**：一次按键 = 一个动作（按一键同时激活多个药瓶）
- **Logout 宏**：一键退出游戏（常用于安全机制）
- **AHK 按键映射**：将一个键绑定到多个按键序列

### ❌ 被封禁的行为
- **全自动机器人**：无人值守自动刷图、捡装备、开门
- **内存读取**：使用 ReadProcessMemory 读取游戏内存
- **进程注入**：向游戏进程注入 DLL
- **交易机器人**：自动批量交易

### 🔶 灰色地带（存在风险）
- 屏幕读取 + 自动施法（轮换技能）：低检测风险，但违反精神
- 全屏自动跑图：高风险

**GGG 反作弊机制**：服务器端行为分析（检测异常规律），**无内核级反作弊驱动**。  
只要工具不注入游戏进程，技术上较难被检测到。

---

## 二、技术架构（屏幕读取方式）

屏幕宏原理：
`
游戏画面 → 截图 → 图像分析 → 判断状态 → 模拟鼠标/键盘
`

这种方式**不触碰游戏进程**，是最安全的实现方式。

### 核心技术栈

| 功能 | 推荐库 | 说明 |
|------|--------|------|
| 屏幕截图 | mss | 最快，<5ms |
| 图像识别 | opencv-python | 模板匹配 |
| 颜色检测 | PIL/Pillow | 像素颜色判断 |
| OCR 读字 | pytesseract | 识别血量数字 |
| 鼠标控制 | pyautogui / win32api | 模拟点击 |
| 键盘控制 | pynput / win32con | 模拟按键 |
| 脚本语言 | **AutoHotkey (AHK)** | 最常用、社区认可 |

---

## 三、实现方案（从简单到复杂）

### 方案 A：AHK 药瓶宏（最安全，5分钟搞定）

`hk
; AutoHotkey 脚本 - 一键激活所有药瓶
; 按 Q 同时触发 1 2 3 4 5 号药瓶
Q::
  Send, 1
  Sleep, 20
  Send, 2
  Sleep, 20
  Send, 3
  Sleep, 20
  Send, 4
  Sleep, 20
  Send, 5
return

; 血量低自动喝药 (需要配合屏幕颜色检测)
; 更复杂的版本见方案 C
`

**优点**：GGG 社区公认接受，无封禁风险  
**缺点**：只能做简单按键绑定

---

### 方案 B：Python 屏幕颜色检测 + 自动药瓶

`python
import mss
import pyautogui
import numpy as np
import time

# 配置 - 需要根据你的分辨率调整
HP_BAR_X = 125    # 血条中心 X 坐标
HP_BAR_Y = 975    # 血条中心 Y 坐标
HP_COLOR_FULL = (175, 35, 35)   # 满血颜色（红色）
HP_THRESHOLD = 0.6               # 血量低于 60% 触发

LIFE_FLASK_KEY = '1'  # 生命药瓶按键

def get_hp_ratio():
    with mss.mss() as sct:
        # 截取血条区域
        region = {"top": HP_BAR_Y - 5, "left": 60, "width": 130, "height": 10}
        img = np.array(sct.grab(region))
    # 计算红色像素比例
    red_pixels = np.sum((img[:,:,0] > 100) & (img[:,:,1] < 60) & (img[:,:,2] < 60))
    total_pixels = img.shape[0] * img.shape[1]
    return red_pixels / total_pixels

def main():
    print("Flask macro running... Press Ctrl+C to stop")
    while True:
        hp = get_hp_ratio()
        if hp < HP_THRESHOLD:
            pyautogui.press(LIFE_FLASK_KEY)
            time.sleep(0.5)  # 冷却，避免刷屏
        time.sleep(0.05)  # 50ms 检测一次

if __name__ == "__main__":
    main()
`

---

### 方案 C：Python + OpenCV 图像识别（中级）

`python
import mss
import cv2
import numpy as np
import pyautogui
import time

class PoeAssistant:
    def __init__(self):
        self.sct = mss.mss()
        # 加载模板图片（提前截图保存）
        self.frozen_template = cv2.imread('frozen_debuff.png', 0)
        self.bleed_template = cv2.imread('bleed_debuff.png', 0)
        
    def screenshot(self, region=None):
        if region is None:
            region = self.sct.monitors[1]  # 全屏
        img = np.array(self.sct.grab(region))
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    
    def find_template(self, screen, template, threshold=0.8):
        gray_screen = cv2.cvtColor(screen, cv2.COLOR_BGR2GRAY)
        result = cv2.matchTemplate(gray_screen, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)
        if max_val > threshold:
            return max_loc
        return None
    
    def run(self):
        print("POE Assistant started...")
        while True:
            screen = self.screenshot()
            
            # 检测冰冻状态 → 按冰冻药瓶
            if self.find_template(screen, self.frozen_template):
                pyautogui.press('3')  # 抗冰冻药瓶
                
            # 检测流血状态 → 按流血药瓶  
            if self.find_template(screen, self.bleed_template):
                pyautogui.press('4')  # 抗流血药瓶
                
            time.sleep(0.1)  # 100ms 检测周期

assistant = PoeAssistant()
assistant.run()
`

---

### 方案 D：全自动辅助（高风险，了解即可）

功能：自动追怪、技能循环、捡装备
- 需要路径寻找算法（A* 等）
- 需要怪物/NPC 识别
- **封号风险极高，不推荐用于正式账号**

---

## 四、安全使用建议

### 降低被检测风险

1. **随机化时间**：不要用固定的 50ms 间隔，加入 ±10~30ms 随机
   `python
   time.sleep(0.1 + random.uniform(-0.03, 0.03))
   `

2. **使用 win32api 代替 pyautogui**（更接近真实硬件输入）：
   `python
   import win32api, win32con
   win32api.keybd_event(0x31, 0, 0, 0)  # 按下 '1'
   win32api.keybd_event(0x31, 0, win32con.KEYEVENTF_KEYUP, 0)
   `

3. **不要 24 小时运行**：像人类一样玩游戏，有间歇

4. **只做辅助，不做完全替代**：需要人工操控方向和策略

5. **绝对不要读游戏内存**（这才是触发封号的主要原因）

---

## 五、推荐工具

| 工具 | 用途 | 风险等级 |
|------|------|----------|
| AutoHotkey (AHK) | 按键宏、药瓶宏 | ⭐ 极低 |
| Python + mss + pyautogui | 屏幕检测 + 自动按键 | ⭐⭐ 低 |
| Python + OpenCV | 图像识别辅助 | ⭐⭐ 低 |
| Cheat Engine (内存读写) | ❌ 不推荐 | ⭐⭐⭐⭐⭐ 极高 |

---

## 六、环境安装

`powershell
# 安装 Python 依赖
pip install mss opencv-python pyautogui pillow pytesseract pynput

# AutoHotkey 下载地址
# https://www.autohotkey.com/
`

---

## 七、适合用宏/辅助的场景

- ✅ 自动喝药（血量/蓝量检测）
- ✅ 防冰冻/流血/点燃自动解状态
- ✅ Logout 宏（死亡前快速退出）
- ✅ 截图工具（记录掉落物品）
- ⚠️ 技能轮换（可以但有风险）
- ❌ 全自动刷图（封号）