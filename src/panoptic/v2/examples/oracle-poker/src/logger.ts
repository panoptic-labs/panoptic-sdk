/**
 * Simple logger with timestamps for the Oracle Poker Bot
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export class Logger {
  private verbose: boolean

  constructor(verbose = false) {
    this.verbose = verbose
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    const timestamp = this.formatTimestamp()
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`

    if (level === 'debug' && !this.verbose) {
      return
    }

    switch (level) {
      case 'error':
        console.error(prefix, message, ...args)
        break
      case 'warn':
        console.warn(prefix, message, ...args)
        break
      case 'info':
        console.log(prefix, message, ...args)
        break
      case 'debug':
        console.log(prefix, message, ...args)
        break
    }
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args)
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args)
  }
}
