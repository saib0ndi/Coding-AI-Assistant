# Fix GitHub Rate Limit Issue

## Problem
❌ **GitHub API error: 403 rate limit exceeded**

## Solution

### 1. Create GitHub Personal Access Token
1. Go to https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Give it a name like "MCP Ollama Repository Analyzer"
4. Select scopes:
   - ✅ `public_repo` (access public repositories)
   - ✅ `repo:status` (access commit status)
5. Click **"Generate token"**
6. **Copy the token immediately** (you won't see it again)

### 2. Set Environment Variable

**Option A: Temporary (current session)**
```bash
export GITHUB_TOKEN=ghp_your_token_here
```

**Option B: Permanent (.env file)**
```bash
echo 'GITHUB_TOKEN=ghp_your_token_here' > /home/sb57213v/Coding-AI-Assistant/mcp-ollama/.env
```

**Option C: System-wide**
```bash
echo 'export GITHUB_TOKEN=ghp_your_token_here' >> ~/.bashrc
source ~/.bashrc
```

### 3. Verify Setup
```bash
cd /home/sb57213v/Coding-AI-Assistant/mcp-ollama
node -e "console.log('Token set:', !!process.env.GITHUB_TOKEN)"
```

## Rate Limits

| Authentication | Requests/Hour |
|----------------|---------------|
| No token       | 60            |
| With token     | 5,000         |
| GitHub Actions | 1,000         |

## Test After Setup
```bash
cd /home/sb57213v/Coding-AI-Assistant/mcp-ollama
node test-explanation.mjs
```

The system will now work with much higher rate limits!