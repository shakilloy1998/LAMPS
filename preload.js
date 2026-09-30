const { contextBridge, ipcRenderer } = require('electron');

/**
 * DevStation Secure Preload Bridge
 * Context Isolation: true
 * Node Integration: false
 */
contextBridge.exposeInMainWorld('devstation', {
    // Apache APIs
    apache: {
        start: () => ipcRenderer.invoke('apache:start'),
        stop: () => ipcRenderer.invoke('apache:stop'),
        restart: () => ipcRenderer.invoke('apache:restart'),
        status: () => ipcRenderer.invoke('apache:status'),
        getVersions: () => ipcRenderer.invoke('apache:get-versions'),
        setVersion: (idOrPath) => ipcRenderer.invoke('apache:set-version', idOrPath),
        setPort: (port, sslPort) => ipcRenderer.invoke('apache:set-port', { port, sslPort }),
        getLogs: (type = 'error', maxBytes) => ipcRenderer.invoke('apache:get-logs', { type, maxBytes }),
        openConfig: () => ipcRenderer.invoke('apache:open-config'),
        openLogsDir: () => ipcRenderer.invoke('apache:open-logs-dir')
    },

    // PHP APIs
    php: {
        getVersions: () => ipcRenderer.invoke('php:get-versions'),
        getActive: () => ipcRenderer.invoke('php:get-active'),
        setVersion: (idOrPath) => ipcRenderer.invoke('php:set-version', idOrPath),
        getExtensions: (exePath) => ipcRenderer.invoke('php:get-extensions', exePath),
        getInfo: (exePath) => ipcRenderer.invoke('php:get-info', exePath),
        addPath: (dirPath) => ipcRenderer.invoke('php:add-path', dirPath),
        removePath: (dirPath) => ipcRenderer.invoke('php:remove-path', dirPath),
        openIni: () => ipcRenderer.invoke('php:open-ini'),
        openDir: () => ipcRenderer.invoke('php:open-dir')
    },

    // MySQL APIs
    mysql: {
        start: () => ipcRenderer.invoke('mysql:start'),
        stop: () => ipcRenderer.invoke('mysql:stop'),
        restart: () => ipcRenderer.invoke('mysql:restart'),
        status: () => ipcRenderer.invoke('mysql:status'),
        getVersions: () => ipcRenderer.invoke('mysql:get-versions'),
        setVersion: (idOrPath) => ipcRenderer.invoke('mysql:set-version', idOrPath),
        setPort: (port) => ipcRenderer.invoke('mysql:set-port', port),
        getLogs: (maxBytes) => ipcRenderer.invoke('mysql:get-logs', maxBytes),
        openConfig: () => ipcRenderer.invoke('mysql:open-config'),
        openDataDir: () => ipcRenderer.invoke('mysql:open-data-dir'),
        launchCli: () => ipcRenderer.invoke('mysql:launch-cli')
    },

    // Service Orchestration
    services: {
        startAll: () => ipcRenderer.invoke('services:start-all'),
        stopAll: () => ipcRenderer.invoke('services:stop-all'),
        restartAll: () => ipcRenderer.invoke('services:restart-all'),
        getAllStatuses: () => ipcRenderer.invoke('services:get-all-statuses'),
        onStatusUpdate: (callback) => {
            const listener = (event, data) => callback(data);
            ipcRenderer.on('services:status-update', listener);
            return () => ipcRenderer.removeListener('services:status-update', listener);
        },
        onActionProgress: (callback) => {
            const listener = (event, data) => callback(data);
            ipcRenderer.on('services:action-progress', listener);
            return () => ipcRenderer.removeListener('services:action-progress', listener);
        }
    },

    // Port Management
    ports: {
        check: (port) => ipcRenderer.invoke('ports:check', port),
        suggest: (port) => ipcRenderer.invoke('ports:suggest', port),
        killPid: (pid) => ipcRenderer.invoke('ports:kill-pid', pid)
    },

    // Package Downloader & Setup
    packages: {
        getCatalog: () => ipcRenderer.invoke('packages:get-catalog'),
        install: (type, packageId) => ipcRenderer.invoke('packages:install', { type, packageId }),
        installDefaultStack: () => ipcRenderer.invoke('packages:install-default-stack'),
        onProgress: (callback) => {
            const listener = (event, data) => callback(data);
            ipcRenderer.on('packages:progress', listener);
            return () => ipcRenderer.removeListener('packages:progress', listener);
        }
    },

    // System Utilities
    system: {
        openDocumentRoot: () => ipcRenderer.invoke('system:open-document-root'),
        openLocalhost: (path = '') => ipcRenderer.invoke('system:open-localhost', path),
        openTerminal: () => ipcRenderer.invoke('system:open-terminal'),
        openPath: (targetPath) => ipcRenderer.invoke('system:open-path', targetPath),
        selectDirectory: (title) => ipcRenderer.invoke('system:select-directory', title),
        getAppInfo: () => ipcRenderer.invoke('system:get-app-info'),
        setStartWithWindows: (enable) => ipcRenderer.invoke('system:set-start-with-windows', enable),
        getStartWithWindows: () => ipcRenderer.invoke('system:get-start-with-windows')
    },

    // Configuration
    config: {
        get: (key) => ipcRenderer.invoke('config:get', key),
        getAll: () => ipcRenderer.invoke('config:get-all'),
        set: (key, value) => ipcRenderer.invoke('config:set', { key, value }),
        update: (partial) => ipcRenderer.invoke('config:update', partial),
        reset: () => ipcRenderer.invoke('config:reset'),
        onConfigChanged: (callback) => {
            const listener = (event, data) => callback(data);
            ipcRenderer.on('config:changed', listener);
            return () => ipcRenderer.removeListener('config:changed', listener);
        }
    },

    // Log Management
    logs: {
        getDevStationLog: (maxBytes) => ipcRenderer.invoke('logs:get-devstation-log', maxBytes),
        clearDevStationLog: () => ipcRenderer.invoke('logs:clear-devstation-log'),
        openLogsDir: () => ipcRenderer.invoke('logs:open-logs-dir')
    }
});
