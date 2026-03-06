/**
 * NodeFlow 路由
 * 挂载路径: /nodeflow
 *
 * NodeJS 工作流可视化 — 将处理逻辑拆分为独立可切换的节点
 *
 * API:
 *   GET  /nodeflow              — 主 UI 页面
 *   GET  /nodeflow/api/nodes    — 获取所有节点列表
 *   POST /nodeflow/api/toggle/:id  — 切换节点启用/禁用
 *   POST /nodeflow/api/run      — 执行流水线
 *   POST /nodeflow/api/nodes    — 创建新节点
 *   PUT  /nodeflow/api/nodes/:id   — 更新节点代码
 *   DELETE /nodeflow/api/nodes/:id — 删除节点
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const router   = express.Router();
const APP_DIR  = path.join(__dirname, '..', 'application', 'node-pipeline');
const NODES_DIR = path.join(APP_DIR, 'nodes');
const CONFIG_FILE = path.join(APP_DIR, 'pipeline.json');

// ── helpers ────────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (_) {
    return { nodes: [] };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadNodes() {
  if (!fs.existsSync(NODES_DIR)) return [];

  const files = fs.readdirSync(NODES_DIR)
    .filter(f => f.endsWith('.js'))
    .sort();

  const config = loadConfig();

  return files.map(file => {
    const nodeId   = path.basename(file, '.js');
    const nodePath = path.join(NODES_DIR, file);
    const nodeConfig = config.nodes.find(n => n.id === nodeId) || {};

    let meta = { name: nodeId, description: '', color: '#6c757d', icon: '⚙️' };
    try {
      delete require.cache[require.resolve(nodePath)];
      const mod = require(nodePath);
      meta = { ...meta, ...mod.meta };
    } catch (err) {
      meta.error = err.message;
    }

    return {
      id: nodeId,
      ...meta,
      enabled: nodeConfig.enabled !== undefined ? nodeConfig.enabled : true,
      code: fs.readFileSync(nodePath, 'utf-8'),
    };
  });
}

// ── routes ─────────────────────────────────────────────────────────────────────

// Serve main UI
router.get('/', (req, res) => {
  res.sendFile(path.join(APP_DIR, 'index.html'));
});

// List all nodes
router.get('/api/nodes', (req, res) => {
  try {
    res.json({ success: true, nodes: loadNodes() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle node enabled/disabled
router.post('/api/toggle/:id', (req, res) => {
  try {
    const { id } = req.params;
    const config = loadConfig();

    let nodeConfig = config.nodes.find(n => n.id === id);
    if (!nodeConfig) {
      nodeConfig = { id, enabled: true };
      config.nodes.push(nodeConfig);
    }
    nodeConfig.enabled = !nodeConfig.enabled;
    saveConfig(config);

    res.json({ success: true, id, enabled: nodeConfig.enabled });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run the pipeline
router.post('/api/run', async (req, res) => {
  try {
    const { input } = req.body || {};
    const nodes = loadNodes();

    let data = input;
    const results = [];
    const pipelineStart = Date.now();

    for (const node of nodes) {
      const nodeResult = {
        id:      node.id,
        name:    node.name,
        icon:    node.icon,
        color:   node.color,
        enabled: node.enabled,
        skipped: !node.enabled,
        logs:    [],
        input:   data,
        output:  data,
        duration: 0,
        error:   null,
        status:  node.enabled ? 'pending' : 'skipped',
      };

      if (!node.enabled) {
        nodeResult.logs.push('⏭️ 节点已禁用，已跳过');
        results.push(nodeResult);
        continue;
      }

      const nodeStart = Date.now();
      try {
        const nodePath = path.join(NODES_DIR, `${node.id}.js`);
        delete require.cache[require.resolve(nodePath)];
        const mod = require(nodePath);

        const ctx = { logs: nodeResult.logs };
        nodeResult.output = await mod.run(data, ctx);
        data = nodeResult.output;
        nodeResult.status = 'success';
      } catch (err) {
        nodeResult.error  = err.message;
        nodeResult.status = 'error';
        nodeResult.logs.push(`❌ 错误: ${err.message}`);
        // Stop pipeline on error
        nodeResult.duration = Date.now() - nodeStart;
        results.push(nodeResult);
        return res.json({
          success: false,
          results,
          errorAt: node.id,
          error: err.message,
          totalDuration: Date.now() - pipelineStart,
        });
      }
      nodeResult.duration = Date.now() - nodeStart;
      results.push(nodeResult);
    }

    res.json({
      success:      true,
      results,
      finalOutput:  data,
      totalDuration: Date.now() - pipelineStart,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new node
router.post('/api/nodes', (req, res) => {
  try {
    const { name, description = '', color = '#6c757d', icon = '⚙️' } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: '节点名称必填' });

    const existing = fs.existsSync(NODES_DIR) ? fs.readdirSync(NODES_DIR).filter(f => f.endsWith('.js')) : [];
    const nextNum  = String(existing.length + 1).padStart(2, '0');
    const slug     = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-');
    const id       = `${nextNum}-${slug}`;
    const code = `/**
 * 节点 ${nextNum} - ${name}
 * ${description}
 */
module.exports = {
  meta: {
    name: '${name}',
    description: '${description}',
    color: '${color}',
    icon: '${icon}',
  },

  async run(input, ctx) {
    ctx.logs.push('${icon} 节点开始执行...');

    // ── 在此实现您的节点逻辑 ──────────────────────────
    // input  — 上一节点的输出（或初始输入）
    // ctx.logs — 推送日志字符串，显示在执行面板中
    // return  — 传给下一节点的数据
    // throw   — 抛出错误将中止整个流水线
    // ────────────────────────────────────────────────

    ctx.logs.push('✅ 节点执行完成');
    return input;
  },
};
`;

    fs.writeFileSync(path.join(NODES_DIR, `${id}.js`), code, 'utf-8');
    res.json({ success: true, id, message: `节点 "${name}" 已创建` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update node code
router.put('/api/nodes/:id', (req, res) => {
  try {
    const { id }   = req.params;
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, error: 'code 字段必填' });

    const nodePath = path.join(NODES_DIR, `${id}.js`);
    if (!fs.existsSync(nodePath)) return res.status(404).json({ success: false, error: '节点不存在' });

    // Validate the code can be parsed
    try {
      new Function(code); // basic syntax check
    } catch (syntaxErr) {
      // Still save it — let the user fix it; just warn
    }

    fs.writeFileSync(nodePath, code, 'utf-8');
    res.json({ success: true, message: '节点代码已保存' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a node
router.delete('/api/nodes/:id', (req, res) => {
  try {
    const { id }   = req.params;
    const nodePath = path.join(NODES_DIR, `${id}.js`);
    if (!fs.existsSync(nodePath)) return res.status(404).json({ success: false, error: '节点不存在' });

    fs.unlinkSync(nodePath);

    const config = loadConfig();
    config.nodes = config.nodes.filter(n => n.id !== id);
    saveConfig(config);

    res.json({ success: true, message: '节点已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
