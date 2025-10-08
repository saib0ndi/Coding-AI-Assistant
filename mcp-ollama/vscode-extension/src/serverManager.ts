import * as vscode from 'vscode';
import * as net from 'net';
import { spawn, ChildProcess, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ServerManager {
    private serverProcess: ChildProcess | null = null;
    private currentPort: number = 3077;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private isStarting = false;

    async findAvailablePort(startPort: number = 3077): Promise<number> {
        for (let port = startPort; port < startPort + 100; port++) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        throw new Error('No available ports found');
    }

    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.listen(port, () => {
                server.close(() => resolve(true));
            });
            server.on('error', () => resolve(false));
        });
    }

    async startServer(): Promise<number> {
        if (this.isStarting) return this.currentPort;
        this.isStarting = true;

        try {
            await this.killAllServerProcesses();
            this.currentPort = await this.findAvailablePort();
            
            // Try multiple possible server paths
            const possiblePaths = [
                path.join(__dirname, '../../../../dist/index.js'),
                path.join(__dirname, '../../../dist/index.js'),
                '/home/sb57213v/Coding-AI-Assistant/mcp-ollama/dist/index.js'
            ];
            
            let serverPath = possiblePaths[0];
            for (const testPath of possiblePaths) {
                try {
                    if (fs.existsSync(testPath)) {
                        serverPath = testPath;
                        console.log(`Found server at: ${serverPath}`);
                        break;
                    }
                } catch (e) {
                    // Continue to next path
                }
            }
            console.log(`Starting server with path: ${serverPath}`);
            this.serverProcess = spawn('node', [serverPath], {
                env: { 
                    ...process.env, 
                    MCP_SERVER_PORT: this.currentPort.toString(),
                    DEFAULT_HTTP_PORT: this.currentPort.toString(),
                    OLLAMA_HOST: 'http://10.10.110.25:11434',
                    NODE_ENV: 'production'
                },
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false
            });
            
            // Log server output for debugging
            this.serverProcess.stdout?.on('data', (data) => {
                console.log(`Server stdout: ${data}`);
            });
            
            this.serverProcess.stderr?.on('data', (data) => {
                console.error(`Server stderr: ${data}`);
            });

            this.serverProcess.on('error', (error) => {
                console.error('Server process error:', error);
                this.restartServer();
            });

            this.serverProcess.on('exit', (code) => {
                if (code !== 0 && !this.isStarting) {
                    console.log('Server exited with code:', code);
                    setTimeout(() => this.restartServer(), 3000);
                }
            });

            await this.waitForServer();
            this.startHealthMonitoring();
            this.isStarting = false;
            return this.currentPort;

        } catch (error) {
            this.isStarting = false;
            throw error;
        }
    }

    private async waitForServer(timeout = 20000): Promise<void> {
        const start = Date.now();
        let attempts = 0;
        const maxAttempts = 40;
        
        // Wait a bit for server to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        while (Date.now() - start < timeout && attempts < maxAttempts) {
            attempts++;
            console.log(`Health check attempt ${attempts}/${maxAttempts}`);
            
            if (await this.checkHealth()) {
                console.log(`Server ready after ${attempts} attempts`);
                return;
            }
            
            // Check if process is still running
            if (this.serverProcess && this.serverProcess.killed) {
                throw new Error('Server process died during startup');
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error(`Server failed to start within ${timeout}ms (${attempts} attempts)`);
    }

    async checkHealth(): Promise<boolean> {
        try {
            console.log(`Checking health at: http://localhost:${this.currentPort}/health`);
            const response = await fetch(`http://localhost:${this.currentPort}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`Health check response: ${response.status}`);
            return response.ok;
        } catch (error) {
            console.log(`Health check failed: ${error}`);
            return false;
        }
    }

    private startHealthMonitoring(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            if (!await this.checkHealth()) {
                console.log('Health check failed, restarting server...');
                this.restartServer();
            }
        }, 30000);
    }

    private async restartServer(): Promise<void> {
        if (this.isStarting) return;
        console.log('Restarting server...');
        await this.startServer();
    }

    async stopServer(): Promise<void> {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        if (this.serverProcess) {
            this.serverProcess.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!this.serverProcess.killed) {
                this.serverProcess.kill('SIGKILL');
            }
            this.serverProcess = null;
        }
        
        await this.killAllServerProcesses();
    }

    getServerUrl(): string {
        return `http://localhost:${this.currentPort}`;
    }

    getPort(): number {
        return this.currentPort;
    }

    private async killAllServerProcesses(): Promise<void> {
        try {
            // Kill processes on current port
            await this.killProcessesOnPort(this.currentPort);
            
            // Kill any MCP server processes
            try {
                await execAsync('pkill -f "node.*dist/index.js" || true');
            } catch (error) {
                // Ignore errors - process might not exist
            }
            
            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.warn('Error killing server processes:', error);
        }
    }

    private async killProcessesOnPort(port: number): Promise<void> {
        try {
            const { stdout } = await execAsync(`lsof -ti:${port}`);
            const pids = stdout.trim().split('\n').filter(Boolean);
            
            for (const pid of pids) {
                try {
                    await execAsync(`kill -9 ${pid}`);
                } catch (error) {
                    // Process might already be dead
                }
            }
        } catch (error) {
            // No processes on port - this is fine
        }
    }
}