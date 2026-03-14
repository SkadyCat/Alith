# canvas 能渲染出 CSS 效果吗？

**可以！** canvas-editor 实际上是基于 **DOM 元素**渲染的（不是 HTML5 Canvas 2D 像素绘图），所以 CSS 效果完全支持。

## 当前已支持的 CSS 属性

| 属性 | 说明 | 在哪设置 |
|------|------|---------|
| orderRadius | 圆角 | 属性面板 → 圆角(px) |
| oxShadow | 盒子阴影 | 属性面板 → 阴影 |
| opacity | 透明度 | 属性面板 → 透明度 |
| gColor | 背景颜色 | 属性面板 → 背景色 |
| orderColor / orderWidth | 边框颜色/粗细 | 属性面板 → 边框 |

## 技术原理

`
网格背景 → HTML5 Canvas 2D 绘制（纯像素，不支持 CSS）
Widget 节点 → <div> DOM 元素（完全支持 CSS！）
`

每个 box 节点渲染为：
`js
el.style.borderRadius = box.borderRadius + 'px';
el.style.boxShadow    = box.boxShadow || 'none';
el.style.opacity      = box.opacity;
el.style.background   = box.bgColor;
`

## 目前不支持（未实现）

- ilter（模糊、亮度、对比度等）
- 	ransform（旋转、缩放）
- CSS 渐变背景（bgColor 目前只支持纯色）

## 如果需要支持 filter / transform

可以扩展 box schema 并在 enderBox() 中添加：
`js
el.style.filter    = box.filter    || '';
el.style.transform = box.transform || '';
`
然后在属性面板加对应输入框即可。需要的话可以帮你实现。