#!/usr/bin/env python3
import os
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request
from mcp.server.fastmcp import FastMCP


# --- Build FastMCP server ---
mcp = FastMCP("aiassist-mcp", stateless_http=True)

# Register tool modules (each should expose a register(mcp) function)
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
    except Exception as e:
        print(f"[warn] skipped {modname}: {e}", flush=True)


# --- Auth middleware (Bearer token via AIASSIST_MCP_TOKEN) ---
class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/mcp"):
            expected = os.getenv("AIASSIST_MCP_TOKEN", "")
            if expected:
                got = request.headers.get("Authorization", "")
                if got != f"Bearer {expected}":
                    return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


# --- Starlette app wiring ---
app = Starlette()
app.router.redirect_slashes = False
app.add_middleware(AuthMiddleware)
app.mount("/mcp", mcp.streamable_http_app())

def main():
    import uvicorn
    port = int(os.getenv("PORT", "9999"))
    print(f"[mcp] HTTP on :{port} (paths /mcp/rpc, /mcp/sse)", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")

if __name__ == "__main__":
    main()