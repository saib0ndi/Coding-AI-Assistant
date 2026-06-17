#!/usr/bin/env node
// Quick connectivity test for sarvamai/sarvam-m via NVIDIA API
// Usage: CLOUD_API_KEY=<your-key> node test-sarvam.js

const API_KEY = process.env.CLOUD_API_KEY;
const BASE_URL = process.env.CLOUD_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const MODEL = process.env.CLOUD_MODEL || 'sarvamai/sarvam-m';

if (!API_KEY) {
  console.error('Error: CLOUD_API_KEY environment variable is not set.');
  console.error('Usage: CLOUD_API_KEY=<your-key> node test-sarvam.js');
  process.exit(1);
}

const url = `${BASE_URL}/chat/completions`;
const body = {
  model: MODEL,
  messages: [{ role: 'user', content: 'Say "Sarvam is working!" and nothing else.' }],
  stream: false,
  temperature: 0.1
};

console.log(`Testing connection to: ${url}`);
console.log(`Model: ${MODEL}\n`);

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  },
  body: JSON.stringify(body)
})
  .then(async res => {
    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!res.ok) {
      console.error('Error response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }
    const reply = data.choices?.[0]?.message?.content;
    console.log(`Response: ${reply}`);
    console.log('\nSarvam API is reachable and responding correctly.');
  })
  .catch(err => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
