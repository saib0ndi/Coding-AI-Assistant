#!/bin/bash

echo "🚀 Scaling MCP-Ollama to handle 500 concurrent users"
echo "=================================================="

# Step 1: Setup multiple Ollama instances
echo "📦 Step 1: Setting up Ollama cluster..."
cat << 'EOF' > setup-ollama-cluster.sh
#!/bin/bash

# Install Ollama on multiple servers
OLLAMA_SERVERS=(
  "10.10.110.25"
  "10.10.110.26" 
  "10.10.110.27"
  "10.10.110.28"
  "10.10.110.29"
)

for server in "${OLLAMA_SERVERS[@]}"; do
  echo "Setting up Ollama on $server..."
  ssh root@$server << 'REMOTE_SCRIPT'
    # Install Ollama
    curl -fsSL https://ollama.ai/install.sh | sh
    
    # Configure for external access
    systemctl edit ollama
    # Add: Environment="OLLAMA_HOST=0.0.0.0:11434"
    
    # Pull the model
    ollama pull deepseek-coder-v2:236b
    
    # Start service
    systemctl start ollama
    systemctl enable ollama
REMOTE_SCRIPT
done
EOF

chmod +x setup-ollama-cluster.sh

# Step 2: Build and deploy scaled architecture
echo "🏗️  Step 2: Building scaled architecture..."

# Update package.json for scaling dependencies
npm install --save ioredis bull cluster

# Step 3: Deploy with Docker Compose
echo "🐳 Step 3: Deploying with Docker Compose..."
docker-compose -f docker-compose.scale.yml up -d

# Step 4: Setup monitoring
echo "📊 Step 4: Setting up monitoring..."
cat << 'EOF' > prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'mcp-servers'
    static_configs:
      - targets: ['mcp-server-1:3077', 'mcp-server-2:3078', 'mcp-server-3:3079']
  
  - job_name: 'ollama-cluster'
    static_configs:
      - targets: ['10.10.110.25:11434', '10.10.110.26:11434', '10.10.110.27:11434']
EOF

# Step 5: Performance tuning
echo "⚡ Step 5: Performance tuning..."
cat << 'EOF' > performance-tune.sh
#!/bin/bash

# Increase file descriptors
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# Tune network settings
echo "net.core.somaxconn = 65536" >> /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65536" >> /etc/sysctl.conf
sysctl -p

# Node.js memory settings
export NODE_OPTIONS="--max-old-space-size=8192"
EOF

chmod +x performance-tune.sh

echo "✅ Scaling setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Run: ./setup-ollama-cluster.sh"
echo "2. Run: ./performance-tune.sh" 
echo "3. Start: docker-compose -f docker-compose.scale.yml up -d"
echo "4. Test: node test-500-users.js"
echo ""
echo "🎯 Expected capacity: 500+ concurrent users"
echo "📊 Monitor at: http://localhost:9090 (Prometheus)"
echo "🔧 Load balancer: http://localhost:8080"