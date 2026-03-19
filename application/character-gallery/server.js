const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8335;

// 静态文件：从 docs-service public/images/characters 提供图片
const IMAGES_DIR = path.join(__dirname, '..', '..', 'public', 'images', 'characters');

app.use('/images/characters', express.static(IMAGES_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// API: 获取角色清单
app.get('/api/characters', (req, res) => {
  const manifestPath = path.join(IMAGES_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return res.json({ success: false, characters: [], message: '尚未生成角色，请先运行生成脚本' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    res.json({ success: true, characters: data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[character-gallery] 角色立绘展示服务已启动: http://localhost:${PORT}`);
});
