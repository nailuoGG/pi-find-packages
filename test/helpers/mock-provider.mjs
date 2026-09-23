// Hermetic OpenAI-compatible endpoint for pi-agent E2E tests.
//
// Speaks just enough of the streaming Chat Completions protocol for real `pi` to
// complete a turn, and records every request so tests can assert what the agent
// actually sent (for example, that the skill reached the system prompt).
//
// No network, no API key, no cost: the "model" is a scripted queue of responses.
import { createServer } from "node:http";

/** @typedef {{ kind: "text", text: string } | { kind: "tool_call", name: string, args: object }} ScriptedResponse */

/**
 * Start the mock provider.
 *
 * @param {object} options
 * @param {ScriptedResponse[]} [options.responses] Responses in order; the last one repeats.
 * @returns {Promise<{ port: number, requests: Array<{url: string, body: any}>, close: () => Promise<void> }>}
 */
export async function startMockProvider({ responses = [{ kind: "text", text: "ok" }] } = {}) {
  const requests = [];
  let turn = 0;

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!req.url?.includes("chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }
      requests.push({ url: req.url, body: parsed });

      const scripted = responses[Math.min(turn, responses.length - 1)];
      turn += 1;

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1700000000, model: "mock-model" };
      const send = (delta, finishReason = null) =>
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);

      if (scripted.kind === "tool_call") {
        send({
          role: "assistant",
          tool_calls: [
            { index: 0, id: "call_mock_1", type: "function", function: { name: scripted.name, arguments: "" } },
          ],
        });
        send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(scripted.args) } }] });
        send({}, "tool_calls");
      } else {
        send({ role: "assistant", content: scripted.text });
        send({}, "stop");
      }

      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
