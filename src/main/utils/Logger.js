const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

class Logger {
    constructor() {
        this.appDataDir = (app && app.getPath) 
            ? path.join(app.getPath('appData'), 'LAMPS') 
            : path.join(process.env.APPDATA || os.homedir(), 'LAMPS');
        
        this.logsDir = path.join(this.appDataDir, 'logs');
        this.logFile = path.join(this.logsDir, 'lamps.log');
        this.recentEntries = [];
        this.maxRecentEntries = 200;
        this.init();
    }

    init() {
        try {
            if (!fs.existsSync(this.logsDir)) {
                fs.mkdirSync(this.logsDir, { recursive: true });
            }
        } catch (err) {
            console.error('Failed to initialize logs directory:', err);
        }
    }

    formatTimestamp() {
        const d = new Date();
        return d.toISOString().replace('T', ' ').substring(0, 19);
    }

    write(level, message, meta = null) {
        const timestamp = this.formatTimestamp();
        let logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        if (meta) {
            if (meta instanceof Error) {
                logLine += `\n${meta.stack || meta.message}`;
            } else if (typeof meta === 'object') {
                try {
                    logLine += ` ${JSON.stringify(meta)}`;
                } catch {
                    logLine += ` [Circular]`;
                }
            } else {
                logLine += ` ${meta}`;
            }
        }
        logLine += '\n';

        // Keep in memory
        this.recentEntries.push({ timestamp, level, message, meta });
        if (this.recentEntries.length > this.maxRecentEntries) {
            this.recentEntries.shift();
        }

        // Print to console
        if (level === 'error') {
            console.error(logLine.trim());
        } else if (level === 'warn') {
            console.warn(logLine.trim());
        } else {
            console.log(logLine.trim());
        }

        // Append to file
        try {
            this.init();
            fs.appendFileSync(this.logFile, logLine, 'utf8');
        } catch (err) {
            console.error('Error writing to log file:', err);
        }
    }

    info(message, meta) {
        this.write('info', message, meta);
    }

    warn(message, meta) {
        this.write('warn', message, meta);
    }

    error(message, meta) {
        this.write('error', message, meta);
    }

    debug(message, meta) {
        this.write('debug', message, meta);
    }

    getLogPath() {
        return this.logFile;
    }

    getLogsDir() {
        return this.logsDir;
    }

    getRecentLogs() {
        return [...this.recentEntries];
    }

    readTail(maxBytes = 65536) {
        try {
            if (!fs.existsSync(this.logFile)) {
                return 'Log file is empty or not yet created.';
            }
            const stats = fs.statSync(this.logFile);
            if (stats.size === 0) {
                return 'Log file is empty.';
            }

            const bytesToRead = Math.min(stats.size, maxBytes);
            const buffer = Buffer.alloc(bytesToRead);
            const fd = fs.openSync(this.logFile, 'r');
            fs.readSync(fd, buffer, 0, bytesToRead, stats.size - bytesToRead);
            fs.closeSync(fd);

            return buffer.toString('utf8');
        } catch (err) {
            return `Failed to read log file: ${err.message}`;
        }
    }

    clearLog() {
        try {
            if (fs.existsSync(this.logFile)) {
                fs.writeFileSync(this.logFile, '', 'utf8');
            }
            this.recentEntries = [];
            this.info('DevStation log cleared');
            return true;
        } catch (err) {
            this.error('Failed to clear log', err);
            return false;
        }
    }
}

const logger = new Logger();
module.exports = logger;
