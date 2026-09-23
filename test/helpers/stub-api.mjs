// A stub ExtensionAPI that mirrors pi's real loading semantics.
//
// pi sets up only the registration surface while an extension factory runs;
// "action" methods stay uninitialized and throw until the factory returns and
// pi commits the extension. A permissive stub hides real first-run failures
// (found by running real pi: calling pi.appendEntry() during loading rejects the
// whole extension), so this stub enforces the same rule.

const LOADING_ERROR =
  "Extension runtime not initialized. Action methods cannot be called during extension loading.";

/**
 * @returns {{
 *   api: any,
 *   commit: () => void,
 *   commands: Map<string, any>,
 *   handlers: Map<string, Function[]>,
 *   entries: Array<{ type: string, data: unknown }>,
 *   sent: Array<{ message: string, options: any }>,
 *   notifies: Array<{ message: string, type: string }>,
 *   emit: (event: string, ...args: any[]) => Promise<void>,
 *   ctx: any,
 * }}
 */
export function createStubExtensionApi() {
  let loading = true;
  const commands = new Map();
  const handlers = new Map();
  const entries = [];
  const sent = [];
  const notifies = [];
  const flags = new Map();

  /** An action method: legal after commit, a hard error while loading. */
  const action = (fn) => (...args) => {
    if (loading) throw new Error(LOADING_ERROR);
    return fn(...args);
  };

  const api = {
    // --- registration surface: always allowed, as in pi ---
    registerCommand: (name, options) => commands.set(name, { name, ...options }),
    registerTool: (tool) => {
      if (!tool?.name) throw new Error("registerTool requires a name");
    },
    registerShortcut: () => {},
    registerFlag: (name, options) => flags.set(name, options),
    registerMessageRenderer: () => {},
    registerMarkdownTransformer: () => {},
    registerEntryRenderer: () => {},
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    getFlag: (name) => flags.get(name)?.default,

    // --- action surface: forbidden during loading, exactly like pi ---
    appendEntry: action((type, data) => entries.push({ type, data })),
    sendMessage: action(() => {}),
    sendUserMessage: action((message, options) => sent.push({ message, options })),
    setSessionName: action(() => {}),
    getSessionName: action(() => undefined),
    setLabel: action(() => {}),
    getActiveTools: action(() => []),
    getAllTools: action(() => []),
    setActiveTools: action(() => {}),
    refreshTools: () => {},
    getCommands: action(() => []),
    setModel: action(() => Promise.resolve()),
    getThinkingLevel: action(() => undefined),
    setThinkingLevel: action(() => {}),
    registerProvider: () => {},
  };

  const ctx = {
    ui: {
      notify: (message, type = "info") => notifies.push({ message, type }),
      confirm: async () => true,
      input: async () => undefined,
    },
    sessionManager: { getBranch: () => [] },
  };

  return {
    api,
    commit: () => {
      loading = false;
    },
    commands,
    handlers,
    entries,
    sent,
    notifies,
    emit: async (event, ...args) => {
      for (const handler of handlers.get(event) ?? []) await handler(...args, ctx);
    },
    ctx,
  };
}
