const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const processManager = require('../processes/ProcessManager');
const configManager = require('../config/ConfigManager');
const logger = require('./Logger');

class SystemDetector {
    /**
     * Helper to list subdirectories of a base path.
     */
    _getSubDirs(baseDir) {
        try {
            if (!fs.existsSync(baseDir)) return [];
            return fs.readdirSync(baseDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => path.join(baseDir, dirent.name));
        } catch {
            return [];
        }
    }

    /**
     * Get candidate directories inside LAMPS own folder only.
     * Does NOT scan entire local disk or external software suites.
     */
    _getOwnCandidateDirs(serviceType, customPaths = []) {
        const candidateDirs = new Set();

        // 1. Explicit user-configured custom paths from Settings
        for (const p of customPaths) {
            if (p && typeof p === 'string' && fs.existsSync(p)) {
                candidateDirs.add(path.resolve(p));
            }
        }

        // 2. LAMPS own bin folders:
        const exeDir = path.dirname(process.execPath);
        const sourceDir = path.resolve(__dirname, '..', '..', '..');
        const appDir = (app && app.getAppPath) ? path.dirname(app.getAppPath()) : process.cwd();
        const resourcesDir = process.resourcesPath || '';
        const lampsRoot = configManager.get('lampsRoot', 'C:\\LAMPS');
        const appData = configManager.getAppDataDir();

        const baseRoots = [
            exeDir,
            path.join(exeDir, '..', '..'),
            path.join(exeDir, 'resources'),
            resourcesDir,
            sourceDir,
            process.cwd(),
            appDir,
            lampsRoot,
            appData
        ];

        for (const root of baseRoots) {
            if (!root) continue;
            const targetBase = path.join(root, 'bin', serviceType);
            if (fs.existsSync(targetBase)) {
                candidateDirs.add(path.resolve(targetBase));
                // Add versioned subfolders (e.g. bin/php/php-8.1, bin/php/php-8.4, bin/apache/httpd-2.4)
                for (const sub of this._getSubDirs(targetBase)) {
                    candidateDirs.add(path.resolve(sub));
                }
            }
        }

        return candidateDirs;
    }

    /**
     * Detect Apache installations inside LAMPS own folders.
     */
    async detectApache(customPaths = []) {
        const candidateDirs = this._getOwnCandidateDirs('apache', customPaths);
        const results = [];
        const seenExes = new Set();

        for (const dir of candidateDirs) {
            let exePath = path.join(dir, 'bin', 'httpd.exe');
            let basePath = dir;
            if (!fs.existsSync(exePath)) {
                exePath = path.join(dir, 'httpd.exe');
                if (fs.existsSync(exePath)) {
                    basePath = path.dirname(dir);
                }
            }

            if (!fs.existsSync(exePath) || seenExes.has(exePath.toLowerCase())) {
                continue;
            }
            seenExes.add(exePath.toLowerCase());

            // Run httpd.exe -v
            const res = await processManager.runCommand(exePath, ['-v']);
            let version = '2.4';
            let fullVersion = '';
            if (res.success && res.stdout) {
                fullVersion = res.stdout;
                const match = res.stdout.match(/Apache\/([0-9\.]+)/i);
                if (match) version = match[1];
            }

            // Find config path
            let configPath = path.join(basePath, 'conf', 'httpd.conf');
            if (!fs.existsSync(configPath)) {
                configPath = path.join(path.dirname(exePath), '..', 'conf', 'httpd.conf');
                if (!fs.existsSync(configPath)) {
                    configPath = path.join(dir, 'httpd.conf');
                }
            }

            // Automatically fix SRVROOT in httpd.conf to ensure rock-solid stability
            if (fs.existsSync(configPath)) {
                try {
                    let conf = fs.readFileSync(configPath, 'utf8');
                    const normalizedBase = basePath.replace(/\\/g, '/');
                    if (/Define[ \t]+SRVROOT/i.test(conf)) {
                        conf = conf.replace(/^[ \t]*Define[ \t]+SRVROOT[ \t]+.*$/m, `Define SRVROOT "${normalizedBase}"`);
                        fs.writeFileSync(configPath, conf, 'utf8');
                    }
                } catch (e) {
                    logger.warn('Could not auto-normalize SRVROOT in httpd.conf: ' + e.message);
                }
            }

            // Find logs path
            let logsPath = path.join(basePath, 'logs');
            if (!fs.existsSync(logsPath)) {
                logsPath = path.join(path.dirname(exePath), '..', 'logs');
                if (!fs.existsSync(logsPath)) {
                    try { fs.mkdirSync(logsPath, { recursive: true }); } catch {}
                }
            }

            results.push({
                id: `apache-${version}-${Buffer.from(exePath).toString('hex').substring(0, 6)}`,
                name: `Apache ${version}`,
                version,
                fullVersion,
                basePath: fs.existsSync(configPath) ? path.dirname(path.dirname(configPath)) : basePath,
                exePath,
                configPath: fs.existsSync(configPath) ? configPath : '',
                logsPath: fs.existsSync(logsPath) ? logsPath : ''
            });
        }

        logger.info(`Detected ${results.length} Apache installation(s) in LAMPS bin folders.`);
        return results;
    }

    /**
     * Detect PHP installations inside LAMPS own folders.
     */
    async detectPhp(customPaths = []) {
        const candidateDirs = this._getOwnCandidateDirs('php', customPaths);
        const results = [];
        const seenExes = new Set();

        for (const dir of candidateDirs) {
            const exePath = path.join(dir, 'php.exe');
            if (!fs.existsSync(exePath) || seenExes.has(exePath.toLowerCase())) {
                continue;
            }
            seenExes.add(exePath.toLowerCase());

            // Run php.exe -v
            const res = await processManager.runCommand(exePath, ['-v']);
            let version = 'Unknown';
            let fullVersion = '';
            if (res.success && res.stdout) {
                fullVersion = res.stdout;
                const match = res.stdout.match(/PHP\s+([0-9\.]+[a-zA-Z0-9\-\_]*)/i);
                if (match) version = match[1];
            }

            // Find php.ini
            let iniPath = path.join(dir, 'php.ini');
            if (!fs.existsSync(iniPath)) {
                const iniRes = await processManager.runCommand(exePath, ['--ini']);
                if (iniRes.success && iniRes.stdout) {
                    const iniMatch = iniRes.stdout.match(/Loaded Configuration File:\s*(.+)/i);
                    if (iniMatch && iniMatch[1] && iniMatch[1].trim() !== '(none)') {
                        iniPath = iniMatch[1].trim();
                    }
                }
            }

            // Auto-detect bundled Apache PHP module
            let apacheModule = '';
            try {
                const files = fs.readdirSync(dir);
                for (const f of files) {
                    if (/^php\d+apache2_4\.dll$/i.test(f) || /^php\d+apache2\.dll$/i.test(f)) {
                        apacheModule = path.join(dir, f);
                        break;
                    }
                }
            } catch {}

            results.push({
                id: `php-${version}-${Buffer.from(exePath).toString('hex').substring(0, 6)}`,
                name: `PHP ${version}`,
                version,
                fullVersion,
                basePath: dir,
                exePath,
                iniPath: fs.existsSync(iniPath) ? iniPath : '',
                apacheModule
            });
        }

        logger.info(`Detected ${results.length} PHP installation(s) in LAMPS bin folders.`);
        return results;
    }

    /**
     * Detect MySQL / MariaDB installations inside LAMPS own folders.
     */
    async detectMysql(customPaths = []) {
        const candidateDirs = this._getOwnCandidateDirs('mysql', customPaths);
        const results = [];
        const seenExes = new Set();

        for (const dir of candidateDirs) {
            let exePath = path.join(dir, 'bin', 'mysqld.exe');
            let basePath = dir;
            if (!fs.existsSync(exePath)) {
                exePath = path.join(dir, 'mysqld.exe');
                if (fs.existsSync(exePath)) {
                    basePath = path.dirname(dir);
                }
            }

            if (!fs.existsSync(exePath) || seenExes.has(exePath.toLowerCase())) {
                continue;
            }
            seenExes.add(exePath.toLowerCase());

            // Run mysqld.exe --version
            const res = await processManager.runCommand(exePath, ['--version']);
            let version = 'Unknown';
            let type = 'MySQL';
            let fullVersion = '';

            if (res.success && res.stdout) {
                fullVersion = res.stdout;
                if (/mariadb/i.test(res.stdout)) {
                    type = 'MariaDB';
                    const m = res.stdout.match(/Ver\s+([0-9\.]+-MariaDB[^\s]*)/i) || res.stdout.match(/([0-9\.]+-MariaDB[^\s]*)/i);
                    if (m) version = m[1];
                } else {
                    type = 'MySQL';
                    const m = res.stdout.match(/Ver\s+([0-9\.]+[a-zA-Z0-9\-\_]*)/i);
                    if (m) version = m[1];
                }
            }

            // Find mysql.exe client
            let clientExe = path.join(path.dirname(exePath), 'mysql.exe');
            if (!fs.existsSync(clientExe)) {
                clientExe = path.join(basePath, 'bin', 'mysql.exe');
                if (!fs.existsSync(clientExe)) clientExe = '';
            }

            // Find config (my.ini or my.cnf)
            let configPath = path.join(basePath, 'my.ini');
            if (!fs.existsSync(configPath)) {
                configPath = path.join(basePath, 'my.cnf');
                if (!fs.existsSync(configPath)) {
                    configPath = path.join(path.dirname(exePath), 'my.ini');
                    if (!fs.existsSync(configPath)) configPath = '';
                }
            }

            // Find data directory
            let dataPath = path.join(basePath, 'data');
            if (!fs.existsSync(dataPath)) {
                dataPath = path.join(path.dirname(exePath), '..', 'data');
                if (!fs.existsSync(dataPath)) {
                    try { fs.mkdirSync(dataPath, { recursive: true }); } catch {}
                }
            }

            results.push({
                id: `${type.toLowerCase()}-${version}-${Buffer.from(exePath).toString('hex').substring(0, 6)}`,
                name: `${type} ${version}`,
                type,
                version,
                fullVersion,
                basePath,
                exePath,
                clientExePath: clientExe,
                configPath,
                dataPath
            });
        }

        logger.info(`Detected ${results.length} MySQL/MariaDB installation(s) in LAMPS bin folders.`);
        return results;
    }

    /**
     * Run all detections across own folder.
     */
    async detectAll(customPathsConfig = {}) {
        const apache = await this.detectApache(customPathsConfig.apache || []);
        const php = await this.detectPhp(customPathsConfig.php || []);
        const mysql = await this.detectMysql(customPathsConfig.mysql || []);
        return { apache, php, mysql };
    }
}

const systemDetector = new SystemDetector();
module.exports = systemDetector;
