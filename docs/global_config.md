# 爱丽丝全局配置

> 本文件是爱丽丝（docs-service Agent）的全局运行配置。  
> 修改后无需重启，下次任务启动时自动生效。

---

## 代理设置

```json
{
  "use_proxy": true,
  "proxy_host": "127.0.0.1",
  "proxy_port": 7890
}
```

**字段说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `use_proxy` | boolean | `true` | 是否启用代理（Clash/ClashX）。设为 `false` 时强制直连（会清除所有代理环境变量） |
| `proxy_host` | string | `"127.0.0.1"` | 代理服务器地址 |
| `proxy_port` | number | `7890` | 代理端口，Clash 默认 7890 |

---

## 其他配置

_（预留，暂无内容）_
