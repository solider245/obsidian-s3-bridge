// 简单的日志管理器
export class Logger {
    private static isProduction = process.env.NODE_ENV === 'production'
    
    static debug(message: string, ...args: any[]) {
        if (!this.isProduction) {
            console.debug(`[DEBUG] ${message}`, ...args)
        }
    }
    
    static info(message: string, ...args: any[]) {
        if (!this.isProduction) {
            console.info(`[INFO] ${message}`, ...args)
        }
    }
    
    static warn(message: string, ...args: any[]) {
        console.warn(`[WARN] ${message}`, ...args)
    }
    
    static error(message: string, ...args: any[]) {
        console.error(`[ERROR] ${message}`, ...args)
    }
}

// 使用示例
// Logger.debug('Debug信息')
// Logger.info('普通信息')
// Logger.warn('警告信息')
// Logger.error('错误信息')