#!/usr/bin/env python3
import os
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette

# Create a minimal MCP server with a test tool
mcp = FastMCP("test-mcp", stateless_http=True)

@mcp.tool()
def test_tool(message: str) -> str:
    """A simple test tool"""
    return f"Echo: {message}"

# Create Starlette app
app = Starlette()
app.mount("/mcp", mcp.streamable_http_app())

if __name__ == "__main__":
    import uvicorn
    print("Starting test MCP server on :9999")
    uvicorn.run(app, host="0.0.0.0", port=9999, log_level="info")
