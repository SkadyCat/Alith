# ItemDescName vs Divider3 位置分析

## 结论：没有真正重叠，只是共享同一X列

画布绝对坐标：
- Divider3: x=[760,948] y=[368,369] (1px线)
- ItemDescBG: x=[760,948] y=[374,522] (gap=5px)
- ItemDescName: x=[764,944] y=[378,402] (gap=9px)

**原因**：canvas-editor所有box均用画布绝对坐标，父子关系不影响坐标系。Divider3和ItemDescName共享同一x列，Y方向差9px（无实际像素重叠）。

## 避免方案
**A. 增大间距**：ItemDescBG.y改为380（+6px）
**B. Divider3紧贴BG**：Divider3.y=373（语义清晰）
**C. 用BG边框替代Divider**：去掉Divider3，直接设ItemDescBG的borderTop样式