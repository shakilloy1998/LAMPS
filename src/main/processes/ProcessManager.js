const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const logger = require('../utils/Logger');

class ProcessManager extends EventEmitter {
    constructor() {
        super();
        this.trackedProcesses = new Map(); // serviceName -> childProcess
    }

    /**
     * Check if an executable exists and is a file.
     */
    isValidExecutable(exePath) {
        if (!exePath || typeof exePath !== 'string') return false;
        try {
            const stats = fs.statSync(exePath);
            return stats.isFile();
        } catch {
            return false;
        }
    }

    /**
     * Safely execute a binary and return stdout/stderr.
     */
    async runCommand(exePath, args = [], options = {}) {
        return new Promise((resolve) => {
            if (!this.isValidExecutable(exePath)) {
                return resolve({
                    success: false,
                    code: -1,
                    stdout: '',
                    stderr: `Executable does not exist: ${exePath}`
                });
            }

            const timeout = options.timeout || 10000;
            const proc = execFile(exePath, args, {
                windowsHide: true,
                timeout,
                cwd: options.cwd || path.dirname(exePath),
                env: { ...process.env, ...(options.env || {}) }
            }, (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        success: false,
                        code: error.code || -1,
                        stdout: (stdout || '').trim(),
                        stderr: (stderr || error.message).trim()
                    });
                } else {
                    resolve({
                        success: true,
                        code: 0,
                        stdout: (stdout || '').trim(),
                        stderr: (stderr || '').trim()
                    });
                }
            });
        });
    }

    /**
     * Start a long-running background service process safely.
     */
    spawnService(serviceName, exePath, args = [], options = {}) {
        if (this.trackedProcesses.has(serviceName)) {
            const existing = this.trackedProcesses.get(serviceName);
            if (existing && !existing.killed) {
                logger.warn(`Service ${serviceName} is already tracked with PID ${existing.pid}`);
                return { success: false, pid: existing.pid, message: `${serviceName} is already running` };
            }
        }

        if (!this.isValidExecutable(exePath)) {
            const err = `Executable not found: ${exePath}`;
            logger.error(`[${serviceName}] ${err}`);
            return { success: false, message: err };
        }

        const cwd = options.cwd || path.dirname(exePath);
        logger.info(`Spawning service [${serviceName}]: ${exePath} in ${cwd}`);

        try {
            const child = spawn(exePath, args, {
                cwd,
                windowsHide: true,
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...(options.env || {}) }
            });

            const pid = child.pid;
            this.trackedProcesses.set(serviceName, child);

            child.stdout.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) logger.info(`[${serviceName}:out] ${text}`);
                this.emit('stdout', { serviceName, pid, data: text });
            });

            child.stderr.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) logger.warn(`[${serviceName}:err] ${text}`);
                this.emit('stderr', { serviceName, pid, data: text });
            });

            child.on('error', (err) => {
                logger.error(`[${serviceName}] Process error:`, err);
                this.trackedProcesses.delete(serviceName);
                this.emit('exit', { serviceName, pid, code: -1, error: err.message });
            });

            child.on('exit', (code, signal) => {
                logger.info(`[${serviceName}] Process exited with code ${code}, signal ${signal}`);
                this.trackedProcesses.delete(serviceName);
                this.emit('exit', { serviceName, pid, code, signal });
            });

            return { success: true, pid };
        } catch (err) {
            logger.error(`[${serviceName}] Failed to spawn process:`, err);
            return { success: false, message: err.message };
        }
    }

    /**
     * Stop a tracked service process.
     */
    async stopService(serviceName, timeoutMs = 5000) {
        const child = this.trackedProcesses.get(serviceName);
        if (!child) {
            return { success: true, message: 'Service was not tracked or already stopped' };
        }

        const pid = child.pid;
        logger.info(`Stopping service [${serviceName}] (PID: ${pid})`);

        return new Promise((resolve) => {
            let resolved = false;

            const timer = setTimeout(async () => {
                if (!resolved) {
                    resolved = true;
                    logger.warn(`Graceful stop timed out for [${serviceName}] (PID: ${pid}). Force killing...`);
                    await this.killPid(pid, true);
                    this.trackedProcesses.delete(serviceName);
                    resolve({ success: true, forced: true });
                }
            }, timeoutMs);

            child.once('exit', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    this.trackedProcesses.delete(serviceName);
                    resolve({ success: true, forced: false });
                }
            });

            try {
                // Try graceful termination on Windows
                child.kill('SIGINT');
            } catch (e) {
                logger.warn(`Could not send SIGINT to PID ${pid}:`, e.message);
                this.killPid(pid, true).then(() => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        this.trackedProcesses.delete(serviceName);
                        resolve({ success: true, forced: true });
                    }
                });
            }
        });
    }

    /**
     * Force kill a PID on Windows.
     */
    async killPid(pid, force = true) {
        if (!pid || pid <= 0) return false;
        return new Promise((resolve) => {
            const args = ['/PID', String(pid), '/T'];
            if (force) args.push('/F');

            execFile('taskkill', args, { windowsHide: true }, (err) => {
                if (err) {
                    logger.warn(`taskkill failed for PID ${pid}: ${err.message}`);
                    resolve(false);
                } else {
                    logger.info(`Successfully killed process PID ${pid}`);
                    resolve(true);
                }
            });
        });
    }

    /**
     * Check if a specific PID is currently running.
     */
    async isPidRunning(pid) {
        if (!pid || pid <= 0) return false;
        return new Promise((resolve) => {
            execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
                if (err || !stdout) return resolve(false);
                // If PID found, output contains the PID
                const line = stdout.trim();
                if (line && line.includes(String(pid)) && !line.toLowerCase().includes('no tasks')) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    }

    /**
     * Find all running processes matching image name (e.g. 'httpd.exe', 'mysqld.exe')
     * Returns array of { pid, name, memory }
     */
    async findProcessesByName(exeName) {
        return new Promise((resolve) => {
            execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                const lines = stdout.split(/\r?\n/).filter(l => l.trim().length > 0);
                const results = [];
                for (const line of lines) {
                    if (line.toLowerCase().includes('no tasks')) continue;
                    // Format: "imagename.exe","pid","session name","session#","mem usage"
                    const parts = line.split('","').map(p => p.replace(/"/g, '').trim());
                    if (parts.length >= 2) {
                        const name = parts[0];
                        const pid = parseInt(parts[1], 10);
                        const mem = parts[4] || '';
                        if (!isNaN(pid)) {
                            results.push({ name, pid, mem });
                        }
                    }
                }
                resolve(results);
            });
        });
    }

    getTrackedPid(serviceName) {
        const child = this.trackedProcesses.get(serviceName);
        return (child && !child.killed) ? child.pid : null;
    }
}

const processManager = new ProcessManager();
module.exports = processManager;
