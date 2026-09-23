/**
 * /find-packages — search the local pi-package catalog and kick off guided analysis.
 *
 * Data dir: <agentDir>/data/pi-find-packages/catalog.jsonl
 * Cold start: copies the bundled data/catalog.jsonl.gz from the package on first run.
 * Isolation: config.json { "isolation": "docker" (default) | "off" } — see skill for semantics.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function activate(pi) {
  // PI_CODING_AGENT_DIR is the official config-dir override (docs/environment-variables.md).
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi/agent");
  const dataDir = join(agentDir, "data/pi-find-packages");
  const catalog = join(dataDir, "catalog.jsonl");
  const configFile = join(dataDir, "config.json");

  // Cold start: copy bundled snapshot if catalog missing.
  const pkgDir = dirname(dirname(fileURLToPath(import.meta.url))); // extensions/../ = package root
  const bundled = join(pkgDir, "data/catalog.jsonl.gz");
  if (!existsSync(catalog)) {
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(bundled)) {
      copyFileSync(bundled, join(dataDir, "catalog.jsonl.gz"));
      pi.appendEntry("find-packages", { event: "cold-start-copy", from: bundled });
    }
  }

  function isolation() {
    try {
      const cfg = JSON.parse(readFileSync(configFile, "utf8"));
      return cfg.isolation === "off" ? "off" : "docker";
    } catch {
      return "docker"; // secure default
    }
  }

  pi.registerCommand("find-packages", {
    description: "Search local pi-package catalog for packages matching a need",
    handler: async (args, ctx) => {
      const query = (args ?? "").trim();
      if (!query) {
        ctx.ui.notify("用法：/find-packages <想做的事>，例如 /find-packages 远程控制会话", "warning");
        return;
      }
      if (!existsSync(catalog)) {
        ctx.ui.notify(`catalog.jsonl 不存在，请先运行：node ${join(pkgDir, "scripts/sync-catalog.mjs")}`, "error");
        return;
      }
      const iso = isolation();
      const riskNote =
        iso === "off"
          ? [
              "",
              "⚠️ **隔离已关闭（isolation: off）**：候选包的源码将在宿主机上克隆/解包分析。",
              "第三方包可能包含恶意 install 脚本或构建逻辑，宿主机分析不被沙箱约束。此模式不推荐，",
              "仅为无 Docker 环境的降级路径。可删除 data/pi-find-packages/config.json 或设 isolation:\"docker\" 恢复默认。",
            ].join("\n")
          : "";
      const prompt = [
        `在本地 pi-package 目录中查找能满足以下需求的包，并完成集成评估：`,
        `**${query}**`,
        "",
        "步骤：",
        "1. 检索：用 jq/grep 对 `~/.pi/agent/data/pi-find-packages/catalog.jsonl` 按 description/keywords/名称做多组关键词检索，必要时换同义词；选 3-5 个最相关候选。",
        "2. 逐候选深入分析（只读）：`npm view <pkg>` 查版本/依赖/peer；按 repo 链接克隆或下载源码，阅读入口、扩展点、README，判断维护活跃度、依赖面、供应链信号。",
        `3. 执行环境：${iso === "docker" ? "所有克隆/解包/源码分析必须在 Docker 容器内进行（见 docker/Dockerfile.analysis），宿主机只接收分析文本，绝不运行候选包的 install 脚本。" : "未隔离，直接在宿主机只读分析（见上方风险提示）。"}`,
        "4. 评估判据：功能与现有配置/已装包是否交叉（Unix 哲学：功能不交叉）；pi 兼容（peer 版本）；维护活跃度；依赖与供应链安全。",
        "5. 输出：候选对比表（名称/版本/活跃度/匹配度/风险）+ 明确推荐及理由。分析报告不等于安装授权，是否集成由我决定。",
        riskNote,
      ].join("\n");
      await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    },
  });
}
