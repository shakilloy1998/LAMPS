const fs = require('fs');
const path = require('path');
const BaseService = require('./BaseService');
const processManager = require('../processes/ProcessManager');
const portManager = require('../ports/PortManager');
const systemDetector = require('../utils/SystemDetector');
const configManager = require('../config/ConfigManager');
const logger = require('../utils/Logger');

class ApacheManager extends BaseService {
    constructor() {
        super('apache');
        this.installedVersions = [];
        this.activeInstallation = null;
        this.currentPort = 80;
        this.currentSslPort = 443;
    }

    async init() {
        const config = configManager.get('apache') || {};
        this.currentPort = config.port || 80;
        this.currentSslPort = config.sslPort || 443;
        await this.detect();

        // Restore selected active version if saved
        if (config.activePath) {
            const found = this.installedVersions.find(v => v.basePath.toLowerCase() === config.activePath.toLowerCase());
            if (found) {
                this.activeInstallation = found;
                this.activeVersion = found;
            }
        }

        // If no active version yet and we detected some, pick the first
        if (!this.activeInstallation && this.installedVersions.length > 0) {
            this.activeInstallation = this.installedVersions[0];
            this.activeVersion = this.installedVersions[0];
            configManager.set('apache.activePath', this.activeInstallation.basePath);
            configManager.set('apache.activeVersion', this.activeInstallation.version);
        }

        await this.checkStatus();
    }

    async detect() {
        const customPaths = configManager.get('apache.customPaths') || [];
        this.installedVersions = await systemDetector.detectApache(customPaths);
        if (this.activeInstallation) {
            const stillExists = this.installedVersions.find(v => v.exePath.toLowerCase() === this.activeInstallation.exePath.toLowerCase());
            if (stillExists) {
                this.activeInstallation = stillExists;
                this.activeVersion = stillExists;
            }
        }
        if (!this.activeInstallation && this.installedVersions.length > 0) {
            this.activeInstallation = this.installedVersions[0];
            this.activeVersion = this.installedVersions[0];
            configManager.set('apache.activePath', this.activeInstallation.basePath);
            configManager.set('apache.activeVersion', this.activeInstallation.version);
        }
        return this.installedVersions;
    }

    setActiveVersion(idOrPath) {
        const found = this.installedVersions.find(v => v.id === idOrPath || v.basePath.toLowerCase() === idOrPath.toLowerCase() || v.exePath.toLowerCase() === idOrPath.toLowerCase());
        if (!found) {
            throw new Error(`Apache installation not found: ${idOrPath}`);
        }
        this.activeInstallation = found;
        this.activeVersion = found;
        configManager.set('apache.activePath', found.basePath);
        configManager.set('apache.activeVersion', found.version);
        logger.info(`Active Apache set to: ${found.name} (${found.exePath})`);
        return found;
    }

    getPort() {
        return this.currentPort;
    }

    getSslPort() {
        return this.currentSslPort;
    }

    async setPort(newPort, newSslPort = null) {
        const portNum = parseInt(newPort, 10);
        if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
            throw new Error(`Invalid port: ${newPort}`);
        }

        this.currentPort = portNum;
        configManager.set('apache.port', portNum);

        if (newSslPort) {
            const sslNum = parseInt(newSslPort, 10);
            if (!isNaN(sslNum) && sslNum > 0 && sslNum <= 65535) {
                this.currentSslPort = sslNum;
                configManager.set('apache.sslPort', sslNum);
            }
        }

        // Apply to httpd.conf if active installation has a config file
        if (this.activeInstallation && this.activeInstallation.configPath && fs.existsSync(this.activeInstallation.configPath)) {
            try {
                let confContent = fs.readFileSync(this.activeInstallation.configPath, 'utf8');
                // Replace Listen \d+
                confContent = confContent.replace(/^[ \t]*Listen[ \t]+([0-9\.]+:)?[0-9]+/m, `Listen ${portNum}`);
                // Replace ServerName localhost:\d+
                confContent = confContent.replace(/^[ \t]*ServerName[ \t]+([a-zA-Z0-9\.\-]+):[0-9]+/m, `ServerName localhost:${portNum}`);
                fs.writeFileSync(this.activeInstallation.configPath, confContent, 'utf8');
                logger.info(`Updated Apache port in httpd.conf to ${portNum}`);
            } catch (err) {
                logger.warn(`Could not update httpd.conf port: ${err.message}`);
            }
        }

        return { port: this.currentPort, sslPort: this.currentSslPort };
    }

    async validateConfiguration() {
        if (!this.activeInstallation) {
            return { valid: false, errors: ['No Apache installation configured.'] };
        }
        if (!fs.existsSync(this.activeInstallation.exePath)) {
            return { valid: false, errors: [`httpd.exe not found at: ${this.activeInstallation.exePath}`] };
        }

        const args = ['-t'];
        if (this.activeInstallation.configPath && fs.existsSync(this.activeInstallation.configPath)) {
            args.push('-f', this.activeInstallation.configPath);
        }

        const res = await processManager.runCommand(this.activeInstallation.exePath, args);
        if (!res.success) {
            return {
                valid: false,
                errors: [res.stderr || res.stdout || 'Syntax error in Apache configuration.']
            };
        }
        return { valid: true, errors: [], output: res.stdout || res.stderr };
    }

    _prepareConfiguration() {
        if (!this.activeInstallation || !this.activeInstallation.configPath || !fs.existsSync(this.activeInstallation.configPath)) return;
        try {
            let conf = fs.readFileSync(this.activeInstallation.configPath, 'utf8');
            const normBase = this.activeInstallation.basePath.replace(/\\/g, '/');

            // Align SRVROOT
            if (/Define[ \t]+SRVROOT/i.test(conf)) {
                conf = conf.replace(/^[ \t]*Define[ \t]+SRVROOT[ \t]+.*$/m, `Define SRVROOT "${normBase}"`);
            }
            // Align Port
            conf = conf.replace(/^[ \t]*Listen[ \t]+([0-9\.]+:)?[0-9]+/m, `Listen ${this.currentPort}`);
            conf = conf.replace(/^[ \t]*#?ServerName[ \t]+([a-zA-Z0-9\.\-]+):[0-9]+/m, `ServerName localhost:${this.currentPort}`);

            // Align DocumentRoot
            const configuredDocRoot = configManager.get('documentRoot');
            let docRoot = configuredDocRoot;
            if (!docRoot || !fs.existsSync(docRoot)) {
                const defaultDir = path.join(this.activeInstallation.basePath, 'htdocs');
                if (fs.existsSync(defaultDir)) {
                    docRoot = defaultDir;
                } else if (configuredDocRoot) {
                    try { fs.mkdirSync(configuredDocRoot, { recursive: true }); docRoot = configuredDocRoot; } catch {}
                }
            }

            if (docRoot && fs.existsSync(docRoot)) {
                const normDocRoot = docRoot.replace(/\\/g, '/');
                conf = conf.replace(/^[ \t]*DocumentRoot[ \t]+.*$/m, `DocumentRoot "${normDocRoot}"`);
                conf = conf.replace(/^[ \t]*<Directory[ \t]+"[^"]*htdocs[^"]*">/m, `<Directory "${normDocRoot}">`);
            }

            // Configure PHP module if active PHP is set
            try {
                const phpService = require('./PHPManager');
                const activePhp = phpService.getActiveVersion();
                const phpBlockRegex = /(?:# BEGIN LAMPS PHP CONFIGURATION[\s\S]*?# END LAMPS PHP CONFIGURATION|# PHP 8[\s\S]*$)/i;

                if (activePhp && activePhp.basePath && fs.existsSync(activePhp.basePath)) {
                    const normPhpBase = activePhp.basePath.replace(/\\/g, '/');
                    let moduleDll = activePhp.apacheModule;
                    if (!moduleDll || !fs.existsSync(moduleDll)) {
                        const candidates = ['php8apache2_4.dll', 'php7apache2_4.dll', 'php8apache2.dll', 'php7apache2.dll'];
                        for (const c of candidates) {
                            const p = path.join(activePhp.basePath, c);
                            if (fs.existsSync(p)) { moduleDll = p; break; }
                        }
                    }
                    let tsDll = '';
                    const tsCandidates = ['php8ts.dll', 'php7ts.dll'];
                    for (const c of tsCandidates) {
                        const p = path.join(activePhp.basePath, c);
                        if (fs.existsSync(p)) { tsDll = p; break; }
                    }

                    if (moduleDll && fs.existsSync(moduleDll)) {
                        const normModule = moduleDll.replace(/\\/g, '/');
                        const normTs = tsDll ? tsDll.replace(/\\/g, '/') : '';
                        let loadFilesDirective = '';
                        if (normTs) loadFilesDirective += `LoadFile "${normTs}"\n`;

                        // If libpq.dll exists in PHP dir, load it so Apache & pgsql/pdo_pgsql never fail
                        const libpqDll = path.join(activePhp.basePath, 'libpq.dll');
                        if (fs.existsSync(libpqDll)) {
                            loadFilesDirective += `LoadFile "${libpqDll.replace(/\\/g, '/')}"\n`;
                        }

                        const modName = (activePhp.version && String(activePhp.version).startsWith('7.')) || path.basename(moduleDll).toLowerCase().startsWith('php7')
                            ? 'php7_module'
                            : 'php_module';

                        const lampsPhpBlock = `# BEGIN LAMPS PHP CONFIGURATION
${loadFilesDirective}LoadModule ${modName} "${normModule}"
PHPIniDir "${normPhpBase}"
<IfModule mime_module>
    AddType application/x-httpd-php .php
</IfModule>
<IfModule dir_module>
    DirectoryIndex index.php index.html
</IfModule>
# END LAMPS PHP CONFIGURATION`;

                        if (phpBlockRegex.test(conf)) {
                            conf = conf.replace(phpBlockRegex, lampsPhpBlock);
                        } else {
                            conf += '\n' + lampsPhpBlock;
                        }
                    }
                } else if (phpBlockRegex.test(conf)) {
                    conf = conf.replace(phpBlockRegex, '# No active PHP configured');
                }
            } catch (phpErr) {
                logger.warn('PHP Apache module configuration warning: ' + phpErr.message);
            }

            fs.writeFileSync(this.activeInstallation.configPath, conf, 'utf8');
        } catch (e) {
            logger.warn('Could not prepare httpd.conf: ' + e.message);
        }
    }

    async start() {
        if (this.serviceStatus === 'Running') {
            return { success: true, message: 'Apache is already running.' };
        }

        if (!this.activeInstallation) {
            await this.detect();
            if (this.installedVersions.length === 0) {
                this.setStatus('Error', { message: 'No Apache installation detected.' });
                return { success: false, error: 'No Apache installation detected. Please configure Apache path in Settings.' };
            }
            this.activeInstallation = this.installedVersions[0];
            this.activeVersion = this.installedVersions[0];
        }

        this.setStatus('Starting');

        // Check port availability
        const portCheck = await portManager.checkPort(this.currentPort);
        if (portCheck.inUse) {
            this.setStatus('Port Conflict', { port: this.currentPort, pid: portCheck.pid, processName: portCheck.processName });
            const msg = `Port ${this.currentPort} is already being used by process "${portCheck.processName}" (PID: ${portCheck.pid}).`;
            logger.error(`[Apache] ${msg}`);
            return {
                success: false,
                conflict: true,
                port: this.currentPort,
                pid: portCheck.pid,
                processName: portCheck.processName,
                error: msg
            };
        }

        // Auto-align configuration (SRVROOT, port, DocumentRoot)
        this._prepareConfiguration();

        // Validate configuration before starting
        const validation = await this.validateConfiguration();
        if (!validation.valid) {
            this.setStatus('Error', { message: validation.errors.join(' ') });
            return { success: false, error: `Apache configuration error: ${validation.errors.join(' ')}` };
        }

        // Spawn Apache
        const exe = this.activeInstallation.exePath;
        const cwd = this.activeInstallation.basePath;
        const args = [];
        if (this.activeInstallation.configPath && fs.existsSync(this.activeInstallation.configPath)) {
            args.push('-f', this.activeInstallation.configPath);
        }

        const env = { ...process.env };
        try {
            const phpService = require('./PHPManager');
            const activePhp = phpService.getActiveVersion();
            if (activePhp && activePhp.basePath) {
                env.PATH = `${activePhp.basePath};${path.join(activePhp.basePath, 'ext')};${process.env.PATH || ''}`;
            }
        } catch {}

        const spawnRes = processManager.spawnService('apache', exe, args, { cwd, env });
        if (!spawnRes.success) {
            this.setStatus('Error', { message: spawnRes.message });
            return { success: false, error: spawnRes.message };
        }

        this.pid = spawnRes.pid;

        // Verify that Apache stays alive and starts listening
        let started = false;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 200));
            // Check if process died
            const isAlive = await processManager.isPidRunning(this.pid);
            if (!isAlive) {
                const logs = this.getErrorLogs(2000);
                this.setStatus('Error', { message: 'Apache process exited immediately after starting.' });
                this.pid = null;
                return {
                    success: false,
                    error: 'Apache process exited immediately after starting. Check Apache error logs.',
                    logSnippet: logs
                };
            }

            // Check if port is now bound
            const check = await portManager.checkPort(this.currentPort);
            if (check.inUse) {
                started = true;
                break;
            }
        }

        if (!started) {
            // Apache process is alive but not yet listening — could be slow start; wait a bit more
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 300));
                const check = await portManager.checkPort(this.currentPort);
                if (check.inUse) { started = true; break; }
                const isAlive = await processManager.isPidRunning(this.pid);
                if (!isAlive) {
                    const logs = this.getErrorLogs(2000);
                    this.setStatus('Error', { message: 'Apache process exited during startup.' });
                    this.pid = null;
                    return { success: false, error: 'Apache failed to bind to port. Check Apache error logs.', logSnippet: logs };
                }
            }
        }

        if (!started) {
            // Still not listening — treat as error
            const logs = this.getErrorLogs(2000);
            try { await processManager.stopService('apache', 2000); } catch {}
            this.pid = null;
            this.setStatus('Error', { message: `Apache did not bind to port ${this.currentPort}.` });
            return { success: false, error: `Apache started but did not listen on port ${this.currentPort}. Check configuration or port conflicts.`, logSnippet: logs };
        }

        this.setStatus('Running', { pid: this.pid, port: this.currentPort });
        logger.info(`Apache started successfully on port ${this.currentPort} (PID: ${this.pid})`);
        return { success: true, pid: this.pid, port: this.currentPort };
    }

    async stop() {
        if (this.serviceStatus === 'Stopped') {
            return { success: true };
        }

        this.setStatus('Stopping');
        await processManager.stopService('apache', 5000);

        // Also kill any rogue httpd.exe workers
        const procs = await processManager.findProcessesByName('httpd.exe');
        for (const p of procs) {
            logger.info(`Cleaning up httpd.exe worker PID ${p.pid}`);
            await processManager.killPid(p.pid, true);
        }

        // Wait for port to actually be released (up to 2 seconds)
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 50));
            const check = await portManager.checkPort(this.currentPort);
            if (!check.inUse) break;
        }

        this.pid = null;
        this.setStatus('Stopped');
        logger.info('Apache stopped successfully.');
        return { success: true };
    }

    async restart() {
        logger.info('Apache restart requested.');
        await this.stop();
        // Give OS a moment to release the port
        await new Promise(r => setTimeout(r, 500));
        return await this.start();
    }

    async checkStatus() {
        const trackedPid = processManager.getTrackedPid('apache');
        if (trackedPid) {
            const isAlive = await processManager.isPidRunning(trackedPid);
            if (isAlive) {
                this.pid = trackedPid;
                this.setStatus('Running', { pid: trackedPid, port: this.currentPort });
                return await this.status();
            }
        }

        // Check if another httpd.exe is running on this port
        const portCheck = await portManager.checkPort(this.currentPort);
        if (portCheck.inUse) {
            if (portCheck.processName && portCheck.processName.toLowerCase().includes('httpd')) {
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

    getErrorLogs(maxBytes = 65536) {
        if (!this.activeInstallation || !this.activeInstallation.logsPath) {
            return 'Logs path not configured.';
        }
        const candidateNames = ['error.log', 'error_log', 'apache_error.log'];
        for (const name of candidateNames) {
            const p = path.join(this.activeInstallation.logsPath, name);
            if (fs.existsSync(p)) {
                return this._readFileTail(p, maxBytes);
            }
        }
        return 'No Apache error log file found in ' + this.activeInstallation.logsPath;
    }

    getAccessLogs(maxBytes = 65536) {
        if (!this.activeInstallation || !this.activeInstallation.logsPath) {
            return 'Logs path not configured.';
        }
        const candidateNames = ['access.log', 'access_log', 'apache_access.log'];
        for (const name of candidateNames) {
            const p = path.join(this.activeInstallation.logsPath, name);
            if (fs.existsSync(p)) {
                return this._readFileTail(p, maxBytes);
            }
        }
        return 'No Apache access log file found in ' + this.activeInstallation.logsPath;
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

const apacheManager = new ApacheManager();
module.exports = apacheManager;
