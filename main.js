const { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Internal managers
const logger = require('./src/main/utils/Logger');
const configManager = require('./src/main/config/ConfigManager');
const serviceManager = require('./src/main/services/ServiceManager');
const portManager = require('./src/main/ports/PortManager');
const processManager = require('./src/main/processes/ProcessManager');
const terminalLauncher = require('./src/main/utils/TerminalLauncher');
const downloader = require('./src/main/utils/Downloader');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createWindow() {
    const iconPath = path.join(__dirname, 'assets', 'icons', 'icon.png');

    mainWindow = new BrowserWindow({
        width: 980,
        height: 680,
        minWidth: 900,
        minHeight: 600,
        title: 'LAMPS',
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        backgroundColor: '#f3f4f6',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    // Remove default top menu
    mainWindow.setMenuBarVisibility(false);

    // Apply configured theme
    const themeConfig = configManager.get('theme', 'system');
    if (themeConfig === 'light' || themeConfig === 'dark') {
        nativeTheme.themeSource = themeConfig;
    } else {
        nativeTheme.themeSource = 'system';
    }

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        logger.info(`[Renderer] (${level}) ${message} [${path.basename(sourceId || '')}:${line}]`);
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

    // Handle close event (minimize to tray if configured)
    mainWindow.on('close', (event) => {
        if (!isQuitting && configManager.get('minimizeToTray', true)) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Developer mode shortcut: F12
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            mainWindow.webContents.toggleDevTools();
        }
    });
}

function createTray() {
    let trayIcon = null;
    const trayIcoPath = path.join(__dirname, 'assets', 'icons', 'icon.ico');
    const trayPngPath = path.join(__dirname, 'assets', 'icons', 'icon.png');
    if (fs.existsSync(trayIcoPath)) {
        trayIcon = nativeImage.createFromPath(trayIcoPath);
    } else if (fs.existsSync(trayPngPath)) {
        trayIcon = nativeImage.createFromPath(trayPngPath);
    }
    if (!trayIcon || trayIcon.isEmpty()) {
        logger.warn('Tray icon file not found.');
        return;
    }

    try {
        tray = new Tray(trayIcon);
        tray.setToolTip('LAMPS - Development Environment');
    } catch (err) {
        logger.warn('Tray initialization skipped: ' + err.message);
        return;
    }

    const updateTrayMenu = async () => {
        const statuses = await serviceManager.getAllStatuses();
        const apacheRunning = (statuses.apache.status === 'Running');
        const mysqlRunning = (statuses.mysql.status === 'Running');

        const contextMenu = Menu.buildFromTemplate([
            { label: 'LAMPS v1.0.0', enabled: false },
            { type: 'separator' },
            {
                label: 'Start All Services',
                click: async () => {
                    await serviceManager.startAll();
                }
            },
            {
                label: 'Stop All Services',
                click: async () => {
                    await serviceManager.stopAll();
                }
            },
            {
                label: 'Restart All Services',
                click: async () => {
                    await serviceManager.restartAll();
                }
            },
            { type: 'separator' },
            {
                label: `Apache: ${statuses.apache.status}`,
                submenu: [
                    {
                        label: 'Start',
                        enabled: !apacheRunning,
                        click: async () => { await serviceManager.apache.start(); }
                    },
                    {
                        label: 'Stop',
                        enabled: apacheRunning,
                        click: async () => { await serviceManager.apache.stop(); }
                    },
                    {
                        label: 'Restart',
                        click: async () => { await serviceManager.apache.restart(); }
                    }
                ]
            },
            {
                label: `MySQL: ${statuses.mysql.status}`,
                submenu: [
                    {
                        label: 'Start',
                        enabled: !mysqlRunning,
                        click: async () => { await serviceManager.mysql.start(); }
                    },
                    {
                        label: 'Stop',
                        enabled: mysqlRunning,
                        click: async () => { await serviceManager.mysql.stop(); }
                    },
                    {
                        label: 'Restart',
                        click: async () => { await serviceManager.mysql.restart(); }
                    }
                ]
            },
            { type: 'separator' },
            {
                label: 'Open LAMPS',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            {
                label: 'Open Document Root',
                click: () => {
                    const docRoot = configManager.get('documentRoot');
                    if (docRoot && fs.existsSync(docRoot)) {
                        shell.openPath(docRoot);
                    }
                }
            },
            {
                label: 'Open localhost',
                click: () => {
                    const port = serviceManager.apache.getPort() || 80;
                    const url = (port === 80) ? 'http://localhost' : `http://localhost:${port}`;
                    shell.openExternal(url);
                }
            },
            { type: 'separator' },
            {
                label: 'Exit',
                click: async () => {
                    isQuitting = true;
                    await serviceManager.shutdown();
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);
    };

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
            }
        }
    });

    updateTrayMenu();
    // Update tray menu on service events
    serviceManager.on('status-update', () => updateTrayMenu());
}

// Register strict IPC Handlers
function setupIpcHandlers() {
    // --- Apache ---
    ipcMain.handle('apache:start', async () => await serviceManager.apache.start());
    ipcMain.handle('apache:stop', async () => await serviceManager.apache.stop());
    ipcMain.handle('apache:restart', async () => await serviceManager.apache.restart());
    ipcMain.handle('apache:status', async () => await serviceManager.apache.status());
    ipcMain.handle('apache:get-versions', async () => await serviceManager.apache.detect());
    ipcMain.handle('apache:set-version', async (event, idOrPath) => {
        if (typeof idOrPath !== 'string') throw new Error('Invalid version ID');
        return serviceManager.apache.setActiveVersion(idOrPath);
    });
    ipcMain.handle('apache:set-port', async (event, { port, sslPort }) => {
        return await serviceManager.apache.setPort(port, sslPort);
    });
    ipcMain.handle('apache:get-logs', async (event, { type, maxBytes }) => {
        const bytes = (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : 65536;
        if (type === 'access') return serviceManager.apache.getAccessLogs(bytes);
        return serviceManager.apache.getErrorLogs(bytes);
    });
    ipcMain.handle('apache:open-config', async () => {
        const conf = serviceManager.apache.activeInstallation?.configPath;
        if (conf && fs.existsSync(conf)) {
            shell.openPath(conf);
            return { success: true };
        }
        return { success: false, error: 'Apache configuration file not found.' };
    });
    ipcMain.handle('apache:open-logs-dir', async () => {
        const logsDir = serviceManager.apache.activeInstallation?.logsPath;
        if (logsDir && fs.existsSync(logsDir)) {
            shell.openPath(logsDir);
            return { success: true };
        }
        return { success: false, error: 'Apache logs directory not found.' };
    });

    // --- PHP ---
    ipcMain.handle('php:get-versions', async () => await serviceManager.php.detect());
    ipcMain.handle('php:get-active', async () => serviceManager.php.getActiveVersion());
    ipcMain.handle('php:set-version', async (event, idOrPath) => {
        if (typeof idOrPath !== 'string') throw new Error('Invalid PHP version ID');
        return await serviceManager.switchPhpVersion(idOrPath);
    });
    ipcMain.handle('php:get-extensions', async (event, exePath) => {
        return await serviceManager.php.getLoadedExtensions(exePath);
    });
    ipcMain.handle('php:get-info', async (event, exePath) => {
        return await serviceManager.php.getPhpInfo(exePath);
    });
    ipcMain.handle('php:add-path', async (event, dirPath) => {
        if (typeof dirPath !== 'string') throw new Error('Invalid directory path');
        return await serviceManager.php.addCustomPath(dirPath);
    });
    ipcMain.handle('php:remove-path', async (event, dirPath) => {
        if (typeof dirPath !== 'string') throw new Error('Invalid directory path');
        return await serviceManager.php.removeCustomPath(dirPath);
    });
    ipcMain.handle('php:open-ini', async () => {
        const ini = serviceManager.php.activeInstallation?.iniPath;
        if (ini && fs.existsSync(ini)) {
            shell.openPath(ini);
            return { success: true };
        }
        return { success: false, error: 'php.ini not found.' };
    });
    ipcMain.handle('php:open-dir', async () => {
        const dir = serviceManager.php.activeInstallation?.basePath;
        if (dir && fs.existsSync(dir)) {
            shell.openPath(dir);
            return { success: true };
        }
        return { success: false, error: 'PHP directory not found.' };
    });

    // --- MySQL ---
    ipcMain.handle('mysql:start', async () => await serviceManager.mysql.start());
    ipcMain.handle('mysql:stop', async () => await serviceManager.mysql.stop());
    ipcMain.handle('mysql:restart', async () => await serviceManager.mysql.restart());
    ipcMain.handle('mysql:status', async () => await serviceManager.mysql.status());
    ipcMain.handle('mysql:get-versions', async () => await serviceManager.mysql.detect());
    ipcMain.handle('mysql:set-version', async (event, idOrPath) => {
        if (typeof idOrPath !== 'string') throw new Error('Invalid MySQL version ID');
        return serviceManager.mysql.setActiveVersion(idOrPath);
    });
    ipcMain.handle('mysql:set-port', async (event, port) => {
        return await serviceManager.mysql.setPort(port);
    });
    ipcMain.handle('mysql:get-logs', async (event, maxBytes) => {
        const bytes = (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : 65536;
        return serviceManager.mysql.getErrorLogs(bytes);
    });
    ipcMain.handle('mysql:open-config', async () => {
        const conf = serviceManager.mysql.activeInstallation?.configPath;
        if (conf && fs.existsSync(conf)) {
            shell.openPath(conf);
            return { success: true };
        }
        return { success: false, error: 'MySQL configuration file (my.ini) not found.' };
    });
    ipcMain.handle('mysql:open-data-dir', async () => {
        const data = serviceManager.mysql.activeInstallation?.dataPath;
        if (data && fs.existsSync(data)) {
            shell.openPath(data);
            return { success: true };
        }
        return { success: false, error: 'MySQL data directory not found.' };
    });
    ipcMain.handle('mysql:launch-cli', async () => {
        return await serviceManager.mysql.launchCli();
    });

    // --- Services Orchestration ---
    ipcMain.handle('services:start-all', async () => await serviceManager.startAll());
    ipcMain.handle('services:stop-all', async () => await serviceManager.stopAll());
    ipcMain.handle('services:restart-all', async () => await serviceManager.restartAll());
    ipcMain.handle('services:get-all-statuses', async () => await serviceManager.getAllStatuses());

    // --- Ports ---
    ipcMain.handle('ports:check', async (event, port) => await portManager.checkPort(port));
    ipcMain.handle('ports:suggest', async (event, port) => await portManager.suggestAvailablePort(port));
    ipcMain.handle('ports:kill-pid', async (event, pid) => {
        if (!pid || pid <= 0) return { success: false, error: 'Invalid PID' };
        const killed = await processManager.killPid(pid, true);
        return { success: killed };
    });

    // --- Package Downloader & Catalog ---
    ipcMain.handle('packages:get-catalog', () => downloader.getCatalog());
    ipcMain.handle('packages:install', async (event, { type, packageId }) => {
        const result = await downloader.installPackage(type, packageId, (prog) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('packages:progress', { type, packageId, ...prog });
            }
        });
        if (type === 'apache') await serviceManager.apache.detect();
        else if (type === 'php') await serviceManager.php.detect();
        else if (type === 'mysql') await serviceManager.mysql.detect();
        return result;
    });

    ipcMain.handle('packages:install-default-stack', async () => {
        const result = await downloader.installDefaultStack((prog) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('packages:progress', prog);
            }
        });
        await serviceManager.php.detect();
        await serviceManager.apache.detect();
        await serviceManager.mysql.detect();
        return result;
    });

    // --- System & Utilities ---
    ipcMain.handle('system:open-document-root', async () => {
        const docRoot = configManager.get('documentRoot');
        if (docRoot && fs.existsSync(docRoot)) {
            shell.openPath(docRoot);
            return { success: true };
        }
        return { success: false, error: 'Document root path does not exist.' };
    });

    ipcMain.handle('system:open-localhost', async (event, subpath = '') => {
        const port = serviceManager.apache.getPort() || 80;
        let url = (port === 80) ? 'http://localhost' : `http://localhost:${port}`;
        if (subpath) {
            url += (subpath.startsWith('/') ? '' : '/') + subpath;
        }
        shell.openExternal(url);
        return { success: true, url };
    });

    ipcMain.handle('system:open-terminal', async () => {
        const docRoot = configManager.get('documentRoot') || process.cwd();
        return await terminalLauncher.openTerminal(docRoot);
    });

    ipcMain.handle('system:open-path', async (event, targetPath) => {
        if (targetPath && fs.existsSync(targetPath)) {
            shell.openPath(targetPath);
            return { success: true };
        }
        return { success: false, error: 'Path does not exist: ' + targetPath };
    });

    ipcMain.handle('system:select-directory', async (event, title = 'Select Folder') => {
        if (!mainWindow) return null;
        const res = await dialog.showOpenDialog(mainWindow, {
            title,
            properties: ['openDirectory', 'createDirectory']
        });
        if (!res.canceled && res.filePaths.length > 0) {
            return res.filePaths[0];
        }
        return null;
    });

    ipcMain.handle('system:get-app-info', async () => {
        return {
            appName: app.getName(),
            appVersion: app.getVersion(),
            electronVersion: process.versions.electron,
            nodeVersion: process.versions.node,
            chromeVersion: process.versions.chrome,
            platform: process.platform,
            arch: process.arch,
            osRelease: os.release(),
            osType: os.type(),
            appData: configManager.getAppDataDir(),
            configPath: configManager.getConfigPath()
        };
    });

    ipcMain.handle('system:set-start-with-windows', (event, enable) => {
        configManager.set('startWithWindows', !!enable);
        app.setLoginItemSettings({
            openAtLogin: !!enable,
            path: process.execPath
        });
        return { success: true, enabled: !!enable };
    });

    ipcMain.handle('system:get-start-with-windows', () => {
        const settings = app.getLoginItemSettings();
        return settings.openAtLogin;
    });

    // --- Configuration ---
    ipcMain.handle('config:get', (event, key) => configManager.get(key));
    ipcMain.handle('config:get-all', () => configManager.getAll());
    ipcMain.handle('config:set', (event, { key, value }) => {
        configManager.set(key, value);
        if (key === 'theme') {
            nativeTheme.themeSource = (value === 'light' || value === 'dark') ? value : 'system';
        }
        return { success: true };
    });
    ipcMain.handle('config:update', (event, partial) => {
        configManager.update(partial);
        if (partial.theme) {
            nativeTheme.themeSource = (partial.theme === 'light' || partial.theme === 'dark') ? partial.theme : 'system';
        }
        return { success: true };
    });
    ipcMain.handle('config:reset', () => configManager.reset());

    // --- Logs ---
    ipcMain.handle('logs:get-devstation-log', (event, maxBytes) => {
        const bytes = (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : 65536;
        return logger.readTail(bytes);
    });
    ipcMain.handle('logs:clear-devstation-log', () => logger.clearLog());
    ipcMain.handle('logs:open-logs-dir', () => {
        shell.openPath(logger.getLogsDir());
        return { success: true };
    });

    // Forward Service Events to Renderer
    serviceManager.on('status-update', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('services:status-update', data);
        }
    });

    serviceManager.on('action-progress', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('services:action-progress', data);
        }
    });

    configManager.on('changed', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config:changed', data);
        }
    });
}

// App lifecycle
app.whenReady().then(async () => {
    logger.info('LAMPS starting up...');
    setupIpcHandlers();
    createWindow();
    createTray();

    await serviceManager.init();
    logger.info('LAMPS ready.');

    if (process.argv.includes('--test')) {
        logger.info('Test mode active: Verified all systems initialized. Exiting cleanly.');
        setTimeout(async () => {
            isQuitting = true;
            await serviceManager.shutdown();
            app.quit();
        }, 1500);
    }
});

app.on('before-quit', async () => {
    isQuitting = true;
    await serviceManager.shutdown();
});

app.on('window-all-closed', () => {
    if (!configManager.get('minimizeToTray', true)) {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
    }
});
