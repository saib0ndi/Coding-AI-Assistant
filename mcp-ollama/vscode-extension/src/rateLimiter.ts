export class RateLimiter {
    private lastRequestTime = 0;
    private requestQueue: Array<() => void> = [];
    private isProcessing = false;

    constructor(private minDelay: number = 500) {}

    async throttle<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push(async () => {
                try {
                    const result = await operation();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });

            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;

            if (timeSinceLastRequest < this.minDelay) {
                await this.sleep(this.minDelay - timeSinceLastRequest);
            }

            const operation = this.requestQueue.shift();
            if (operation) {
                this.lastRequestTime = Date.now();
                await operation();
            }
        }

        this.isProcessing = false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getQueueLength(): number {
        return this.requestQueue.length;
    }
}