const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./Logger');

class TerminalLauncher {
    constructor() {
        this.detectedTerminal = null;
    }

    /**
     * Check which terminal is available on this system.
     */
    async detectTerminal() {
        if (this.detectedTerminal) return this.detectedTerminal;

        // Check Windows Terminal (wt.exe)
        const hasWt = await new Promise((resolve) => {
            execFile('where', ['wt.exe'], { windowsHide: true }, (err) => {
                resolve(!err);
            });
        });
        if (hasWt) {
            this.detectedTerminal = 'wt';
            return 'wt';
        }

        // Check PowerShell
        const hasPs = await new Promise((resolve) => {
            execFile('where', ['powershell.exe'], { windowsHide: true }, (err) => {
                resolve(!err);
            });
        });
        if (hasPs) {
            this.detectedTerminal = 'powershell';
            return 'powershell';
        }

        this.detectedTerminal = 'cmd';
        return 'cmd';
    }

    /**
     * Get active dev environment PATH containing PHP, MySQL, and Apache binaries.
     */
    getDevEnvironment() {
        const extraPaths = [];

        // 1. Active PHP
        try {
            const phpService = require('../services/PHPManager');
            const activePhp = phpService.getActiveVersion();
            if (activePhp && activePhp.basePath && fs.existsSync(activePhp.basePath)) {
                extraPaths.push(activePhp.basePath);
            }
        } catch {}

        // 2. Active MySQL
        try {
            const mysqlService = require('../services/MySQLManager');
            const activeMysql = mysqlService.getActiveVersion();
            if (activeMysql && activeMysql.basePath) {
                const mysqlBin = path.join(activeMysql.basePath, 'bin');
                if (fs.existsSync(mysqlBin)) {
                    extraPaths.push(mysqlBin);
                } else if (fs.existsSync(activeMysql.basePath)) {
                    extraPaths.push(activeMysql.basePath);
                }
            }
        } catch {}

        // 3. Active Apache
        try {
            const apacheService = require('../services/ApacheManager');
            const activeApache = apacheService.getActiveVersion();
            if (activeApache && activeApache.basePath) {
                const apacheBin = path.join(activeApache.basePath, 'bin');
                if (fs.existsSync(apacheBin)) {
                    extraPaths.push(apacheBin);
                }
            }
        } catch {}

        const currentParts = (process.env.PATH || '').split(';').filter(Boolean);
        const allPaths = [...extraPaths, ...currentParts];
        const uniquePaths = Array.from(new Set(allPaths));

        const devEnv = { ...process.env, PATH: uniquePaths.join(';') };
        return { devEnv, extraPaths };
    }

    /**
     * Open a terminal at target directory with active PHP and MySQL in PATH.
     */
    async openTerminal(targetDir) {
        const terminal = await this.detectTerminal();
        const dir = (targetDir && fs.existsSync(targetDir)) ? targetDir : process.cwd();
        logger.info(`Opening terminal [${terminal}] in ${dir}`);

        const { devEnv, extraPaths } = this.getDevEnvironment();
        const pathPrefix = extraPaths.join(';');

        try {
            if (terminal === 'wt') {
                spawn('wt.exe', ['-d', dir], { detached: true, stdio: 'ignore', env: devEnv }).unref();
            } else if (terminal === 'powershell') {
                const initScript = pathPrefix 
                    ? `$env:Path = '${pathPrefix.replace(/'/g, "''")};' + $env:Path; Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`
                    : `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`;
                spawn('powershell.exe', ['-NoExit', '-Command', initScript], {
                    detached: true,
                    stdio: 'ignore',
                    env: devEnv
                }).unref();
            } else {
                const cmdScript = pathPrefix
                    ? `set "PATH=${pathPrefix};%PATH%" && cd /d "${dir}"`
                    : `cd /d "${dir}"`;
                spawn('cmd.exe', ['/K', cmdScript], {
                    detached: true,
                    stdio: 'ignore',
                    env: devEnv
                }).unref();
            }
            return { success: true, terminal };
        } catch (err) {
            logger.error('Failed to open terminal:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Launch MySQL CLI in a dedicated terminal window.
     */
    async openMysqlCli(clientExePath, user = 'root', host = '127.0.0.1', port = 3306) {
        if (!clientExePath || !fs.existsSync(clientExePath)) {
            return { success: false, error: 'MySQL CLI executable (mysql.exe) not found.' };
        }

        const terminal = await this.detectTerminal();
        const clientDir = path.dirname(clientExePath);
        const mysqlCmd = `"${clientExePath}" -h ${host} -P ${port} -u ${user} -p`;
        logger.info(`Launching MySQL CLI with ${terminal} at ${clientExePath}`);

        try {
            if (terminal === 'wt') {
                spawn('wt.exe', ['-d', clientDir, 'cmd.exe', '/K', `${mysqlCmd}`], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            } else if (terminal === 'powershell') {
                spawn('powershell.exe', ['-NoExit', '-Command', `& '${clientExePath.replace(/'/g, "''")}' -h ${host} -P ${port} -u ${user} -p`], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            } else {
                spawn('cmd.exe', ['/K', `cd /d "${clientDir}" && ${mysqlCmd}`], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            }
            return { success: true };
        } catch (err) {
            logger.error('Failed to launch MySQL CLI:', err);
            return { success: false, error: err.message };
        }
    }
}

const terminalLauncher = new TerminalLauncher();
module.exports = terminalLauncher;
