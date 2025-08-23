#!/usr/bin/env python3
import os
import logging
import inspect
from datetime import datetime, timezone
from typing import Any, Dict

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request
from mcp.server.fastmcp import FastMCP

APP_NAME = "aiassist-mcp"
APP_VERSION = os.getenv("AIASSIST_MCP_VERSION", "1.1.0")
PORT = int(os.getenv("PORT", "9999"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("AIASSIST_ALLOWED_ORIGINS", "http://127.0.0.1:8787").split(",") if o.strip()
]

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger(APP_NAME)

# ── Build FastMCP server ─────────────────────────────────────────────────────
mcp = FastMCP(APP_NAME, stateless_http=True)

# Capture every tool registered via @mcp.tool so we can serve JSON‑RPC ourselves
TOOLS: Dict[str, Any] = {}
_orig_tool = mcp.tool
def _tool_wrapper(*d_args, **d_kwargs):
    dec = _orig_tool(*d_args, **d_kwargs)
    def inner(fn):
        name = d_kwargs.get("name") or fn.__name__
        TOOLS[name] = fn
        return dec(fn)
    return inner
mcp.tool = _tool_wrapper  # type: ignore

# ── Built‑in tools ───────────────────────────────────────────────────────────
@mcp.tool()
async def ping() -> dict:
    """Connectivity check for MCP server."""
    return {
        "status": "pong",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "server": APP_NAME,
        "version": APP_VERSION,
        "capabilities": ["jsonrpc-2.0", "tools", "sse"],
    }

@mcp.tool()
async def echo(text: str) -> dict:
    """Echo back provided text."""
    return {"echo": text, "length": len(text)}

@mcp.tool()
async def pwd() -> dict:
    """Return the server process working directory."""
    return {"cwd": os.getcwd()}

# Register external tools (best‑effort)
for modname in (
    "aiassist_mcp.tools.fs",
    "aiassist_mcp.tools.fs_write",
    "aiassist_mcp.tools.shell",
    "aiassist_mcp.tools.test",
):
    try:
        mod = __import__(modname, fromlist=["register"])
        if hasattr(mod, "register"):
            mod.register(mcp)
            log.info(f"[mcp] registered tools from {modname}")
        else:
            log.warning(f"[mcp] {modname} has no register(mcp) function, skipping")
    except Exception as e:
        log.warning(f"[mcp] skipped {modname}: {e}")

# ── Auth (Bearer) ────────────────────────────────────────────────────────────
class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/mcp"):
            expected = os.getenv("AIASSIST_MCP_TOKEN", "")
            if expected:
                got = request.headers.get("Authorization", "")
                if got != f"Bearer {expected}":
                    return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)

# ── Health / Root ────────────────────────────────────────────────────────────
async def root_handler(_request: Request):
    return JSONResponse({
        "message": "MCP Server running",
        "status": "ok",
        "name": APP_NAME,
        "version": APP_VERSION,
        "paths": {"health": "/health", "rpc": "/mcp and /mcp/rpc", "sse": "/mcp/sse (if available)"},
    })

async def health_handler(_request: Request):
    return JSONResponse({"status": "healthy", "service": "mcp", "name": APP_NAME, "version": APP_VERSION})

# ── JSON‑RPC core ────────────────────────────────────────────────────────────
async def _maybe_await(x):
    if inspect.isawaitable(x):
        return await x
    return x

def _jsonrpc_error(id_, code: int, message: str):
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}

def _jsonrpc_result(id_, result: Any):
    return {"jsonrpc": "2.0", "id": id_, "result": result}

def _tool_signature_dict(fn: Any) -> dict:
    sig = inspect.signature(fn)
    params = []
    for name, p in sig.parameters.items():
        params.append({
            "name": name,
            "kind": str(p.kind),
            "default": None if p.default is inspect._empty else p.default,
            "annotation": None if p.annotation is inspect._empty else str(p.annotation),
        })
    return {"name": getattr(fn, "__name__", None), "doc": (getattr(fn, "__doc__", "") or "").strip(), "params": params}

def _apply_arg_aliases(fn: Any, arguments: dict) -> dict:
    if not isinstance(arguments, dict):
        return arguments
    sig = inspect.signature(fn)
    param_names = list(sig.parameters.keys())
    if not param_names:
        return arguments

    new_args = dict(arguments)

    # Single-param niceties (already present)
    if "path" in new_args and "path" not in param_names and len(param_names) == 1:
        only = param_names[0]
        new_args[only] = new_args.pop("path")
    if len(param_names) == 1:
        pname = param_names[0]
        if "cmd" in new_args and pname == "command":
            new_args["command"] = new_args.pop("cmd")
        if "command" in new_args and pname == "cmd":
            new_args["cmd"] = new_args.pop("command")

    # 🔹 NEW: multi-param friendly alias for common FS tools
    # If the tool expects 'dir' and caller sent 'path' but not 'dir', map it.
    if "dir" in param_names and "dir" not in new_args and "path" in new_args:
        new_args["dir"] = new_args.pop("path")

    return new_args
async def mcp_rpc_handler(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(_jsonrpc_error(None, -32700, "Parse error"), status_code=400)

    jsonrpc = payload.get("jsonrpc")
    method = payload.get("method")
    id_ = payload.get("id")
    params = payload.get("params", {}) or {}

    if jsonrpc != "2.0" or not method:
        return JSONResponse(_jsonrpc_error(id_, -32600, "Invalid Request"), status_code=400)

    # List tools
    if method == "tools/list":
        result = {
            "tools": [
                {"name": name, "description": (getattr(fn, "__doc__", None) or "").strip()}
                for name, fn in sorted(TOOLS.items())
            ]
        }
        return JSONResponse(_jsonrpc_result(id_, result))

    # Describe a specific tool (signature + doc)
    if method in ("tools/describe", "tools/spec"):
        name = params.get("name")
        if not name or name not in TOOLS:
            return JSONResponse(_jsonrpc_error(id_, -32601, f"Tool not found: {name}"), status_code=404)
        fn = TOOLS[name]
        spec = _tool_signature_dict(fn)
        return JSONResponse(_jsonrpc_result(id_, spec))

    # Call a tool
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments", {}) or {}
        if not name or name not in TOOLS:
            return JSONResponse(_jsonrpc_error(id_, -32601, f"Tool not found: {name}"), status_code=404)
        fn = TOOLS[name]
        try:
            # be forgiving about common param aliases
            arguments = _apply_arg_aliases(fn, arguments)
            result = await _maybe_await(fn(**arguments))
            return JSONResponse(_jsonrpc_result(id_, result))
        except TypeError as e:
            # expose signature to help callers fix payloads
            spec = _tool_signature_dict(fn)
            return JSONResponse(_jsonrpc_error(id_, -32602, f"Invalid params: {e}. Signature: {spec}"), status_code=400)
        except Exception as e:
            return JSONResponse(_jsonrpc_error(id_, -32000, f"Tool error: {e}"), status_code=500)

    return JSONResponse(_jsonrpc_error(id_, -32601, f"Method not found: {method}"), status_code=404)

# ── Starlette app wiring ─────────────────────────────────────────────────────
app = Starlette()
app.router.redirect_slashes = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

app.add_route("/", root_handler)
app.add_route("/health", health_handler)

# Always provide our own JSON‑RPC entrypoints
app.add_route("/mcp", mcp_rpc_handler, methods=["POST"])
app.add_route("/mcp/rpc", mcp_rpc_handler, methods=["POST"])

# Try to mount SSE if fastmcp exposes it (optional)
try:
    sse_app_fn = getattr(mcp, "sse_app", None)
    if callable(sse_app_fn):
        app.mount("/mcp/sse", sse_app_fn())
except Exception as e:
    log.warning(f"[mcp] sse_app() mount failed: {e}")

# Route dump (debug)
try:
    routes = [getattr(r, "path", None) or getattr(r, "path_format", None) for r in app.routes]
    log.info(f"[mcp] ROUTES: {routes}")
except Exception as e:
    log.warning(f"[mcp] route dump failed: {e}")

def main():
    import uvicorn
    log.info(f"[mcp] Starting {APP_NAME} v{APP_VERSION}")
    log.info(f"[mcp] HTTP on :{PORT}")
    log.info(f"[mcp] Allowed origins: {ALLOWED_ORIGINS or ['*']}")
    token_set = bool(os.getenv("AIASSIST_MCP_TOKEN", ""))
    log.info(f"[mcp] Auth enabled: {token_set} (Bearer token required on /mcp/*)")
    log.info(f"[mcp] Endpoints: /, /health, /mcp, /mcp/rpc, /mcp/sse?")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level=os.getenv("UVICORN_LOG_LEVEL", "info"))

if __name__ == "__main__":
    main()
