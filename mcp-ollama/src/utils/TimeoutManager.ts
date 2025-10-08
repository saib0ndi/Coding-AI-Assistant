export class TimeoutManager {
    private static readonly DEFAULT_TIMEOUT = 60000; // 60 seconds
    private static readonly MAX_TIMEOUT = 120000; // 2 minutes max

    static async withTimeout<T>(
        promise: Promise<T>, 
        timeoutMs: number = TimeoutManager.DEFAULT_TIMEOUT,
        errorMessage: string = 'Operation timed out'
    ): Promise<T> {
        const boundedTimeout = Math.min(timeoutMs, TimeoutManager.MAX_TIMEOUT);
        
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error(errorMessage)), boundedTimeout)
            )
        ]);
    }

    static async withFallback<T>(
        promise: Promise<T>,
        fallback: T,
        timeoutMs: number = TimeoutManager.DEFAULT_TIMEOUT
    ): Promise<T> {
        try {
            return await TimeoutManager.withTimeout(promise, timeoutMs);
        } catch (error) {
            console.warn(`Operation failed, using fallback:`, error);
            return fallback;
        }
    }
}