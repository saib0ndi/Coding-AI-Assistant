export class RetryManager {
    static async withRetry<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        delay: number = 1000,
        backoff: boolean = true
    ): Promise<T> {
        let lastError: Error = new Error('Unknown error');
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                
                if (attempt === maxRetries) {
                    break;
                }
                
                const waitTime = backoff ? delay * Math.pow(2, attempt) : delay;
                await this.sleep(waitTime);
            }
        }
        
        throw new Error(`Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`);
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static isRetryableError(error: Error): boolean {
        const retryableMessages = [
            'network error',
            'timeout',
            'connection refused',
            'service unavailable',
            'internal server error'
        ];
        
        const message = error.message.toLowerCase();
        return retryableMessages.some(msg => message.includes(msg));
    }
}