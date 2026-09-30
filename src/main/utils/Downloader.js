const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { app } = require('electron');
const EventEmitter = require('events');
const logger = require('./Logger');
const configManager = require('../config/ConfigManager');

class Downloader extends EventEmitter {
    constructor() {
        super();
        this.activeDownloads = new Map();
        
        // Default download catalog for official stable Windows binaries
        this.catalog = {
            php: [
                {
                    id: 'php-8.5',
                    name: 'PHP 8.5 (Latest Active)',
                    version: '8.5.11',
                    url: 'https://windows.php.net/downloads/releases/php-8.5.11-Win32-vs17-x64.zip',
                    folderName: 'php-8.5',
                    note: 'PHP 8.6 scheduled for release in late November 2026'
                },
                {
                    id: 'php-8.4',
                    name: 'PHP 8.4 (Stable)',
                    version: '8.4.4',
                    url: 'https://windows.php.net/downloads/releases/php-8.4.4-Win32-vs17-x64.zip',
                    folderName: 'php-8.4'
                },
                {
                    id: 'php-8.3',
                    name: 'PHP 8.3 (Maintenance)',
                    version: '8.3.17',
                    url: 'https://windows.php.net/downloads/releases/php-8.3.17-Win32-vs16-x64.zip',
                    folderName: 'php-8.3'
                },
                {
                    id: 'php-8.2',
                    name: 'PHP 8.2',
                    version: '8.2.28',
                    url: 'https://windows.php.net/downloads/releases/php-8.2.28-Win32-vs16-x64.zip',
                    folderName: 'php-8.2'
                },
                {
                    id: 'php-7.4',
                    name: 'PHP 7.4 (Legacy LTS)',
                    version: '7.4.33',
                    url: 'https://downloads.php.net/~windows/releases/archives/php-7.4.33-Win32-vc15-x64.zip',
                    folderName: 'php-7.4',
                    note: 'Final release of PHP 7.4 (VC15 x64 Thread Safe)'
                },
                {
                    id: 'php-7.3',
                    name: 'PHP 7.3 (Legacy)',
                    version: '7.3.33',
                    url: 'https://downloads.php.net/~windows/releases/archives/php-7.3.33-Win32-VC15-x64.zip',
                    folderName: 'php-7.3',
                    note: 'PHP 7.3.33 (VC15 x64 Thread Safe)'
                },
                {
                    id: 'php-7.2',
                    name: 'PHP 7.2 (Legacy)',
                    version: '7.2.34',
                    url: 'https://downloads.php.net/~windows/releases/archives/php-7.2.34-Win32-VC15-x64.zip',
                    folderName: 'php-7.2',
                    note: 'PHP 7.2.34 (VC15 x64 Thread Safe)'
                },
                {
                    id: 'php-7.1',
                    name: 'PHP 7.1 (Legacy)',
                    version: '7.1.33',
                    url: 'https://downloads.php.net/~windows/releases/archives/php-7.1.33-Win32-VC14-x64.zip',
                    folderName: 'php-7.1',
                    note: 'PHP 7.1.33 (VC14 x64 Thread Safe)'
                },
                {
                    id: 'php-7.0',
                    name: 'PHP 7.0 (Legacy)',
                    version: '7.0.33',
                    url: 'https://downloads.php.net/~windows/releases/archives/php-7.0.33-Win32-VC14-x64.zip',
                    folderName: 'php-7.0',
                    note: 'PHP 7.0.33 (VC14 x64 Thread Safe)'
                }
            ],
            apache: [
                {
                    id: 'apache-2.4.68',
                    name: 'Apache HTTP Server 2.4.68 (Latest)',
                    version: '2.4.68',
                    url: 'https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.68-260920-Win64-VS18.zip',
                    folderName: 'httpd-2.4.68',
                    note: 'Official Win64 VS18 release with latest security patches'
                },
                {
                    id: 'apache-2.4',
                    name: 'Apache HTTP Server 2.4.63',
                    version: '2.4.63',
                    url: 'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.63-250207-win64-VS17.zip',
                    folderName: 'httpd-2.4'
                }
            ],
            mysql: [
                {
                    id: 'mysql-26.7',
                    name: 'MySQL 26.7 (Latest Innovation)',
                    version: '26.7.0',
                    url: 'https://dev.mysql.com/get/Downloads/MySQL-26/mysql-26.7.0-winx64.zip',
                    folderName: 'mysql-26.7',
                    note: 'Latest Calendar-based Innovation release'
                },
                {
                    id: 'mysql-9.7',
                    name: 'MySQL 9.7 LTS (Latest Long-Term Support)',
                    version: '9.7.0',
                    url: 'https://dev.mysql.com/get/Downloads/MySQL-9.7/mysql-9.7.0-winx64.zip',
                    folderName: 'mysql-9.7',
                    note: 'Latest Long-Term Support release'
                },
                {
                    id: 'mariadb-11.4',
                    name: 'MariaDB 11.4 (LTS)',
                    version: '11.4.5',
                    url: 'https://archive.mariadb.org/mariadb-11.4.5/winx64-packages/mariadb-11.4.5-winx64.zip',
                    folderName: 'mariadb-11.4'
                },
                {
                    id: 'mariadb-10.11',
                    name: 'MariaDB 10.11 (LTS)',
                    version: '10.11.11',
                    url: 'https://archive.mariadb.org/mariadb-10.11.11/winx64-packages/mariadb-10.11.11-winx64.zip',
                    folderName: 'mariadb-10.11'
                }
            ]
        };
    }

    getCatalog() {
        return this.catalog;
    }

    /**
     * Check if a directory can be written to without permission errors (EPERM / EACCES).
     */
    isDirWritable(dirPath) {
        if (!dirPath) return false;
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            const testFile = path.join(dirPath, `.write_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.tmp`);
            fs.writeFileSync(testFile, '1');
            fs.unlinkSync(testFile);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the dedicated writable bin directory in LAMPS folder hierarchy.
     * Prevents EPERM on Windows when running from Program Files without elevation.
     */
    getBinDir() {
        const exeDir = path.dirname(process.execPath);
        const lampsRoot = configManager.get('lampsRoot', 'C:\\LAMPS');
        const appData = configManager.getAppDataDir();

        const candidates = [
            path.join(exeDir, 'bin'),
            path.join(lampsRoot, 'bin'),
            path.join(process.cwd(), 'bin'),
            path.join(appData, 'bin')
        ];

        // 1. Check existing directories that are verified to be writable
        for (const c of candidates) {
            if (fs.existsSync(c) && this.isDirWritable(c)) {
                return c;
            }
        }

        // 2. Try creating lampsRoot/bin (e.g. C:\LAMPS\bin)
        const lampsBin = path.join(lampsRoot, 'bin');
        if (this.isDirWritable(lampsBin)) {
            return lampsBin;
        }

        // 3. Fallback to AppData/bin (guaranteed writable by current Windows user)
        const appDataBin = path.join(appData, 'bin');
        if (this.isDirWritable(appDataBin)) {
            return appDataBin;
        }

        return candidates[0];
    }

    /**
     * Download a file via HTTP/HTTPS with redirect following and progress reporting.
     */
    async downloadFile(url, destPath, onProgress) {
        return new Promise((resolve, reject) => {
            const tempFile = destPath + '.tmp';
            const fileStream = fs.createWriteStream(tempFile);

            const handleRequest = (requestUrl, redirectCount = 0) => {
                if (redirectCount > 5) {
                    return reject(new Error('Too many redirects while downloading ' + url));
                }

                const protocol = requestUrl.startsWith('https') ? https : http;
                protocol.get(requestUrl, (response) => {
                    // Follow redirects
                    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                        return handleRequest(response.headers.location, redirectCount + 1);
                    }

                    if (response.statusCode !== 200) {
                        fileStream.close();
                        fs.unlinkSync(tempFile);
                        return reject(new Error(`Download failed with HTTP status ${response.statusCode}`));
                    }

                    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedBytes = 0;
                    let lastTime = Date.now();
                    let lastBytes = 0;
                    let speed = '0 KB/s';

                    response.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        fileStream.write(chunk);

                        const now = Date.now();
                        if (now - lastTime >= 500) {
                            const bytesPerSec = (downloadedBytes - lastBytes) / ((now - lastTime) / 1000);
                            speed = (bytesPerSec > 1048576) 
                                ? `${(bytesPerSec / 1048576).toFixed(1)} MB/s` 
                                : `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
                            lastTime = now;
                            lastBytes = downloadedBytes;

                            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
                            if (onProgress) {
                                onProgress({ downloadedBytes, totalBytes, percent, speed });
                            }
                        }
                    });

                    response.on('end', () => {
                        fileStream.end(() => {
                            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                            fs.renameSync(tempFile, destPath);
                            resolve(destPath);
                        });
                    });

                    response.on('error', (err) => {
                        fileStream.close();
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                        reject(err);
                    });
                }).on('error', (err) => {
                    fileStream.close();
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    reject(err);
                });
            };

            handleRequest(url);
        });
    }

    /**
     * Extract a ZIP archive natively on Windows using tar or Expand-Archive.
     */
    async extractZip(zipPath, targetDir) {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        logger.info(`Extracting ${zipPath} to ${targetDir}...`);

        return new Promise((resolve, reject) => {
            // Use native Windows tar if available (fastest)
            execFile('tar', ['-xf', zipPath, '-C', targetDir], { windowsHide: true }, (err) => {
                if (!err) {
                    logger.info(`Successfully extracted ${zipPath} via tar.`);
                    return resolve(targetDir);
                }

                // Fallback to PowerShell Expand-Archive
                const psCmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`;
                execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true }, (psErr) => {
                    if (psErr) {
                        logger.error('Extraction failed:', psErr);
                        return reject(psErr);
                    }
                    logger.info(`Successfully extracted ${zipPath} via Expand-Archive.`);
                    resolve(targetDir);
                });
            });
        });
    }

    /**
     * Download and install a package into LAMPS's own bin directory.
     */
    async installPackage(type, packageId, onProgress) {
        const catList = this.catalog[type];
        if (!catList) throw new Error(`Unknown service type: ${type}`);

        const pkg = catList.find(p => p.id === packageId) || catList[0];
        if (!pkg) throw new Error(`Package ${packageId} not found in catalog.`);

        let binDir = this.getBinDir();
        let targetDir = path.join(binDir, type, pkg.folderName);

        // Pre-create and ensure target directory is writable before downloading
        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
        } catch (mkErr) {
            if (mkErr.code === 'EPERM' || mkErr.code === 'EACCES') {
                logger.warn(`Permission denied for ${targetDir}, falling back to writable bin directory...`);
                const lampsBin = path.join(configManager.get('lampsRoot', 'C:\\LAMPS'), 'bin');
                const appDataBin = path.join(configManager.getAppDataDir(), 'bin');
                const fallbackBin = this.isDirWritable(lampsBin) ? lampsBin : appDataBin;
                binDir = fallbackBin;
                targetDir = path.join(binDir, type, pkg.folderName);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
            } else {
                throw mkErr;
            }
        }

        const tempZip = path.join(app ? app.getPath('temp') : process.env.TEMP, `${pkg.folderName}-${Date.now()}.zip`);

        logger.info(`Starting download for [${type}]: ${pkg.name} from ${pkg.url}`);
        this.emit('progress', { type, packageId, status: 'downloading', percent: 0 });

        try {
            await this.downloadFile(pkg.url, tempZip, (progress) => {
                this.emit('progress', { type, packageId, status: 'downloading', ...progress });
                if (onProgress) onProgress({ status: 'downloading', ...progress });
            });

            this.emit('progress', { type, packageId, status: 'extracting', percent: 100 });
            if (onProgress) onProgress({ status: 'extracting', percent: 100 });

            await this.extractZip(tempZip, targetDir);

            // Clean up zip
            try { if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip); } catch {}

            // Post-extract normalization
            await this._postExtractConfigure(type, targetDir);

            this.emit('progress', { type, packageId, status: 'completed', targetDir });
            logger.info(`Package [${type}] ${pkg.name} successfully installed at: ${targetDir}`);

            return { success: true, targetDir, package: pkg };
        } catch (err) {
            logger.error(`Failed to install package ${pkg.name}:`, err);
            try { if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip); } catch {}
            throw err;
        }
    }

    /**
     * Flatten single subfolder if archive was packed with a wrapper folder
     */
    _flattenIfSingleSubfolder(installDir) {
        try {
            const items = fs.readdirSync(installDir);
            if (items.length === 1) {
                const singlePath = path.join(installDir, items[0]);
                if (fs.statSync(singlePath).isDirectory()) {
                    const subItems = fs.readdirSync(singlePath);
                    for (const item of subItems) {
                        const src = path.join(singlePath, item);
                        const dst = path.join(installDir, item);
                        if (!fs.existsSync(dst)) fs.renameSync(src, dst);
                    }
                    try { fs.rmdirSync(singlePath); } catch {}
                }
            }
        } catch (e) {
            logger.warn('Folder flattening warning: ' + e.message);
        }
    }

    /**
     * Post extraction setup to ensure the downloaded package is ready to run immediately.
     */
    async _postExtractConfigure(type, installDir) {
        try {
            this._flattenIfSingleSubfolder(installDir);

            if (type === 'apache') {
                // Ensure SRVROOT in httpd.conf
                const confPath = path.join(installDir, 'conf', 'httpd.conf');
                if (fs.existsSync(confPath)) {
                    let conf = fs.readFileSync(confPath, 'utf8');
                    const normalizedPath = installDir.replace(/\\/g, '/');
                    conf = conf.replace(/^[ \t]*Define[ \t]+SRVROOT[ \t]+.*$/m, `Define SRVROOT "${normalizedPath}"`);
                    // Ensure DocumentRoot default
                    conf = conf.replace(/^[ \t]*DocumentRoot[ \t]+.*$/m, `DocumentRoot "\${SRVROOT}/htdocs"`);
                    conf = conf.replace(/^[ \t]*<Directory[ \t]+"[^"]*htdocs[^"]*">/m, `<Directory "\${SRVROOT}/htdocs">`);
                    fs.writeFileSync(confPath, conf, 'utf8');
                }
                const htdocs = path.join(installDir, 'htdocs');
                if (!fs.existsSync(htdocs)) {
                    fs.mkdirSync(htdocs, { recursive: true });
                }
            } else if (type === 'php') {
                // Ensure php.ini exists
                const iniPath = path.join(installDir, 'php.ini');
                const iniDev = path.join(installDir, 'php.ini-development');
                const iniProd = path.join(installDir, 'php.ini-production');
                if (!fs.existsSync(iniPath)) {
                    if (fs.existsSync(iniDev)) fs.copyFileSync(iniDev, iniPath);
                    else if (fs.existsSync(iniProd)) fs.copyFileSync(iniProd, iniPath);
                }

                if (fs.existsSync(iniPath)) {
                    try {
                        const phpManager = require('../services/PHPManager');
                        phpManager.preparePhpIni(iniPath, installDir);
                    } catch (iniErr) {
                        logger.warn('Failed to auto-configure downloaded php.ini: ' + iniErr.message);
                    }
                }
            } else if (type === 'mysql') {
                const dataDir = path.join(installDir, 'data');
                const normData = dataDir.replace(/\\/g, '/');

                // Create my.ini if not present
                const myIniPath = path.join(installDir, 'my.ini');
                if (!fs.existsSync(myIniPath)) {
                    const defaultMyIni = `[mysqld]
port=3306
datadir="${normData}"
default_storage_engine=InnoDB
max_allowed_packet=64M
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

[client]
port=3306
default-character-set=utf8mb4

[mysql]
default-character-set=utf8mb4
`;
                    fs.writeFileSync(myIniPath, defaultMyIni, 'utf8');
                }

                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                    // Run mysql_install_db or mysqld --initialize-insecure
                    const installDb = path.join(installDir, 'bin', 'mysql_install_db.exe');
                    const mysqld = path.join(installDir, 'bin', 'mysqld.exe');
                    if (fs.existsSync(installDb)) {
                        await new Promise((r) => execFile(installDb, [`--datadir=${dataDir}`], { windowsHide: true }, () => r()));
                    } else if (fs.existsSync(mysqld)) {
                        await new Promise((r) => execFile(mysqld, ['--initialize-insecure', `--datadir=${dataDir}`, '--console'], { windowsHide: true }, () => r()));
                    }
                }
            }
        } catch (err) {
            logger.warn(`Post-extract configuration warning for ${type}: ${err.message}`);
        }
    }

    /**
     * Download and install the full default stack (Apache 2.4.68, PHP 8.5, MySQL 26.7)
     */
    async installDefaultStack(onProgress) {
        logger.info('Installing full default LAMPS stack...');
        const steps = [
            { type: 'php', id: 'php-8.5', label: 'PHP 8.5 (Latest)' },
            { type: 'apache', id: 'apache-2.4.68', label: 'Apache 2.4.68' },
            { type: 'mysql', id: 'mysql-26.7', label: 'MySQL 26.7 (Innovation)' }
        ];

        const results = {};
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (onProgress) {
                onProgress({
                    step: i + 1,
                    totalSteps: steps.length,
                    label: step.label,
                    type: step.type,
                    packageId: step.id,
                    status: 'starting'
                });
            }
            results[step.type] = await this.installPackage(step.type, step.id, (prog) => {
                if (onProgress) {
                    onProgress({
                        step: i + 1,
                        totalSteps: steps.length,
                        label: step.label,
                        type: step.type,
                        packageId: step.id,
                        ...prog
                    });
                }
            });
        }
        return results;
    }
}

const downloader = new Downloader();
module.exports = downloader;
