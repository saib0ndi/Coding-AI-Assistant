import fetch from 'node-fetch';

const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'deepseek-coder-v2:236b';

async function test(users) {
  console.log(`Testing ${users} users...`);
  const promises = Array.from({length: users}, async (_, i) => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: 'Hello world',
          stream: false,
          options: {num_predict: 20}
        }),
        timeout: 30000
      });
      return res.ok ? 'success' : `failed-${res.status}`;
    } catch(e) { return `error-${e.message}`; }
  });
  
  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled' && r.value === 'success').length;
  console.log(`${successful}/${users} successful (${(successful/users*100).toFixed(1)}%)`);
}

for (const count of [26, 27, 28, 29]) {
  await test(count);
  await new Promise(r => setTimeout(r, 2000));
}
