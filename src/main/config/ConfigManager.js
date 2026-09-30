const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const EventEmitter = require('events');
const logger = require('../utils/Logger');

class ConfigManager extends EventEmitter {
    constructor() {
        super();
        const baseAppData = (app && app.getPath) 
            ? app.getPath('appData') 
            : (process.env.APPDATA || os.homedir());
        
        this.appDataDir = path.join(baseAppData, 'LAMPS');
        this.configPath = path.join(this.appDataDir, 'config.json');

        // Migrate from DevStation if exists
        try {
            const oldDir = path.join(baseAppData, 'DevStation');
            const oldConfig = path.join(oldDir, 'config.json');
            if (!fs.existsSync(this.appDataDir) && fs.existsSync(oldConfig)) {
                fs.mkdirSync(this.appDataDir, { recursive: true });
                fs.copyFileSync(oldConfig, this.configPath);
            }
        } catch {
            // Ignore migration error
        }

        this.defaults = this.getDefaults();
        this.config = null;
        this.init();
    }

    getDefaults() {
        const defaultDocRoot = path.join('C:\\LAMPS', 'www');
        return {
            documentRoot: defaultDocRoot,
            lampsRoot: 'C:\\LAMPS',
            minimizeToTray: true,
            startWithWindows: false,
            autoStartServices: false,
            developerMode: false,
            theme: 'system', // 'system', 'light', 'dark'
            logLevel: 'info',
            apache: {
                activeVersion: '',
                activePath: '',
                port: 80,
                sslPort: 443,
                configPath: '',
                logsPath: '',
                customPaths: []
            },
            php: {
                activeVersion: '',
                activePath: '',
                customPaths: []
            },

            mysql: {
                activeVersion: '',
                activePath: '',
                port: 3306,
                configPath: '',
                dataPath: '',
                customPaths: []
            }
        };
    }

    init() {
        try {
            if (!fs.existsSync(this.appDataDir)) {
                fs.mkdirSync(this.appDataDir, { recursive: true });
            }

            if (!fs.existsSync(this.configPath)) {
                logger.info('No existing configuration found. Creating defaults at ' + this.configPath);
                this.config = JSON.parse(JSON.stringify(this.defaults));
                this.save();
                this.ensureDocumentRoot();
                return;
            }

            const raw = fs.readFileSync(this.configPath, 'utf8');
            try {
                const parsed = JSON.parse(raw);
                this.config = this.validateAndMerge(parsed);
                this.save(); // Save normalized config
            } catch (jsonErr) {
                logger.error('Configuration corrupted! Backing up and restoring defaults.', jsonErr);
                const backupPath = path.join(this.appDataDir, `config.corrupted.${Date.now()}.json`);
                fs.writeFileSync(backupPath, raw, 'utf8');
                this.config = JSON.parse(JSON.stringify(this.defaults));
                this.save();
            }

            this.ensureDocumentRoot();
        } catch (err) {
            logger.error('Failed to initialize ConfigManager:', err);
            this.config = JSON.parse(JSON.stringify(this.defaults));
        }
    }

    ensureDocumentRoot() {
        try {
            if (this.config.documentRoot && !fs.existsSync(this.config.documentRoot)) {
                fs.mkdirSync(this.config.documentRoot, { recursive: true });
                const sampleIndex = path.join(this.config.documentRoot, 'index.html');
                if (!fs.existsSync(sampleIndex)) {
                    fs.writeFileSync(sampleIndex, `<!DOCTYPE html>
<html>
<head>
    <title>DevStation - Local Development</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 40px; background: #f8fafc; color: #1e293b; }
        .card { background: white; border-radius: 8px; border: 1px solid #e2e8f0; padding: 28px; max-width: 600px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        h1 { color: #0284c7; margin-top: 0; font-size: 24px; }
        p { line-height: 1.6; }
        .tag { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 13px; }
    </style>
</head>
<body>
    <div class="card">
        <span class="tag">DevStation</span>
        <h1>It works!</h1>
        <p>Your local web server is running successfully from your DevStation document root:</p>
        <code>${this.config.documentRoot}</code>
        <p>You can replace this file with your own PHP, HTML, or web applications.</p>
    </div>
</body>
</html>`, 'utf8');
                }
            }
        } catch (e) {
            logger.warn('Could not ensure default document root directory:', e.message);
        }
    }

    validateAndMerge(loaded) {
        const merged = JSON.parse(JSON.stringify(this.defaults));
        if (typeof loaded !== 'object' || loaded === null) {
            return merged;
        }

        if (typeof loaded.documentRoot === 'string' && loaded.documentRoot.trim()) {
            merged.documentRoot = loaded.documentRoot.trim();
        }
        if (typeof loaded.devStationRoot === 'string' && loaded.devStationRoot.trim()) {
            merged.devStationRoot = loaded.devStationRoot.trim();
        }
        if (typeof loaded.minimizeToTray === 'boolean') {
            merged.minimizeToTray = loaded.minimizeToTray;
        }
        if (typeof loaded.startWithWindows === 'boolean') {
            merged.startWithWindows = loaded.startWithWindows;
        }
        if (typeof loaded.autoStartServices === 'boolean') {
            merged.autoStartServices = loaded.autoStartServices;
        }
        if (typeof loaded.developerMode === 'boolean') {
            merged.developerMode = loaded.developerMode;
        }
        if (['system', 'light', 'dark'].includes(loaded.theme)) {
            merged.theme = loaded.theme;
        }
        if (typeof loaded.logLevel === 'string') {
            merged.logLevel = loaded.logLevel;
        }

        // Apache validation
        if (loaded.apache && typeof loaded.apache === 'object') {
            if (typeof loaded.apache.activeVersion === 'string') merged.apache.activeVersion = loaded.apache.activeVersion;
            if (typeof loaded.apache.activePath === 'string') merged.apache.activePath = loaded.apache.activePath;
            if (Number.isInteger(loaded.apache.port) && loaded.apache.port > 0 && loaded.apache.port <= 65535) {
                merged.apache.port = loaded.apache.port;
            }
            if (Number.isInteger(loaded.apache.sslPort) && loaded.apache.sslPort > 0 && loaded.apache.sslPort <= 65535) {
                merged.apache.sslPort = loaded.apache.sslPort;
            }
            if (typeof loaded.apache.configPath === 'string') merged.apache.configPath = loaded.apache.configPath;
            if (typeof loaded.apache.logsPath === 'string') merged.apache.logsPath = loaded.apache.logsPath;
            if (Array.isArray(loaded.apache.customPaths)) {
                merged.apache.customPaths = loaded.apache.customPaths.filter(p => typeof p === 'string');
            }
        }

        // PHP validation
        if (loaded.php && typeof loaded.php === 'object') {
            if (typeof loaded.php.activeVersion === 'string') merged.php.activeVersion = loaded.php.activeVersion;
            if (typeof loaded.php.activePath === 'string') merged.php.activePath = loaded.php.activePath;
            if (Array.isArray(loaded.php.customPaths)) {
                merged.php.customPaths = loaded.php.customPaths.filter(p => typeof p === 'string');
            }
        }

        // MySQL validation
        if (loaded.mysql && typeof loaded.mysql === 'object') {
            if (typeof loaded.mysql.activeVersion === 'string') merged.mysql.activeVersion = loaded.mysql.activeVersion;
            if (typeof loaded.mysql.activePath === 'string') merged.mysql.activePath = loaded.mysql.activePath;
            if (Number.isInteger(loaded.mysql.port) && loaded.mysql.port > 0 && loaded.mysql.port <= 65535) {
                merged.mysql.port = loaded.mysql.port;
            }
            if (typeof loaded.mysql.configPath === 'string') merged.mysql.configPath = loaded.mysql.configPath;
            if (typeof loaded.mysql.dataPath === 'string') merged.mysql.dataPath = loaded.mysql.dataPath;
            if (Array.isArray(loaded.mysql.customPaths)) {
                merged.mysql.customPaths = loaded.mysql.customPaths.filter(p => typeof p === 'string');
            }
        }

        return merged;
    }

    getAll() {
        return JSON.parse(JSON.stringify(this.config));
    }

    get(key, defaultValue = null) {
        if (!this.config) return defaultValue;
        const keys = key.split('.');
        let curr = this.config;
        for (const k of keys) {
            if (curr && typeof curr === 'object' && k in curr) {
                curr = curr[k];
            } else {
                return defaultValue;
            }
        }
        return curr;
    }

    set(key, value) {
        if (!this.config) this.config = this.getDefaults();
        const keys = key.split('.');
        let curr = this.config;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in curr) || typeof curr[k] !== 'object' || curr[k] === null) {
                curr[k] = {};
            }
            curr = curr[k];
        }
        curr[keys[keys.length - 1]] = value;
        this.save();
        this.emit('changed', { key, value, config: this.getAll() });
    }

    update(partial) {
        if (!partial || typeof partial !== 'object') return;
        this.config = this.validateAndMerge({ ...this.config, ...partial });
        this.save();
        this.emit('changed', { config: this.getAll() });
    }

    save() {
        try {
            if (!fs.existsSync(this.appDataDir)) {
                fs.mkdirSync(this.appDataDir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 4), 'utf8');
        } catch (err) {
            logger.error('Failed to write config file:', err);
        }
    }

    reset() {
        this.config = JSON.parse(JSON.stringify(this.defaults));
        this.save();
        this.emit('changed', { config: this.getAll() });
        logger.info('Configuration reset to defaults.');
        return this.getAll();
    }

    getConfigPath() {
        return this.configPath;
    }

    getAppDataDir() {
        return this.appDataDir;
    }
}

const configManager = new ConfigManager();
module.exports = configManager;
