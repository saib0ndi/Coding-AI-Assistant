import fetch from 'node-fetch';

async function test(users) {
  console.log(`Testing ${users} users...`);
  const promises = Array.from({length: users}, async (_, i) => {
    try {
      const res = await fetch('http://10.10.110.25:11434/api/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: 'deepseek-coder-v2:236b',
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