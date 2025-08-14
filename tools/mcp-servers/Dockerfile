FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY aiassist_mcp /app/aiassist_mcp

# ✅ correct package: mcp with HTTP extras
RUN pip install --no-cache-dir "mcp[http]" uvicorn pytest

ENV AIASSIST_MCP_TOKEN=devtoken123
EXPOSE 9999
CMD ["python","-m","aiassist_mcp.server","http","9999"]
