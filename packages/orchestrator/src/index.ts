import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/status", (_req, res) =>
  res.json({ ok: true, service: "orchestrator", mcp: "down", ollama: "down" })
);

// Very simple "edit" suggestion for demo purposes.
// Always appends a comment to the end of the file.
app.post("/chat", (req, res) => {
  const { fileName, languageId, text } = req.body ?? {};
  const lines = (typeof text === "string" ? text.split(/\r?\n/g) : []).length;
  const suggestion =
    `\n// AI Assist: example suggestion for ${fileName ?? "untitled"} ` +
    `(${languageId ?? "unknown"}), ${new Date().toISOString()}, ` +
    `lines=${lines}\n`;
  return res.json({ ok: true, type: "append", text: suggestion });
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`orchestrator listening on :${PORT}`));
