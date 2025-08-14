import subprocess, shlex
from mcp.server.fastmcp import FastMCP

ALLOW = {"npm","pnpm","pytest","go","cargo","python","node","bash","sh"}

def register(mcp: FastMCP):
    @mcp.tool()
    def shell_run(cmd: str, timeout: int = 60):
        prog = shlex.split(cmd)[0] if cmd.strip() else ""
        if prog not in ALLOW:
            return {"ok": False, "error": f"command not allowed: {prog}"}
        try:
            out = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, text=True, timeout=timeout)
            return {"ok": True, "output": out[:20000]}
        except subprocess.CalledProcessError as e:
            return {"ok": False, "code": e.returncode, "output": (e.output or "")[:20000]}
        except subprocess.TimeoutExpired as e:
            return {"ok": False, "error": f"timeout after {timeout}s", "output": (e.output or "")[:20000]}