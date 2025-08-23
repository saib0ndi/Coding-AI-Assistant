# tools/mcp-servers/aiassist_mcp/tools/shell.py
import shlex, subprocess
from typing import List
from mcp.server.fastmcp import FastMCP

ALLOWED = {"pwd", "whoami", "uname", "echo", "ls"}  # add/remove as needed

def register(mcp: FastMCP):
    @mcp.tool()
    def shell_run(cmd: str, cwd: str = ".", timeout: int = 30):
        """
        Run a whitelisted shell command.
        Only the first token is checked against ALLOWED.
        """
        # parse safely; reject empty
        tokens: List[str] = shlex.split(cmd)
        if not tokens:
            return {"ok": False, "error": "empty command"}

        first = tokens[0]
        if first not in ALLOWED:
            return {"ok": False, "error": f"command not allowed: {first}"}

        try:
            out = subprocess.check_output(tokens, cwd=cwd, stderr=subprocess.STDOUT, text=True, timeout=timeout)
            return {"ok": True, "output": out[:20000]}
        except subprocess.CalledProcessError as e:
            return {"ok": False, "code": e.returncode, "output": (e.output or "")[:20000]}
        except Exception as e:
            return {"ok": False, "error": str(e)}
