import os, subprocess
from mcp.server.fastmcp import FastMCP

def register(mcp: FastMCP):
    @mcp.tool()
    def test_detect(cwd: str = "."):
        if os.path.exists(os.path.join(cwd, "package.json")):
            return {"ok": True, "cmd": "pnpm test || npm test"}
        return {"ok": True, "cmd": "pytest -q"}

    @mcp.tool()
    def test_run(cmd: str = "pytest -q", cwd: str = ".", timeout: int = 120):
        try:
            out = subprocess.check_output(cmd, shell=True, cwd=cwd, stderr=subprocess.STDOUT, text=True, timeout=timeout)
            return {"ok": True, "output": out[:20000]}
        except subprocess.CalledProcessError as e:
            return {"ok": False, "code": e.returncode, "output": (e.output or "")[:20000]}