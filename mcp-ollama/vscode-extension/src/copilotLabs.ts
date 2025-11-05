import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';

export class CopilotLabs {
    private panel: vscode.WebviewPanel | undefined;
    private mcpClient: MCPClient;

    constructor(mcpClient: MCPClient) {
        this.mcpClient = mcpClient;
    }

    showLabsPanel() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'copilotLabs',
            'Copilot Labs',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getLabsHTML();
        
        this.panel.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.handleLabsMessage(message);
            } catch (error) {
                console.error('Error handling labs message:', error);
                this.panel?.webview.postMessage({
                    command: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error occurred'
                });
            }
        });

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private getLabsHTML(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Copilot Labs</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
        }
        .lab-section {
            margin-bottom: 30px;
            padding: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
        }
        .lab-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .brush-container {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin: 10px 0;
        }
        .brush-btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .brush-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .code-area {
            width: 100%;
            min-height: 200px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            padding: 10px;
            font-family: monospace;
            border-radius: 4px;
        }
        .result-area {
            margin-top: 10px;
            padding: 10px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            white-space: pre-wrap;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <h1>🧪 Copilot Labs</h1>
    
    <div class="lab-section">
        <div class="lab-title">Code Brushes</div>
        <p>Transform your code with AI-powered brushes</p>
        <textarea class="code-area" id="codeInput" placeholder="Paste your code here..."></textarea>
        <div class="brush-container">
            <button class="brush-btn" onclick="applyBrush('readable')">📖 Make Readable</button>
            <button class="brush-btn" onclick="applyBrush('robust')">🛡️ Make Robust</button>
            <button class="brush-btn" onclick="applyBrush('debug')">🐛 Add Debug</button>
            <button class="brush-btn" onclick="applyBrush('document')">📝 Add Docs</button>
            <button class="brush-btn" onclick="applyBrush('optimize')">⚡ Optimize</button>
            <button class="brush-btn" onclick="applyBrush('clean')">🧹 Clean Up</button>
            <button class="brush-btn" onclick="applyBrush('secure')">🔒 Add Security</button>
            <button class="brush-btn" onclick="applyBrush('async')">⏱️ Make Async</button>
            <button class="brush-btn" onclick="applyBrush('functional')">🔄 Functional Style</button>
            <button class="brush-btn" onclick="applyBrush('database')">🗄️ DB Optimize</button>
        </div>
        <div class="result-area" id="brushResult"></div>
    </div>

    <div class="lab-section">
        <div class="lab-title">Language Translator</div>
        <p>Convert code between programming languages</p>
        <textarea class="code-area" id="translateInput" placeholder="Code to translate..."></textarea>
        <div class="brush-container">
            <select id="fromLang">
                <optgroup label="Web Languages">
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="html">HTML</option>
                    <option value="css">CSS</option>
                    <option value="php">PHP</option>
                </optgroup>
                <optgroup label="System Languages">
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="csharp">C#</option>
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                    <option value="go">Go</option>
                    <option value="rust">Rust</option>
                    <option value="kotlin">Kotlin</option>
                    <option value="swift">Swift</option>
                </optgroup>
                <optgroup label="Database Languages">
                    <option value="sql">SQL</option>
                    <option value="mysql">MySQL</option>
                    <option value="postgresql">PostgreSQL</option>
                    <option value="mongodb">MongoDB</option>
                    <option value="redis">Redis</option>
                    <option value="cassandra">Cassandra CQL</option>
                    <option value="neo4j">Neo4j Cypher</option>
                </optgroup>
                <optgroup label="Scripting Languages">
                    <option value="bash">Bash</option>
                    <option value="powershell">PowerShell</option>
                    <option value="perl">Perl</option>
                    <option value="ruby">Ruby</option>
                    <option value="lua">Lua</option>
                </optgroup>
                <optgroup label="Functional Languages">
                    <option value="haskell">Haskell</option>
                    <option value="scala">Scala</option>
                    <option value="clojure">Clojure</option>
                    <option value="erlang">Erlang</option>
                    <option value="elixir">Elixir</option>
                    <option value="fsharp">F#</option>
                </optgroup>
                <optgroup label="Data Science">
                    <option value="r">R</option>
                    <option value="matlab">MATLAB</option>
                    <option value="julia">Julia</option>
                    <option value="sas">SAS</option>
                </optgroup>
                <optgroup label="Config/Markup">
                    <option value="yaml">YAML</option>
                    <option value="json">JSON</option>
                    <option value="xml">XML</option>
                    <option value="toml">TOML</option>
                    <option value="dockerfile">Dockerfile</option>
                    <option value="terraform">Terraform</option>
                </optgroup>
            </select>
            <span>→</span>
            <select id="toLang">
                <optgroup label="Web Languages">
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="html">HTML</option>
                    <option value="css">CSS</option>
                    <option value="php">PHP</option>
                </optgroup>
                <optgroup label="System Languages">
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="csharp">C#</option>
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                    <option value="go">Go</option>
                    <option value="rust">Rust</option>
                    <option value="kotlin">Kotlin</option>
                    <option value="swift">Swift</option>
                </optgroup>
                <optgroup label="Database Languages">
                    <option value="sql">SQL</option>
                    <option value="mysql">MySQL</option>
                    <option value="postgresql">PostgreSQL</option>
                    <option value="mongodb">MongoDB</option>
                    <option value="redis">Redis</option>
                    <option value="cassandra">Cassandra CQL</option>
                    <option value="neo4j">Neo4j Cypher</option>
                </optgroup>
                <optgroup label="Scripting Languages">
                    <option value="bash">Bash</option>
                    <option value="powershell">PowerShell</option>
                    <option value="perl">Perl</option>
                    <option value="ruby">Ruby</option>
                    <option value="lua">Lua</option>
                </optgroup>
                <optgroup label="Functional Languages">
                    <option value="haskell">Haskell</option>
                    <option value="scala">Scala</option>
                    <option value="clojure">Clojure</option>
                    <option value="erlang">Erlang</option>
                    <option value="elixir">Elixir</option>
                    <option value="fsharp">F#</option>
                </optgroup>
                <optgroup label="Data Science">
                    <option value="r">R</option>
                    <option value="matlab">MATLAB</option>
                    <option value="julia">Julia</option>
                    <option value="sas">SAS</option>
                </optgroup>
                <optgroup label="Config/Markup">
                    <option value="yaml">YAML</option>
                    <option value="json">JSON</option>
                    <option value="xml">XML</option>
                    <option value="toml">TOML</option>
                    <option value="dockerfile">Dockerfile</option>
                    <option value="terraform">Terraform</option>
                </optgroup>
            </select>
            <button class="brush-btn" onclick="translateCode()">🔄 Translate</button>
        </div>
        <div class="result-area" id="translateResult"></div>
    </div>

    <div class="lab-section">
        <div class="lab-title">Explain Code</div>
        <p>Get detailed explanations of complex code</p>
        <textarea class="code-area" id="explainInput" placeholder="Code to explain..."></textarea>
        <div class="brush-container">
            <button class="brush-btn" onclick="explainCode('beginner')">👶 Beginner</button>
            <button class="brush-btn" onclick="explainCode('intermediate')">👨‍💻 Intermediate</button>
            <button class="brush-btn" onclick="explainCode('expert')">🧠 Expert</button>
        </div>
        <div class="result-area" id="explainResult"></div>
    </div>

    <div class="lab-section">
        <div class="lab-title">Database Query Builder</div>
        <p>Generate and optimize database queries</p>
        <textarea class="code-area" id="dbInput" placeholder="Describe your query or paste existing SQL..."></textarea>
        <div class="brush-container">
            <select id="dbType">
                <option value="mysql">MySQL</option>
                <option value="postgresql">PostgreSQL</option>
                <option value="mongodb">MongoDB</option>
                <option value="redis">Redis</option>
                <option value="sqlite">SQLite</option>
                <option value="oracle">Oracle</option>
                <option value="mssql">SQL Server</option>
            </select>
            <button class="brush-btn" onclick="generateQuery('select')">🔍 SELECT</button>
            <button class="brush-btn" onclick="generateQuery('insert')">➕ INSERT</button>
            <button class="brush-btn" onclick="generateQuery('update')">✏️ UPDATE</button>
            <button class="brush-btn" onclick="generateQuery('optimize')">⚡ Optimize</button>
        </div>
        <div class="result-area" id="dbResult"></div>
    </div>

    <div class="lab-section">
        <div class="lab-title">Infrastructure as Code</div>
        <p>Generate and manage infrastructure configurations</p>
        <textarea class="code-area" id="iacInput" placeholder="Describe your infrastructure needs..."></textarea>
        <div class="brush-container">
            <button class="brush-btn" onclick="generateIaC('terraform')">🌍 Terraform</button>
            <button class="brush-btn" onclick="generateIaC('docker')">🐳 Docker</button>
            <button class="brush-btn" onclick="generateIaC('kubernetes')">⚙️ Kubernetes</button>
            <button class="brush-btn" onclick="generateIaC('ansible')">🛠️ Ansible</button>
            <button class="brush-btn" onclick="generateIaC('cloudformation')">☁️ CloudFormation</button>
        </div>
        <div class="result-area" id="iacResult"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function applyBrush(brushType) {
            const code = document.getElementById('codeInput').value;
            if (!code.trim()) return;

            vscode.postMessage({
                command: 'applyBrush',
                brushType: brushType,
                code: code
            });
        }

        function translateCode() {
            const code = document.getElementById('translateInput').value;
            const fromLang = document.getElementById('fromLang').value;
            const toLang = document.getElementById('toLang').value;
            
            if (!code.trim()) return;

            vscode.postMessage({
                command: 'translateCode',
                code: code,
                fromLang: fromLang,
                toLang: toLang
            });
        }

        function explainCode(level) {
            const code = document.getElementById('explainInput').value;
            if (!code.trim()) return;

            vscode.postMessage({
                command: 'explainCode',
                code: code,
                level: level
            });
        }

        function generateQuery(type) {
            const description = document.getElementById('dbInput').value;
            const dbType = document.getElementById('dbType').value;
            if (!description.trim()) return;

            vscode.postMessage({
                command: 'generateQuery',
                description: description,
                dbType: dbType,
                queryType: type
            });
        }

        function generateIaC(platform) {
            const description = document.getElementById('iacInput').value;
            if (!description.trim()) return;

            vscode.postMessage({
                command: 'generateIaC',
                description: description,
                platform: platform
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'brushResult':
                    document.getElementById('brushResult').textContent = message.result;
                    break;
                case 'translateResult':
                    document.getElementById('translateResult').textContent = message.result;
                    break;
                case 'explainResult':
                    document.getElementById('explainResult').textContent = message.result;
                    break;
                case 'dbResult':
                    document.getElementById('dbResult').textContent = message.result;
                    break;
                case 'iacResult':
                    document.getElementById('iacResult').textContent = message.result;
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    private async handleLabsMessage(message: any) {
        if (!message || !message.command) {
            throw new Error('Invalid message format');
        }

        switch (message.command) {
            case 'applyBrush':
                if (!message.brushType || !message.code) {
                    throw new Error('Missing brush type or code');
                }
                const brushResult = await this.applyCodeBrush(message.brushType, message.code);
                this.panel?.webview.postMessage({
                    command: 'brushResult',
                    result: brushResult
                });
                break;

            case 'translateCode':
                if (!message.code || !message.fromLang || !message.toLang) {
                    throw new Error('Missing translation parameters');
                }
                const translateResult = await this.translateCode(message.code, message.fromLang, message.toLang);
                this.panel?.webview.postMessage({
                    command: 'translateResult',
                    result: translateResult
                });
                break;

            case 'explainCode':
                if (!message.code || !message.level) {
                    throw new Error('Missing code or explanation level');
                }
                const explainResult = await this.explainCode(message.code, message.level);
                this.panel?.webview.postMessage({
                    command: 'explainResult',
                    result: explainResult
                });
                break;

            case 'generateQuery':
                if (!message.description || !message.dbType || !message.queryType) {
                    throw new Error('Missing query generation parameters');
                }
                const queryResult = await this.generateDatabaseQuery(message.description, message.dbType, message.queryType);
                this.panel?.webview.postMessage({
                    command: 'dbResult',
                    result: queryResult
                });
                break;

            case 'generateIaC':
                if (!message.description || !message.platform) {
                    throw new Error('Missing infrastructure generation parameters');
                }
                const iacResult = await this.generateInfrastructureCode(message.description, message.platform);
                this.panel?.webview.postMessage({
                    command: 'iacResult',
                    result: iacResult
                });
                break;

            default:
                throw new Error(`Unknown command: ${message.command}`);
        }
    }

    private async applyCodeBrush(brushType: string, code: string): Promise<string> {
        const prompts = {
            readable: 'Make this code more readable and well-formatted',
            robust: 'Add error handling and make this code more robust',
            debug: 'Add debugging statements and logging to this code',
            document: 'Add comprehensive documentation and comments',
            optimize: 'Optimize this code for better performance',
            clean: 'Clean up and refactor this code',
            secure: 'Add security best practices and vulnerability fixes',
            async: 'Convert to asynchronous patterns with proper error handling',
            functional: 'Refactor using functional programming principles',
            database: 'Optimize for database performance and add connection pooling'
        };

        const prompt = prompts[brushType as keyof typeof prompts] || 'Improve this code';
        
        // Use /refactor for most brushes, /optimize for optimize, /security for secure
        if (brushType === 'optimize') {
            return await this.mcpClient.handleSlashCommand('/optimize', code, 'javascript');
        } else if (brushType === 'secure') {
            return await this.mcpClient.handleSlashCommand('/security', code, 'javascript');
        } else {
            // Use /refactor with specific instructions
            const fullPrompt = `${prompt}: ${code}`;
            return await this.mcpClient.handleSlashCommand('/refactor', fullPrompt, 'javascript');
        }
    }

    private async generateDatabaseQuery(description: string, dbType: string, queryType: string): Promise<string> {
        const prompt = `Generate a ${dbType} ${queryType} query based on this description:\n${description}\n\nProvide optimized, production-ready SQL with proper indexing suggestions.`;
        return await this.mcpClient.handleSlashCommand('/generate', prompt, dbType);
    }

    private async generateInfrastructureCode(description: string, platform: string): Promise<string> {
        const prompt = `Generate ${platform} infrastructure code for:\n${description}\n\nInclude best practices, security configurations, and scalability considerations.`;
        return await this.mcpClient.handleSlashCommand('/generate', prompt, platform);
    }

    private async translateCode(code: string, fromLang: string, toLang: string): Promise<string> {
        try {
            await this.mcpClient.connect();
            const result = await this.mcpClient.callTool('translate_code', {
                code: code,
                fromLanguage: fromLang,
                toLanguage: toLang,
                preserveComments: true
            });
            return typeof result === 'string' ? result : (result.translatedCode || 'Translation failed');
        } catch (error) {
            return `Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async explainCode(code: string, level: string): Promise<string> {
        return await this.mcpClient.explainCode(code, 'javascript');
    }

    dispose() {
        this.panel?.dispose();
    }
}