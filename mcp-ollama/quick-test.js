#!/usr/bin/env node

// Quick test of slash command
import http from 'http';

const testSlashCommand = () => {
  const data = JSON.stringify({
    command: '/explain',
    code: 'console.log("hello");',
    language: 'javascript'
  });

  const options = {
    hostname: 'localhost',
    port: 3077,
    path: '/tools/slash_command',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    },
    timeout: 60000
  };

  console.log('🧪 Testing slash command...');
  
  const req = http.request(options, (res) => {
    console.log(`📡 Server responded: ${res.statusCode}`);
    let responseData = '';
    res.on('data', chunk => responseData += chunk);
    res.on('end', () => {
      console.log('📄 Response:', responseData.substring(0, 500));
    });
  });

  req.on('error', (err) => {
    console.log(`❌ Request failed: ${err.message}`);
  });

  req.on('timeout', () => {
    console.log('⏰ Request timed out');
    req.destroy();
  });

  req.setTimeout(60000);
  req.write(data);
  req.end();
};

testSlashCommand();