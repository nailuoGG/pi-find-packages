# find-packages: pi 包目录检索与集成评估

本地维护一份 pi 生态全量包目录（pi.dev/packages 同源数据，npm `keywords:pi-package`），用于离线/语义化找包，并按统一标准评估是否值得集成。

## 数据

- 目录文件：`~/.pi/agent/data/pi-find-packages/catalog.jsonl`（每行一个包：name/version/description/date/author/keywords/npm/repo）
- 刷新：`node <包目录>/scripts/sync-catalog.mjs`（包目录可用 `pi list` 查安装路径）（全量重拉，约 40 次请求）。仅在文件超过 30 天或用户要求时执行，避免对 npm registry 过量请求。

## 检索方法

1. 精确：`jq -r 'select(.description|test("关键词";"i")) | [.name,.version,.description] | @tsv' catalog.jsonl`，多组同义词各查一轮（英文为主，覆盖 remote/telegram/discord/web 等通道词）。
2. 语义（可选）：`qmd query --collection pi-pkg-readmes "需求描述"`——搜索已评估包的 README 缓存（随使用增长；缓存为空时跳过）。仅当 qmd 可用且未被 `config.json` 的 `"semantic":"off"` 关闭时使用；否则跳过此步，精确检索照常。
3. 两者都无结果时兜底 `npm search`，并提示目录可能过期。

## README 缓存（评估时顺手写入）

每次评估候选包时，把读到的 README 存为 `~/.pi/agent/data/pi-find-packages/readmes/<name 中的 / 换成 __>.md`，文件首行写 `# <name> <version> <date>` 便于归属；写入后跑 `qmd index pi-pkg-readmes` 增量索引。**不批量抓取全量 README**——语料随真实评估自然增长。

## 集成评估（每个候选必查）

- **功能交叉**：与已装包（`~/.pi/agent/settings.json` packages 列表）及 pi 内置能力是否重叠；功能不交叉是硬标准。
- **兼容**：`npm view <pkg> peerDependencies` 是否覆盖当前 pi 版本。
- **活跃度**：最近发布时间、repo 最近提交。
- **供应链**：作者/维护者、依赖数、package.json 是否有 install/preinstall 脚本、有无外传数据路径。

## 分析执行环境

- **默认必须在 Docker 容器内**克隆/解包候选源码（`docker/Dockerfile.analysis`：node24-slim + git + ripgrep，无凭据）。宿主机只接收分析文本。**绝不执行候选包的 install 脚本或构建产物。**
- `data/pi-find-packages/config.json` 设 `{"isolation":"off"}` 可关闭隔离——每次使用都会收到风险提示，不推荐。
- 浅层信息（`npm view`、读 registry JSON）不需要容器。

## 输出约定

候选对比表（名称/版本/最近发布/活跃度/匹配度/风险）+ 明确推荐与理由。**分析报告 ≠ 安装授权**，是否 `pi install` 由用户决定。
