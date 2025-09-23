from pathlib import Path
from mcp.server.fastmcp import FastMCP

def register(mcp: FastMCP):
    @mcp.tool()
    def fs_read(path: str, max_bytes: int | None = 1024*1024):
        p = Path(path)
        if not p.exists():
            return {"ok": False, "error": "not found", "path": str(p)}
        data = p.read_bytes()
        truncated = False
        if max_bytes and len(data) > max_bytes:
            data, truncated = data[:max_bytes], True
        return {"ok": True, "path": str(p), "text": data.decode("utf-8", errors="ignore"), "truncated": truncated}

    @mcp.tool()
    def fs_list(dir: str, glob: str = "**/*", limit: int = 200):
        base = Path(dir)
        if not base.exists():
            return {"ok": False, "error": "dir not found", "dir": str(base)}
        items = []
        for i, p in enumerate(sorted(base.glob(glob))):
            if i >= limit: break
            if p.is_file():
                st = p.stat()
                items.append({"path": str(p), "size": st.st_size})
        return {"ok": True, "dir": str(base), "items": items}