# pi-find-packages

[pi](https://pi.dev) 扩展：本地全量 pi 生态包目录 + `/find-packages` 集成评估工作流。

## 功能

- **离线目录**：同步 npm `keywords:pi-package` 全量语料（约 5k+ 包）到本地，jq/grep 语义组合检索，不受 npm 搜索关键词匹配限制
- **`/find-packages <需求>`**：检索候选 → 沙箱内只读源码分析 → 按「功能不交叉 / peer 兼容 / 活跃度 / 供应链」标准输出对比表与推荐
- **冷启动**：包内置目录快照（`data/catalog.jsonl.gz`），安装即用，首次运行零网络请求
- **默认 Docker 隔离**：候选包克隆/解包在无凭据、非 root 容器内进行；可显式关闭（每次提示风险，不推荐）

## 安装

```bash
pi install npm:pi-find-packages        # 发布后
pi install git:github.com/nailuoGG/pi-find-packages
pi install /path/to/pi-find-packages   # 本地试用
```

## 数据目录

`<PI_CODING_AGENT_DIR>/data/pi-find-packages/`（默认 `~/.pi/agent/data/pi-find-packages/`）

- `catalog.jsonl` — 目录数据（每行一个包：name/version/description/date/author/keywords/repo）
- `config.json` — `{"isolation": "docker" | "off"}`，默认 docker

## 刷新目录

```bash
node <包目录>/scripts/sync-catalog.mjs
```

约 40 次请求拉全量；建议 ≥30 天一次，避免对 registry 过量请求。

## 分析沙箱

```bash
docker build -t pi-find-packages-analysis -f docker/Dockerfile.analysis docker
```

镜像无 pi、无凭据：只用于克隆/解包/阅读第三方源码。绝不在任何环境执行候选包的 install 脚本。

## 安全边界

- 分析报告 ≠ 安装授权，是否 `pi install` 由用户决定
- `isolation: off` 会在每次使用时注入风险提示；第三方包源码可能包含恶意逻辑
- 更新通道（规划）：GitHub tag + jsDelivr CDN + checksum 校验
