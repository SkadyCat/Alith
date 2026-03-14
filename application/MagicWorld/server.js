'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
require('dotenv').config();

const app  = express();
const PORT = 8033;

// ── 路径配置 ──────────────────────────────────────────────────────────
const DESIGN_DIR = path.join(__dirname, '..', '..', 'docs', 'application_doc', 'magicworld', 'design');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COS_BUCKET = 'magicworld-1304036735';
const COS_REGION = 'ap-guangzhou';

// ── 中间件 ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(PUBLIC_DIR));

// ── COS 辅助 ─────────────────────────────────────────────────────────
function hasCOS() {
  return !!(process.env.SECRET_ID && process.env.SECRET_KEY);
}

function toCOSUrl(iconPath) {
  if (!iconPath) return iconPath;
  const filename = iconPath.replace(/^\/icons\//, '');
  return `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/gameicons/${filename}`;
}

function enrichWithCOS(items) {
  if (!hasCOS()) return items;
  return items.map(item => ({
    ...item,
    icon: item.icon ? toCOSUrl(item.icon) : item.icon,
  }));
}

// ── 健康检查 / 配置接口 ───────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    port: PORT,
    cos: hasCOS(),
    bucket: COS_BUCKET,
    region: COS_REGION,
    publicUrl: process.env.PUBLIC_URL || '',
  });
});

// ── 字典接口 ──────────────────────────────────────────────────────────
function readDesign(name) {
  const p = path.join(DESIGN_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readMagic(name) {
  const p = path.join(DESIGN_DIR, 'magic', `${name}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

app.get('/api/dict/skills', (req, res) => {
  try { res.json({ success: true, data: enrichWithCOS(readDesign('skills')) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/dict/equipment', (req, res) => {
  try { res.json({ success: true, data: enrichWithCOS(readDesign('equipment')) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/dict/items', (req, res) => {
  try { res.json({ success: true, data: enrichWithCOS(readDesign('items')) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 技能特性/辅助系统 ────────────────────────────────────────────────
app.get('/api/dict/supports', (req, res) => {
  try { res.json({ success: true, data: readDesign('supports') }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/dict/skills/tags', (req, res) => {
  try {
    const skills = readDesign('skills');
    const tagCount = {};
    for (const s of skills) {
      for (const t of (s.tags || [])) {
        tagCount[t] = (tagCount[t] || 0) + 1;
      }
    }
    const tags = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>({tag,count}));
    res.json({ success: true, data: tags });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/dict/skills/:id/supports', (req, res) => {
  try {
    const skills = readDesign('skills');
    const supports = readDesign('supports');
    const skill = skills.find(s => s.id === req.params.id);
    if (!skill) return res.status(404).json({ success: false, error: 'Skill not found' });
    const skillTags = new Set(skill.tags || []);
    const matched = supports.filter(sup => {
      const anyOk = !sup.require_any.length || sup.require_any.some(t => skillTags.has(t));
      const allOk = sup.require_all.every(t => skillTags.has(t));
      const noExc = !sup.exclude.some(t => skillTags.has(t));
      return anyOk && allOk && noExc;
    });
    res.json({ success: true, skill, data: matched });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/dict/supports/:id/skills', (req, res) => {
  try {
    const skills = readDesign('skills');
    const supports = readDesign('supports');
    const sup = supports.find(s => s.id === req.params.id);
    if (!sup) return res.status(404).json({ success: false, error: 'Support not found' });
    const matched = skills.filter(skill => {
      const skillTags = new Set(skill.tags || []);
      const anyOk = !sup.require_any.length || sup.require_any.some(t => skillTags.has(t));
      const allOk = sup.require_all.every(t => skillTags.has(t));
      const noExc = !sup.exclude.some(t => skillTags.has(t));
      return anyOk && allOk && noExc;
    });
    res.json({ success: true, support: sup, data: matched });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── COS 状态 ──────────────────────────────────────────────────────────
app.get('/api/cos/status', (req, res) => {
  res.json({ success: true, configured: hasCOS(), bucket: COS_BUCKET, region: COS_REGION });
});

// ── 魔法系统接口 ─────────────────────────────────────────────────────
app.get('/api/magic/elements',      (req, res) => { try { res.json({ success: true, data: readMagic('elements') });       } catch(e) { res.status(500).json({ success: false, error: e.message }); } });
app.get('/api/magic/delivery-types',(req, res) => { try { res.json({ success: true, data: readMagic('delivery_types') }); } catch(e) { res.status(500).json({ success: false, error: e.message }); } });
app.get('/api/magic/modifiers',     (req, res) => { try { res.json({ success: true, data: readMagic('modifiers') });      } catch(e) { res.status(500).json({ success: false, error: e.message }); } });
app.get('/api/magic/effects',       (req, res) => { try { res.json({ success: true, data: readMagic('effects') });        } catch(e) { res.status(500).json({ success: false, error: e.message }); } });
app.get('/api/magic/spells', (req, res) => {
  try {
    const spells = readMagic('spells');
    const skills = readDesign('skills');
    const elementMap = {
      '暗影': 'shadow', '神圣': 'holy', '虚空': 'void',
      '火焰': 'fire',   '冰霜': 'ice',  '闪电': 'lightning',
      '死灵': 'arcane', '毒素': 'poison', '物理': 'earth', '自然': 'earth',
    };
    const converted = skills.map(s => ({
      id:          s.id,
      name:        s.name,
      icon:        s.icon ? toCOSUrl(s.icon) : '',
      rarity:      s.rarity || '普通',
      element:     elementMap[s.element] || s.element,
      level:       s.level || 1,
      mana_cost:   s.mpCost || 0,
      cooldown:    s.cooldown || 0,
      cast_time:   0,
      description: s.description || '',
      delivery:    null,
      on_hit:      [],
      source:      'skill',
      tags:        s.tags || [],
      type:        s.type || '主动',
      damage:      s.damage || '',
    }));
    res.json({ success: true, data: [...spells, ...converted] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// 校验一个技能实例的修饰符兼容性
app.post('/api/magic/validate', (req, res) => {
  try {
    const spell = req.body;
    const deliveryTypes = readMagic('delivery_types');
    const allModifiers  = readMagic('modifiers');
    const modMap = Object.fromEntries(allModifiers.map(m => [m.id, m]));
    const dt = deliveryTypes.find(d => d.id === spell.delivery?.type);
    if (!dt) return res.json({ success: false, errors: [`未知投射类型: ${spell.delivery?.type}`] });

    const errors = [];
    const mods = (spell.delivery?.modifiers || []).map(m => m.id);
    for (const modId of mods) {
      const mod = modMap[modId];
      if (!mod) { errors.push(`未知修饰符: ${modId}`); continue; }
      if (!mod.applies_to.includes(spell.delivery.type)) {
        errors.push(`修饰符 "${mod.name}" 不适用于投射类型 "${dt.name}"`);
      }
      if (!dt.compatible_modifiers.includes(modId)) {
        errors.push(`投射类型 "${dt.name}" 不支持修饰符 "${mod.name}"`);
      }
      for (const conflict of (mod.conflicts || [])) {
        if (mods.includes(conflict)) {
          const c = modMap[conflict];
          errors.push(`修饰符 "${mod.name}" 与 "${c?.name || conflict}" 冲突`);
        }
      }
    }
    res.json({ success: errors.length === 0, errors, warnings: [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── COS 代理（解决 CORS 问题）────────────────────────────────────────
app.get('/api/cos-proxy', (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ success: false, error: 'invalid url' });
  }
  const parsed = new URL(url);
  const opts = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { 'User-Agent': 'MagicWorld/1.0' },
  };
  const proto = url.startsWith('https') ? require('https') : http;
  const proxyReq = proto.get(opts, (proxyRes) => {
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => res.status(502).json({ success: false, error: e.message }));
});

// ── 根路径 ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── 启动 ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MagicWorld running at http://localhost:${PORT}`);
});
