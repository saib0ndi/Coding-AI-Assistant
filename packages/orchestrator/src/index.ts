import express, { Request, Response } from "express";
import cors from "cors";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG (envs)
// ─────────────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 8787);

// MCP base host (no path); auto-discover RPC path (/mcp/rpc or /mcp)
const MCP_BASE = (process.env.MCP_URL ?? "http://127.0.0.1:10000").trim().replace(/\/+$/, "");
const MCP_TOKEN = process.env.AIASSIST_MCP_TOKEN?.trim() || undefined;

// Override the exact RPC path only if you really need to (e.g., "/mcp" or "/mcp/rpc")
const MCP_RPC_PATH_OVERRIDE = process.env.MCP_RPC_PATH?.trim();

// Ollama
const OLLAMA = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").trim().replace(/\/+$/, "");

// Timeouts
const SHORT_TIMEOUT_MS = 2500;
const GEN_TIMEOUT_MS = 120000; // allow longer generations

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: fetch with timeout, SSE writer
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(input: RequestInfo, init: RequestInit | undefined, ms: number) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  };
}

function openSSE(res: Response) {
  // Express type-safe way to set headers
  const headers = sseHeaders();
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  // Attempt to flush headers if available (not in types, but exists in many envs)
  (res as any).flushHeaders?.();
}

function writeSSE(res: Response, event: string, data: any) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  res.write(`data: ${payload}\n\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP RPC endpoint discovery + simple client
// ─────────────────────────────────────────────────────────────────────────────
let resolvedRpcUrl: string | null = null;

async function resolveMcpRpcUrl(): Promise<string> {
  if (MCP_RPC_PATH_OVERRIDE) {
    const url = `${MCP_BASE}${MCP_RPC_PATH_OVERRIDE.startsWith("/") ? MCP_RPC_PATH_OVERRIDE : `/${MCP_RPC_PATH_OVERRIDE}`}`;
    resolvedRpcUrl = url;
    return url;
  }
  if (resolvedRpcUrl) return resolvedRpcUrl;

  const candidates = [`${MCP_BASE}/mcp/rpc`, `${MCP_BASE}/mcp`];
  for (const url of candidates) {
    try {
      const r = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "tools/list" }),
        },
        SHORT_TIMEOUT_MS
      );
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && j.jsonrpc === "2.0") {
          resolvedRpcUrl = url;
          return url;
        }
      }
    } catch {
      // try next
    }
  }
  // fallback
  resolvedRpcUrl = `${MCP_BASE}/mcp/rpc`;
  return resolvedRpcUrl;
}

async function mcpRpc(method: string, params?: any) {
  const url = await resolveMcpRpcUrl();
  const r = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    },
    SHORT_TIMEOUT_MS
  );
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) as any, text: null as string | null };
  } catch {
    return { status: r.status, json: null as any, text };
  }
}

async function checkMcp(): Promise<"up" | "down"> {
  try {
    const res = await mcpRpc("tools/list");
    if (res.status === 200 && res.json?.jsonrpc === "2.0") return "up";
  } catch {}
  return "down";
}

async function checkOllama(): Promise<"up" | "down"> {
  try {
    const r = await fetchWithTimeout(`${OLLAMA}/api/version`, undefined, SHORT_TIMEOUT_MS);
    if (r.ok) return "up";
  } catch {}
  return "down";
}

// ─────────────────────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health + Status
app.get("/health", async (_req: Request, res: Response) => {
  const [mcp, ollama] = await Promise.all([checkMcp(), checkOllama()]);
  res.json({ ok: mcp === "up" && ollama === "up", service: "orchestrator", mcp, ollama });
});
app.get("/status", async (_req: Request, res: Response) => {
  const [mcp, ollama] = await Promise.all([checkMcp(), checkOllama()]);
  res.json({ ok: mcp === "up" && ollama === "up", service: "orchestrator", mcp, ollama });
});

// Direct MCP RPC proxy (discovers path, forwards token)
app.post("/mcp/rpc", async (req: Request, res: Response) => {
  try {
    const url = await resolveMcpRpcUrl();
    const r = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}),
        },
        body: JSON.stringify(req.body ?? {}),
      },
      SHORT_TIMEOUT_MS
    );
    const text = await r.text();
    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (e: any) {
    res.status(502).json({ error: String(e), service: "orchestrator" });
  }
});

// Minimal non-streaming ask
app.post("/ask", async (req: Request, res: Response) => {
  const { message } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "missing message" });

  const rpc = await mcpRpc("tools/call", { name: "ping", arguments: {} });
  if (rpc.status !== 200 || !rpc.json?.result) {
    return res.status(502).json({ error: "mcp error", detail: rpc });
  }

  try {
    const r = await fetchWithTimeout(
      `${OLLAMA}/api/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "llama3.1:8b",
          prompt: message,
          stream: false,
          options: { temperature: 0.2, top_p: 0.9 },
        }),
      },
      GEN_TIMEOUT_MS
    );
    const j = await r.json();
    return res.status(200).json({
      content: j?.response ?? "",
      meta: { mcp: rpc.json.result, model: j?.model, done: j?.done },
    });
  } catch (e: any) {
    return res.status(502).json({ error: "ollama error", detail: String(e) });
  }
});

// Streaming ask (SSE)
app.post("/ask/stream", async (req: Request, res: Response) => {
  const { message, model = "llama3.1:8b", options = { temperature: 0.2, top_p: 0.9 } } = req.body ?? {};
  if (!message) {
    // For SSE, we still return JSON error if no message
    return res.status(400).json({ error: "missing message" });
  }

  // Open SSE
  openSSE(res);

  // 1) Emit MCP health first
  try {
    const rpc = await mcpRpc("tools/call", { name: "ping", arguments: {} });
    writeSSE(res, "status", {
      mcp: rpc.status === 200 && rpc.json?.result ? "up" : "down",
      meta: rpc.json?.result ?? null,
    });
  } catch {
    writeSSE(res, "status", { mcp: "down", meta: null });
  }

  // 2) Start Ollama streaming and forward deltas
  try {
    const r = await fetchWithTimeout(
      `${OLLAMA}/api/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: message, stream: true, options }),
      },
      GEN_TIMEOUT_MS
    );

    if (!r.ok || !r.body) {
      writeSSE(res, "error", { error: `ollama http ${r.status}` });
      return res.end();
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const obj = JSON.parse(s);
          if (typeof obj.response === "string" && obj.response.length) {
            writeSSE(res, "delta", obj.response);
            fullText += obj.response;
          }
          if (obj.done === true) {
            writeSSE(res, "done", { model: obj.model, total: fullText.length });
          }
        } catch {
          writeSSE(res, "delta", s);
          fullText += s;
        }
      }
    }

    if (buf.trim().length) {
      writeSSE(res, "delta", buf.trim());
    }

    return res.end();
  } catch (e: any) {
    writeSSE(res, "error", { error: String(e) });
    return res.end();
  }
});

// Utility: list available Ollama models
app.get("/llm/models", async (_req: Request, res: Response) => {
  try {
    const r = await fetchWithTimeout(`${OLLAMA}/api/tags`, undefined, SHORT_TIMEOUT_MS);
    const j = await r.json();
    res.json(j);
  } catch (e: any) {
    res.status(502).json({ error: String(e), service: "orchestrator" });
  }
});

// Proxy generate to Ollama (non-stream)
app.post("/llm/generate", async (req: Request, res: Response) => {
  const { model = "llama3.1:8b", prompt, options, stream = false } = req.body ?? {};
  if (!prompt) return res.status(400).json({ error: "missing prompt" });
  try {
    const r = await fetchWithTimeout(
      `${OLLAMA}/api/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, options, stream }),
      },
      GEN_TIMEOUT_MS
    );
    const text = await r.text();
    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (e: any) {
    res.status(502).json({ error: String(e), service: "orchestrator" });
  }
});

// JSON 404
app.use((_req: Request, res: Response) => res.status(404).json({ error: "not found", service: "orchestrator" }));

app.listen(PORT, async () => {
  const rpc = await resolveMcpRpcUrl().catch(() => "<unresolved>");
  console.log(`orchestrator on :${PORT}`);
  console.log(`  MCP_BASE        = ${MCP_BASE}`);
  console.log(`  MCP_RPC_PATH    = ${MCP_RPC_PATH_OVERRIDE ?? "(auto)"} → using ${rpc}`);
  console.log(`  OLLAMA_BASE_URL = ${OLLAMA}`);
});
