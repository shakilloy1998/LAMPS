const fs = require('fs');
const path = require('path');
const BaseService = require('./BaseService');
const processManager = require('../processes/ProcessManager');
const portManager = require('../ports/PortManager');
const systemDetector = require('../utils/SystemDetector');
const configManager = require('../config/ConfigManager');
const terminalLauncher = require('../utils/TerminalLauncher');
const logger = require('../utils/Logger');

class MySQLManager extends BaseService {
    constructor() {
        super('mysql');
        this.installedVersions = [];
        this.activeInstallation = null;
        this.currentPort = 3306;
    }

    async init() {
        const config = configManager.get('mysql') || {};
        this.currentPort = config.port || 3306;
        await this.detect();

        if (config.activePath) {
            const found = this.installedVersions.find(v => v.basePath.toLowerCase() === config.activePath.toLowerCase());
            if (found) {
                this.activeInstallation = found;
                this.activeVersion = found;
            }
        }

        if (!this.activeInstallation && this.installedVersions.length > 0) {
            this.activeInstallation = this.installedVersions[0];
            this.activeVersion = this.installedVersions[0];
            configManager.set('mysql.activePath', this.activeInstallation.basePath);
            configManager.set('mysql.activeVersion', this.activeInstallation.version);
        }

        await this.checkStatus();
    }

    async detect() {
        const customPaths = configManager.get('mysql.customPaths') || [];
        this.installedVersions = await systemDetector.detectMysql(customPaths);

        if (this.activeInstallation) {
            const still = this.installedVersions.find(v => v.exePath.toLowerCase() === this.activeInstallation.exePath.toLowerCase());
            if (still) {
                this.activeInstallation = still;
                this.activeVersion = still;
            }
        }

        if (!this.activeInstallation && this.installedVersions.length > 0) {
            this.activeInstallation = this.installedVersions[0];
            this.activeVersion = this.installedVersions[0];
            configManager.set('mysql.activePath', this.activeInstallation.basePath);
            configManager.set('mysql.activeVersion', this.activeInstallation.version);
        }

        return this.installedVersions;
    }

    getPort() {
        return this.currentPort;
    }

    async setPort(newPort) {
        const portNum = parseInt(newPort, 10);
        if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
            throw new Error(`Invalid MySQL port: ${newPort}`);
        }

        this.currentPort = portNum;
        configManager.set('mysql.port', portNum);

        // Update my.ini if present
        if (this.activeInstallation && this.activeInstallation.configPath && fs.existsSync(this.activeInstallation.configPath)) {
            try {
                let ini = fs.readFileSync(this.activeInstallation.configPath, 'utf8');
                ini = ini.replace(/^[ \t]*port[ \t]*=[ \t]*[0-9]+/gm, `port = ${portNum}`);
                fs.writeFileSync(this.activeInstallation.configPath, ini, 'utf8');
                logger.info(`Updated port in MySQL config: ${portNum}`);
            } catch (err) {
                logger.warn(`Could not update MySQL config port: ${err.message}`);
            }
        }

        return { port: this.currentPort };
    }

    setActiveVersion(idOrPath) {
        const found = this.installedVersions.find(v => 
            v.id === idOrPath || 
            v.basePath.toLowerCase() === idOrPath.toLowerCase() || 
            v.exePath.toLowerCase() === idOrPath.toLowerCase()
        );

        if (!found) {
            throw new Error(`MySQL installation not found: ${idOrPath}`);
        }

        this.activeInstallation = found;
        this.activeVersion = found;
        configManager.set('mysql.activePath', found.basePath);
        configManager.set('mysql.activeVersion', found.version);
        logger.info(`Active MySQL set to: ${found.name} (${found.exePath})`);
        return found;
    }

    async addCustomPath(dirPath) {
        if (!dirPath || !fs.existsSync(dirPath)) {
            throw new Error(`Directory does not exist: ${dirPath}`);
        }

        const candidate1 = path.join(dirPath, 'bin', 'mysqld.exe');
        const candidate2 = path.join(dirPath, 'mysqld.exe');
        if (!fs.existsSync(candidate1) && !fs.existsSync(candidate2)) {
            throw new Error(`mysqld.exe was not found inside: ${dirPath}`);
        }

        const custom = configManager.get('mysql.customPaths') || [];
        if (!custom.map(p => p.toLowerCase()).includes(dirPath.toLowerCase())) {
            custom.push(dirPath);
            configManager.set('mysql.customPaths', custom);
        }

        return await this.detect();
    }

    _prepareConfiguration() {
        if (!this.activeInstallation) return;
        try {
            const normBase = this.activeInstallation.basePath.replace(/\\/g, '/');
            const normData = (this.activeInstallation.dataPath && fs.existsSync(this.activeInstallation.dataPath))
                ? this.activeInstallation.dataPath.replace(/\\/g, '/')
                : `${normBase}/data`;

            if (this.activeInstallation.configPath && fs.existsSync(this.activeInstallation.configPath)) {
                let conf = fs.readFileSync(this.activeInstallation.configPath, 'utf8');

                // Align basedir, datadir, and log-error
                conf = conf.replace(/^[ \t]*#?basedir[ \t]*=[ \t]*.*$/m, `basedir="${normBase}"`);
                conf = conf.replace(/^[ \t]*#?datadir[ \t]*=[ \t]*.*$/m, `datadir="${normData}"`);
                conf = conf.replace(/^[ \t]*#?log-error[ \t]*=[ \t]*.*$/m, `log-error="${normData}/mysqld.log"`);

                // Align port in all sections
                conf = conf.replace(/^[ \t]*port[ \t]*=[ \t]*[0-9]+/gm, `port = ${this.currentPort}`);

                fs.writeFileSync(this.activeInstallation.configPath, conf, 'utf8');
                logger.info(`Prepared MySQL configuration for ${normBase} (port: ${this.currentPort})`);
            }

            // Also check data/my.ini if it exists
            const dataMyIni = path.join(normData, 'my.ini');
            if (fs.existsSync(dataMyIni)) {
                let dConf = fs.readFileSync(dataMyIni, 'utf8');
                dConf = dConf.replace(/^[ \t]*datadir[ \t]*=[ \t]*.*$/m, `datadir=${normData}`);
                dConf = dConf.replace(/^[ \t]*plugin-dir[ \t]*=[ \t]*.*$/m, `plugin-dir=${normBase}/lib/plugin`);
                fs.writeFileSync(dataMyIni, dConf, 'utf8');
            }
        } catch (e) {
            logger.warn('Could not prepare MySQL configuration: ' + e.message);
        }
    }

    async start() {
        if (this.serviceStatus === 'Running') {
            return { success: true, message: 'MySQL is already running.' };
        }

        if (!this.activeInstallation) {
            await this.detect();
            if (this.installedVersions.length === 0) {
                this.setStatus('Error', { message: 'No MySQL/MariaDB installation detected.' });
                return { success: false, error: 'No MySQL installation detected. Please configure path in Settings.' };
            }
            this.activeInstallation = this.installedVersions[0];
            this.activeVersion = this.installedVersions[0];
        }

        this.setStatus('Starting');

        // Check port
        const portCheck = await portManager.checkPort(this.currentPort);
        if (portCheck.inUse) {
            this.setStatus('Port Conflict', { port: this.currentPort, pid: portCheck.pid, processName: portCheck.processName });
            const msg = `Port ${this.currentPort} is already being used by process "${portCheck.processName}" (PID: ${portCheck.pid}).`;
            logger.error(`[MySQL] ${msg}`);
            return {
                success: false,
                conflict: true,
                port: this.currentPort,
                pid: portCheck.pid,
                processName: portCheck.processName,
                error: msg
            };
        }

        // Align my.ini configuration to active installation paths
        this._prepareConfiguration();

        // Spawn MySQL
        const exe = this.activeInstallation.exePath;
        const cwd = this.activeInstallation.basePath;
        const args = ['--console'];

        if (this.activeInstallation.configPath && fs.existsSync(this.activeInstallation.configPath)) {
            args.unshift(`--defaults-file=${this.activeInstallation.configPath}`);
        } else if (this.activeInstallation.dataPath && fs.existsSync(this.activeInstallation.dataPath)) {
            args.push(`--datadir=${this.activeInstallation.dataPath}`);
            args.push(`--port=${this.currentPort}`);
        }

        const spawnRes = processManager.spawnService('mysql', exe, args, { cwd });
        if (!spawnRes.success) {
            this.setStatus('Error', { message: spawnRes.message });
            return { success: false, error: spawnRes.message };
        }

        this.pid = spawnRes.pid;

        // Check if port gets bound
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 250));
            const isAlive = await processManager.isPidRunning(this.pid);
            if (!isAlive) {
                const logs = this.getErrorLogs(2000);
                this.setStatus('Error', { message: 'MySQL process exited immediately after starting.' });
                this.pid = null;
                return {
                    success: false,
                    error: 'MySQL process exited immediately after starting. Check MySQL logs.',
                    logSnippet: logs
                };
            }

            const check = await portManager.checkPort(this.currentPort);
            if (check.inUse) {
                break;
            }
        }

        this.setStatus('Running', { pid: this.pid, port: this.currentPort });
        logger.info(`MySQL started successfully on port ${this.currentPort} (PID: ${this.pid})`);
        return { success: true, pid: this.pid, port: this.currentPort };
    }

    async stop() {
        if (this.serviceStatus === 'Stopped') {
            return { success: true };
        }

        this.setStatus('Stopping');
        await processManager.stopService('mysql', 6000);

        // Clean up any lingering process belonging to this installation
        if (this.pid) {
            await processManager.killPid(this.pid, true);
        }
        if (this.activeInstallation && this.activeInstallation.basePath) {
            const normBase = this.activeInstallation.basePath.toLowerCase();
            const procs = await processManager.findProcessesByName('mysqld.exe');
            for (const p of procs) {
                if (p.path && p.path.toLowerCase().includes(normBase)) {
                    await processManager.killPid(p.pid, true);
                }
            }
        }

        // Wait for port to actually be released (up to 3 seconds)
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 50));
            const check = await portManager.checkPort(this.currentPort);
            if (!check.inUse) break;
        }

        this.pid = null;
        this.setStatus('Stopped');
        logger.info('MySQL stopped successfully.');
        return { success: true };
    }

    async restart() {
        logger.info('MySQL restart requested.');
        await this.stop();
        // Give OS a moment to release the port
        await new Promise(r => setTimeout(r, 500));
        return await this.start();
    }

    async checkStatus() {
        const trackedPid = processManager.getTrackedPid('mysql');
        if (trackedPid) {
            const isAlive = await processManager.isPidRunning(trackedPid);
            if (isAlive) {
                this.pid = trackedPid;
                this.setStatus('Running', { pid: trackedPid, port: this.currentPort });
                return await this.status();
            }
        }

        const portCheck = await portManager.checkPort(this.currentPort);
        if (portCheck.inUse) {
            if (portCheck.processName && (portCheck.processName.toLowerCase().includes('mysql') || portCheck.processName.toLowerCase().includes('mariadb'))) {
                this.pid = portCheck.pid;
                this.setStatus('Running', { pid: portCheck.pid, port: this.currentPort });
            } else {
                this.setStatus('Port Conflict', { port: this.currentPort, pid: portCheck.pid, processName: portCheck.processName });
            }
        } else {
            this.pid = null;
            if (this.serviceStatus !== 'Starting' && this.serviceStatus !== 'Stopping') {
                this.setStatus('Stopped');
            }
        }

        return await this.status();
    }

    async launchCli() {
        if (!this.activeInstallation || !this.activeInstallation.clientExePath) {
            return { success: false, error: 'mysql.exe client not found.' };
        }
        return await terminalLauncher.openMysqlCli(
            this.activeInstallation.clientExePath,
            'root',
            '127.0.0.1',
            this.currentPort
        );
    }

    getErrorLogs(maxBytes = 65536) {
        if (!this.activeInstallation) return 'MySQL not configured.';

        // Look for .err files in data directory or base directory
        const searchDirs = [this.activeInstallation.dataPath, this.activeInstallation.basePath].filter(Boolean);
        for (const d of searchDirs) {
            if (!fs.existsSync(d)) continue;
            try {
                const files = fs.readdirSync(d);
                const errFiles = files.filter(f => f.endsWith('.err') || f.toLowerCase().includes('mysql.log') || f.toLowerCase().includes('mariadb.log'));
                if (errFiles.length > 0) {
                    const fullPath = path.join(d, errFiles[0]);
                    return this._readFileTail(fullPath, maxBytes);
                }
            } catch {
                // Ignore
            }
        }

        return 'No MySQL error log file found.';
    }

    _readFileTail(filePath, maxBytes) {
        try {
            const stats = fs.statSync(filePath);
            if (stats.size === 0) return 'Log file is empty.';
            const bytesToRead = Math.min(stats.size, maxBytes);
            const buffer = Buffer.alloc(bytesToRead);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, bytesToRead, stats.size - bytesToRead);
            fs.closeSync(fd);
            return buffer.toString('utf8');
        } catch (err) {
            return `Failed to read log file: ${err.message}`;
        }
    }
}

const mysqlManager = new MySQLManager();
module.exports = mysqlManager;
