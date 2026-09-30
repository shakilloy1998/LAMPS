const fs = require('fs');
const path = require('path');
const BaseService = require('./BaseService');
const systemDetector = require('../utils/SystemDetector');
const processManager = require('../processes/ProcessManager');
const configManager = require('../config/ConfigManager');
const logger = require('../utils/Logger');


class PHPManager extends BaseService {
    constructor() {
        super('php');
        this.installedVersions = [];
        this.activeInstallation = null;
    }

    async init() {
        await this.detect();
        const config = configManager.get('php') || {};

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
            configManager.set('php.activePath', this.activeInstallation.basePath);
            configManager.set('php.activeVersion', this.activeInstallation.version);
        }

        this._prepareConfiguration();
        this.setStatus('Running', { version: this.getVersion() });
    }

    _prepareConfiguration() {
        if (Array.isArray(this.installedVersions)) {
            for (const v of this.installedVersions) {
                if (v && v.iniPath && fs.existsSync(v.iniPath) && v.basePath) {
                    this.preparePhpIni(v.iniPath, v.basePath);
                }
            }
        }
        if (this.activeInstallation && this.activeInstallation.iniPath && fs.existsSync(this.activeInstallation.iniPath)) {
            this.preparePhpIni(this.activeInstallation.iniPath, this.activeInstallation.basePath);
        }
    }

    preparePhpIni(iniPath, basePath) {
        if (!iniPath || !fs.existsSync(iniPath) || !basePath) return;

        try {
            const absBase = path.resolve(basePath);
            const normBase = absBase.replace(/\\/g, '/');
            let conf = fs.readFileSync(iniPath, 'utf8');
            const normExt = `${normBase}/ext`;
            const normTmp = `${normBase}/tmp`;
            if (!fs.existsSync(normTmp)) {
                try { fs.mkdirSync(normTmp, { recursive: true }); } catch {}
            }

            // 1. Align extension_dir strictly with absolute path so CLI/PATH commands never fallback to C:\php\ext
            // Comment out all existing extension_dir lines first
            conf = conf.replace(/^[ \t]*;?[ \t]*extension_dir[ \t]*=.*$/gm, ';extension_dir = "ext"');
            // Then activate extension_dir with the absolute path
            conf = conf.replace(/^[ \t]*;extension_dir[ \t]*=[ \t]*"ext".*$/m, `extension_dir = "${normExt}"`);
            if (!conf.includes(`extension_dir = "${normExt}"`)) {
                conf += `\nextension_dir = "${normExt}"\n`;
            }

            // Align upload_tmp_dir, session.save_path, soap.wsdl_cache_dir with absolute paths
            if (/^[ \t]*;?[ \t]*upload_tmp_dir[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;?[ \t]*upload_tmp_dir[ \t]*=.*$/m, `upload_tmp_dir = "${normTmp}"`);
            } else {
                conf += `\nupload_tmp_dir = "${normTmp}"\n`;
            }

            if (/^[ \t]*;?[ \t]*session\.save_path[ \t]*=[ \t]*(?:"\/tmp"|\/tmp|.*)$/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;?[ \t]*session\.save_path[ \t]*=[ \t]*(?:"\/tmp"|\/tmp|.*)$/m, `session.save_path = "${normTmp}"`);
            } else if (/^[ \t]*session\.save_path[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*session\.save_path[ \t]*=.*$/m, `session.save_path = "${normTmp}"`);
            } else {
                conf += `\nsession.save_path = "${normTmp}"\n`;
            }

            if (/^[ \t]*;?[ \t]*soap\.wsdl_cache_dir[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;?[ \t]*soap\.wsdl_cache_dir[ \t]*=.*$/m, `soap.wsdl_cache_dir = "${normTmp}"`);
            } else {
                conf += `\nsoap.wsdl_cache_dir = "${normTmp}"\n`;
            }

            // 2. SSL certificate bundle if present
            const cert = `${normBase}/curl-ca-bundle.crt`;
            if (fs.existsSync(cert)) {
                if (/^[ \t]*;?[ \t]*curl\.cainfo[ \t]*=/m.test(conf)) {
                    conf = conf.replace(/^[ \t]*;?[ \t]*curl\.cainfo[ \t]*=.*$/m, `curl.cainfo = "${cert}"`);
                } else {
                    conf += `\ncurl.cainfo = "${cert}"\n`;
                }
                if (/^[ \t]*;?[ \t]*openssl\.cafile[ \t]*=/m.test(conf)) {
                    conf = conf.replace(/^[ \t]*;?[ \t]*openssl\.cafile[ \t]*=.*$/m, `openssl.cafile = "${cert}"`);
                } else {
                    conf += `\nopenssl.cafile = "${cert}"\n`;
                }
            }

            // 3. Detect available extensions in the ext directory
            const extDir = path.join(basePath, 'ext');
            const availableFiles = new Set();
            if (fs.existsSync(extDir)) {
                try {
                    const entries = fs.readdirSync(extDir);
                    for (const e of entries) {
                        availableFiles.add(e.toLowerCase());
                    }
                } catch {}
            }

            // Restore documentation example comments so they are not accidentally activated as real directives
            conf = conf.replace(/(; For example:[\s\S]*?)^[ \t]*extension[ \t]*=[ \t]*mysqli[ \t]*$/m, '$1;   extension=mysqli');

            // 4. Essential extensions for Laravel app development, MySQL, and PostgreSQL
            const essentialExts = [
                'curl',
                'fileinfo',
                'gd',
                'intl',
                'mbstring',
                'exif',
                'mysqli',
                'pdo_mysql',
                'pdo_pgsql',
                'pgsql',
                'pdo_sqlite',
                'sqlite3',
                'sockets',
                'sodium',
                'zip',
                'bz2',
                'gmp',
                'soap',
                'bcmath',
                'tidy',
                'xsl'
            ];

            // Only add legacy mysql extension if php_mysql.dll physically exists in ext/ (e.g. PHP 5.6)
            if (availableFiles.has('php_mysql.dll')) {
                essentialExts.push('mysql');
            } else {
                conf = conf.replace(/^[ \t]*extension[ \t]*=[ \t]*(?:php_)?mysql(?:\.dll)?[ \t]*(?:;.*)?$/gm, ';extension=mysql');
            }

            for (const ext of essentialExts) {
                let extNameInIni = ext;
                let dllName = `php_${ext}.dll`;

                // Handle gd / gd2 differences in PHP 7 vs PHP 8
                if (ext === 'gd') {
                    if (availableFiles.has('php_gd.dll')) {
                        extNameInIni = 'gd';
                        dllName = 'php_gd.dll';
                    } else if (availableFiles.has('php_gd2.dll')) {
                        extNameInIni = 'gd2';
                        dllName = 'php_gd2.dll';
                    }
                }

                // If ext/ directory exists, only enable if DLL is present in ext/ (or if it's already explicitly in the ini)
                if (availableFiles.size > 0 && !availableFiles.has(dllName.toLowerCase()) && !availableFiles.has(`php_${extNameInIni}.dll`.toLowerCase())) {
                    const inIni = new RegExp(`^[ \\t]*;?[ \\t]*extension[ \\t]*=[ \\t]*(?:php_)?${extNameInIni}`, 'm').test(conf);
                    if (!inIni) continue;
                }

                // Check if already enabled (uncommented, ignoring indented documentation examples)
                const isEnabled = new RegExp(`^[ \\t]*extension[ \\t]*=[ \\t]*(?:php_)?${extNameInIni}(?:\\.dll)?[ \\t]*(?:;.*)?$`, 'm').test(conf);
                if (isEnabled) {
                    continue;
                }

                // If commented out in extension section, uncomment it (ignoring deeply indented example comments)
                const commentedRegex = new RegExp(`^[ \\t]*;[ \\t]*(?![ \\t]{2,})(extension[ \\t]*=[ \\t]*(?:php_)?${extNameInIni}(?:\\.dll)?(?:[ \\t]*;.*)?)$`, 'm');
                if (commentedRegex.test(conf)) {
                    conf = conf.replace(commentedRegex, '$1');
                } else {
                    conf += `\nextension=${extNameInIni}\n`;
                }
            }

            // Deduplicate extension directives to guarantee zero "already loaded" warnings
            const seenExts = new Set();
            conf = conf.replace(/^[ \t]*extension[ \t]*=[ \t]*([a-zA-Z0-9_\.]+)[ \t]*(;.*)?$/gm, (match, extName) => {
                const key = extName.toLowerCase().replace(/^php_/, '').replace(/\.dll$/, '');
                if (seenExts.has(key)) {
                    return `; (duplicate removed) ${match.trim()}`;
                }
                seenExts.add(key);
                return match;
            });

            // Ensure exif is placed strictly after mbstring (required by Windows PHP)
            if (conf.includes('extension=exif') && conf.includes('extension=mbstring')) {
                const mbstringIdx = conf.indexOf('extension=mbstring');
                const exifIdx = conf.indexOf('extension=exif');
                if (exifIdx < mbstringIdx) {
                    conf = conf.replace(/^[ \t]*extension[ \t]*=[ \t]*exif[ \t]*$/m, '; (repositioned after mbstring)');
                    conf = conf.replace(/(^[ \t]*extension[ \t]*=[ \t]*mbstring[ \t]*$)/m, '$1\nextension=exif');
                }
            }

            // 5. Handle OPcache (prevent duplicate loading while ensuring it is enabled)
            const opcacheDllExists = availableFiles.size === 0 || availableFiles.has('php_opcache.dll');
            if (opcacheDllExists) {
                const zendExtMatches = [...conf.matchAll(/^[ \t]*zend_extension[ \t]*=[ \t]*(?:php_)?opcache(?:\.dll)?/gm)];
                if (zendExtMatches.length > 1) {
                    conf = conf.replace(/^[ \t]*zend_extension[ \t]*=[ \t]*opcache[ \t]*$/m, ';zend_extension=opcache');
                } else if (zendExtMatches.length === 0) {
                    const opcacheCommented = /^[ \t]*;+[ \t]*(zend_extension[ \t]*=[ \t]*(?:php_)?opcache(?:\.dll)?.*)$/m;
                    if (opcacheCommented.test(conf)) {
                        conf = conf.replace(opcacheCommented, '$1');
                    } else {
                        conf += '\nzend_extension=opcache\n';
                    }
                }
            }

            // 6. Optimal configuration directives for Laravel & MySQL development
            const tuneNumericDirective = (name, minMb, defaultStr) => {
                const regex = new RegExp(`^[ \\t]*;?[ \\t]*${name}[ \\t]*=[ \\t]*([0-9]+)([MGKmgk]?)[ \\t]*$`, 'm');
                const match = conf.match(regex);
                if (match) {
                    const num = parseInt(match[1], 10);
                    const unit = (match[2] || '').toUpperCase();
                    let mb = num;
                    if (unit === 'G') mb = num * 1024;
                    if (unit === 'K') mb = Math.round(num / 1024);
                    if (num !== 0 && mb < minMb) {
                        conf = conf.replace(regex, `${name} = ${defaultStr}`);
                    }
                } else if (!new RegExp(`^[ \\t]*${name}[ \\t]*=`, 'm').test(conf)) {
                    conf += `\n${name} = ${defaultStr}\n`;
                }
            };

            tuneNumericDirective('memory_limit', 512, '512M');
            tuneNumericDirective('upload_max_filesize', 128, '128M');
            tuneNumericDirective('post_max_size', 128, '128M');
            tuneNumericDirective('max_execution_time', 300, '300');
            tuneNumericDirective('max_input_vars', 5000, '5000');

            // MySQL & MariaDB directives
            if (/^[ \t]*;?[ \t]*mysqli\.default_port[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;?[ \t]*mysqli\.default_port[ \t]*=.*$/m, 'mysqli.default_port = 3306');
            } else {
                conf += '\nmysqli.default_port = 3306\n';
            }
            if (/^[ \t]*;?[ \t]*mysqli\.default_host[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;?[ \t]*mysqli\.default_host[ \t]*=.*$/m, 'mysqli.default_host = "localhost"');
            } else {
                conf += 'mysqli.default_host = "localhost"\n';
            }
            if (/^[ \t]*;?[ \t]*mysqli\.default_user[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;?[ \t]*mysqli\.default_user[ \t]*=.*$/m, 'mysqli.default_user = "root"');
            } else {
                conf += 'mysqli.default_user = "root"\n';
            }

            if (!/^[ \t]*date\.timezone[ \t]*=/m.test(conf)) {
                conf = conf.replace(/^[ \t]*;+[ \t]*date\.timezone[ \t]*=.*$/m, 'date.timezone = "UTC"');
            }

            fs.writeFileSync(iniPath, conf, 'utf8');
            logger.info(`Prepared & optimized PHP configuration for Laravel & pgsql at ${normBase}`);
        } catch (e) {
            logger.warn('Could not prepare php.ini: ' + e.message);
        }
    }

    async detect() {
        const customPaths = configManager.get('php.customPaths') || [];
        this.installedVersions = await systemDetector.detectPhp(customPaths);

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
            configManager.set('php.activePath', this.activeInstallation.basePath);
            configManager.set('php.activeVersion', this.activeInstallation.version);
        }

        this._prepareConfiguration();
        return this.installedVersions;
    }

    getVersions() {
        return this.installedVersions;
    }

    getActiveVersion() {
        return this.activeInstallation;
    }

    getVersion() {
        return this.activeInstallation ? this.activeInstallation.version : 'Not Detected';
    }

    async addCustomPath(dirPath) {
        if (!dirPath || !fs.existsSync(dirPath)) {
            throw new Error(`Directory does not exist: ${dirPath}`);
        }

        const phpExe = path.join(dirPath, 'php.exe');
        if (!fs.existsSync(phpExe)) {
            throw new Error(`php.exe was not found inside: ${dirPath}`);
        }

        const custom = configManager.get('php.customPaths') || [];
        if (!custom.map(p => p.toLowerCase()).includes(dirPath.toLowerCase())) {
            custom.push(dirPath);
            configManager.set('php.customPaths', custom);
        }

        const detected = await this.detect();
        logger.info(`Added custom PHP directory: ${dirPath}`);
        return detected;
    }

    async removeCustomPath(dirPath) {
        const custom = configManager.get('php.customPaths') || [];
        const filtered = custom.filter(p => p.toLowerCase() !== dirPath.toLowerCase());
        configManager.set('php.customPaths', filtered);
        const detected = await this.detect();
        logger.info(`Removed custom PHP directory: ${dirPath}`);
        return detected;
    }

    async setActiveVersion(idOrPath) {
        const found = this.installedVersions.find(v => 
            v.id === idOrPath || 
            v.basePath.toLowerCase() === idOrPath.toLowerCase() || 
            v.exePath.toLowerCase() === idOrPath.toLowerCase()
        );

        if (!found) {
            throw new Error(`PHP version not found: ${idOrPath}`);
        }

        this.activeInstallation = found;
        this.activeVersion = found;
        configManager.set('php.activePath', found.basePath);
        configManager.set('php.activeVersion', found.version);
        logger.info(`Active PHP version switched to: ${found.name} (${found.basePath})`);

        this._prepareConfiguration();
        this.setStatus('Running', { version: found.version });
        return found;
    }

    async getLoadedExtensions(phpExePath = null) {
        const exe = phpExePath || (this.activeInstallation ? this.activeInstallation.exePath : null);
        if (!exe || !fs.existsSync(exe)) {
            return { success: false, error: 'PHP executable not found.' };
        }

        const res = await processManager.runCommand(exe, ['-m']);
        if (!res.success) {
            return { success: false, error: res.stderr || 'Failed to retrieve PHP extensions.' };
        }

        const lines = res.stdout.split(/\r?\n/);
        const extensions = [];
        let inModules = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('[')) {
                inModules = (trimmed === '[PHP Modules]');
                continue;
            }
            if (inModules) {
                extensions.push(trimmed);
            }
        }

        return { success: true, extensions: extensions.sort() };
    }

    async getPhpInfo(phpExePath = null) {
        const exe = phpExePath || (this.activeInstallation ? this.activeInstallation.exePath : null);
        if (!exe || !fs.existsSync(exe)) {
            return { success: false, error: 'PHP executable not found.' };
        }

        const vRes = await processManager.runCommand(exe, ['-v']);
        const iniRes = await processManager.runCommand(exe, ['--ini']);

        return {
            success: true,
            versionOutput: vRes.stdout,
            iniOutput: iniRes.stdout
        };
    }

}

const phpManager = new PHPManager();
module.exports = phpManager;
