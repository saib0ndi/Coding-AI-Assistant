import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  // 1) Transport: only { command, args }
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });

  // 2) Client
  const client = new Client({
    name: "mcp-test-client",
    version: "1.0.0",
    capabilities: {},
  });

  // 3) Connect
  await client.connect(transport);

  // 4) List tools
  const toolsRes = await client.listTools();
  console.log("[CLIENT] Tools:", toolsRes.tools.map((t) => t.name));

  // 5) Call a tool
  const result = await client.callTool({
    name: "code_generation",
    arguments: {
      prompt: "i want to create a admin panel dashboard using react and node express  also use tailwind css for styling and cassandra db for database admin panel should have user management and role based access control",
      language: "TypeScript",
    },
  });

  console.log("[CLIENT] Result:");
  console.dir(result, { depth: 5 });

  // 6) Close
  client.close();
}

main().catch((err) => {
  const sanitizedError = err instanceof Error ? err.message.replace(/[\r\n]/g, ' ') : 'Unknown error';
  console.error("[CLIENT] Fatal:", sanitizedError);
  process.exit(1);
});

