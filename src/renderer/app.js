/**
 * LAMPS Renderer Application
 * Lightweight, fast, native Windows desktop development environment manager
 */

document.addEventListener('DOMContentLoaded', () => {
    const api = window.devstation;
    if (!api) {
        console.error('LAMPS IPC API is not available.');
        return;
    }

    // State
    const state = {
        config: null,
        appInfo: null,
        apacheVersions: [],
        phpVersions: [],
        mysqlVersions: [],
        statuses: {
            apache: { status: 'Stopped', pid: null, port: 80 },
            mysql: { status: 'Stopped', pid: null, port: 3306 },
            php: { status: 'Running', version: '' }
        },
        currentLogTab: 'apache-error',
        allLoadedExtensions: [],
        activeConflict: null
    };

    // DOM Elements - Header & Toolbar
    const btnHeaderLogs = document.getElementById('btn-header-logs');
    const btnHeaderSettings = document.getElementById('btn-header-settings');
    const btnStartAll = document.getElementById('btn-start-all');
    const btnStopAll = document.getElementById('btn-stop-all');
    const btnRestartAll = document.getElementById('btn-restart-all');
    const btnOpenLocalhost = document.getElementById('btn-open-localhost');
    const btnOpenDocroot = document.getElementById('btn-open-docroot');
    const btnOpenTerminal = document.getElementById('btn-open-terminal');
    const actionBanner = document.getElementById('action-banner');
    const bannerText = document.getElementById('banner-text');

    // DOM Elements - Apache
    const apacheIndicator = document.getElementById('apache-indicator');
    const apacheStatusText = document.getElementById('apache-status-text');
    const apachePortBadge = document.getElementById('apache-port-badge');
    const apacheVersionSelect = document.getElementById('apache-version-select');
    const apachePidText = document.getElementById('apache-pid-text');
    const btnApacheStart = document.getElementById('btn-apache-start');
    const btnApacheStop = document.getElementById('btn-apache-stop');
    const btnApacheRestart = document.getElementById('btn-apache-restart');
    const btnApacheConfig = document.getElementById('btn-apache-config');
    const btnApacheLogs = document.getElementById('btn-apache-logs');
    const btnApacheDir = document.getElementById('btn-apache-dir');

    // DOM Elements - MySQL
    const mysqlIndicator = document.getElementById('mysql-indicator');
    const mysqlStatusText = document.getElementById('mysql-status-text');
    const mysqlPortBadge = document.getElementById('mysql-port-badge');
    const mysqlVersionSelect = document.getElementById('mysql-version-select');
    const mysqlPidText = document.getElementById('mysql-pid-text');
    const btnMysqlStart = document.getElementById('btn-mysql-start');
    const btnMysqlStop = document.getElementById('btn-mysql-stop');
    const btnMysqlRestart = document.getElementById('btn-mysql-restart');
    const btnMysqlCli = document.getElementById('btn-mysql-cli');
    const btnMysqlConfig = document.getElementById('btn-mysql-config');
    const btnMysqlData = document.getElementById('btn-mysql-data');
    const btnMysqlLogs = document.getElementById('btn-mysql-logs');

    // DOM Elements - PHP
    const phpActiveVersionText = document.getElementById('php-active-version-text');
    const phpVersionSelect = document.getElementById('php-version-select');
    const phpIniPathText = document.getElementById('php-ini-path-text');
    const btnPhpExtensions = document.getElementById('btn-php-extensions');
    const btnPhpInfo = document.getElementById('btn-php-info');
    const btnPhpIni = document.getElementById('btn-php-ini');
    const btnPhpDir = document.getElementById('btn-php-dir');

    // DOM Elements - Statusbar
    const sbApacheStatus = document.getElementById('sb-apache-status');
    const sbMysqlStatus = document.getElementById('sb-mysql-status');
    const sbPhpVersion = document.getElementById('sb-php-version');
    const sbDocroot = document.getElementById('sb-docroot');

    // Modals
    const modalSettings = document.getElementById('modal-settings');
    const modalLogs = document.getElementById('modal-logs');
    const modalExtensions = document.getElementById('modal-extensions');
    const modalConflict = document.getElementById('modal-conflict');
    const modalInfo = document.getElementById('modal-info');
    const devModeBox = document.getElementById('dev-mode-box');

    // -------------------------------------------------------------------------
    // Toast Notification System
    // -------------------------------------------------------------------------
    function showToast(message, type = 'info', duration = 3500) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'opacity 0.25s, transform 0.25s';
            setTimeout(() => toast.remove(), 250);
        }, duration);
    }

    function showBanner(text) {
        bannerText.textContent = text;
        actionBanner.classList.remove('hidden');
    }

    function hideBanner() {
        actionBanner.classList.add('hidden');
    }

    // -------------------------------------------------------------------------
    // UI Update Helpers
    // -------------------------------------------------------------------------
    function updateApacheUI(statusData) {
        state.statuses.apache = { ...state.statuses.apache, ...statusData };
        const s = statusData.status || 'Stopped';

        apacheStatusText.textContent = s;
        apacheStatusText.className = 'status-text ' + s.toLowerCase().replace(/\s+/g, '-');
        apacheIndicator.className = 'status-indicator ' + s.toLowerCase().replace(/\s+/g, '-');

        const isRunning = (s === 'Running');
        btnApacheStart.disabled = isRunning;
        btnApacheStop.disabled = !isRunning;
        btnApacheRestart.disabled = !isRunning;

        apachePidText.textContent = statusData.pid ? String(statusData.pid) : '—';
        if (statusData.port) {
            apachePortBadge.textContent = `Port: ${statusData.port}`;
        }

        sbApacheStatus.textContent = isRunning ? `Running (${statusData.port || 80})` : s;
    }

    function updateMysqlUI(statusData) {
        state.statuses.mysql = { ...state.statuses.mysql, ...statusData };
        const s = statusData.status || 'Stopped';

        mysqlStatusText.textContent = s;
        mysqlStatusText.className = 'status-text ' + s.toLowerCase().replace(/\s+/g, '-');
        mysqlIndicator.className = 'status-indicator ' + s.toLowerCase().replace(/\s+/g, '-');

        const isRunning = (s === 'Running');
        btnMysqlStart.disabled = isRunning;
        btnMysqlStop.disabled = !isRunning;
        btnMysqlRestart.disabled = !isRunning;

        mysqlPidText.textContent = statusData.pid ? String(statusData.pid) : '—';
        if (statusData.port) {
            mysqlPortBadge.textContent = `Port: ${statusData.port}`;
        }

        sbMysqlStatus.textContent = isRunning ? `Running (${statusData.port || 3306})` : s;
    }

    function updatePhpUI(php) {
        if (!php) return;
        phpActiveVersionText.textContent = php.name || `PHP ${php.version}`;
        phpIniPathText.textContent = php.iniPath || 'php.ini (default)';
        phpIniPathText.title = php.iniPath || '';
        sbPhpVersion.textContent = php.version || '—';
    }

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------
    async function init() {
        try {
            state.config = await api.config.getAll();
            state.appInfo = await api.system.getAppInfo();

            // Set Document Root display
            if (state.config.documentRoot) {
                sbDocroot.textContent = `Doc: ${state.config.documentRoot}`;
            }

            // Developer mode check
            if (state.config.developerMode) {
                renderDevDiagnostics();
                devModeBox.classList.remove('hidden');
            }

            // Load installed services
            await loadInstalledVersions();

            // Load initial statuses
            const statuses = await api.services.getAllStatuses();
            updateApacheUI(statuses.apache);
            updateMysqlUI(statuses.mysql);
            const activePhp = await api.php.getActive();
            updatePhpUI(activePhp);

            // Listen to live status pushes
            api.services.onStatusUpdate((data) => {
                if (data.service === 'apache') {
                    updateApacheUI(data);
                } else if (data.service === 'mysql') {
                    updateMysqlUI(data);
                }
            });

            // Listen to progress steps
            api.services.onActionProgress((data) => {
                if (data.step === 'done') {
                    hideBanner();
                    showToast(data.message, 'success');
                } else if (data.step === 'error') {
                    hideBanner();
                    showToast(data.message, 'error', 5000);
                } else {
                    showBanner(data.message);
                }
            });

        } catch (err) {
            console.error('Initialization error:', err);
            showToast('Failed to initialize LAMPS: ' + err.message, 'error');
        }
    }

    async function loadInstalledVersions() {
        // Apache
        state.apacheVersions = await api.apache.getVersions();
        apacheVersionSelect.innerHTML = '';
        if (state.apacheVersions.length === 0) {
            apacheVersionSelect.innerHTML = '<option value="">No Apache detected</option>';
        } else {
            for (const v of state.apacheVersions) {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = `${v.name} (${v.basePath})`;
                if (state.config.apache?.activePath && v.basePath.toLowerCase() === state.config.apache.activePath.toLowerCase()) {
                    opt.selected = true;
                }
                apacheVersionSelect.appendChild(opt);
            }
            if (apacheVersionSelect.selectedIndex === -1 && apacheVersionSelect.options.length > 0) {
                apacheVersionSelect.selectedIndex = 0;
            }
        }

        // MySQL
        state.mysqlVersions = await api.mysql.getVersions();
        mysqlVersionSelect.innerHTML = '';
        if (state.mysqlVersions.length === 0) {
            mysqlVersionSelect.innerHTML = '<option value="">No MySQL detected</option>';
        } else {
            for (const v of state.mysqlVersions) {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = `${v.name} (${v.basePath})`;
                if (state.config.mysql?.activePath && v.basePath.toLowerCase() === state.config.mysql.activePath.toLowerCase()) {
                    opt.selected = true;
                }
                mysqlVersionSelect.appendChild(opt);
            }
            if (mysqlVersionSelect.selectedIndex === -1 && mysqlVersionSelect.options.length > 0) {
                mysqlVersionSelect.selectedIndex = 0;
            }
        }

        // PHP
        state.phpVersions = await api.php.getVersions();
        phpVersionSelect.innerHTML = '';
        if (state.phpVersions.length === 0) {
            phpVersionSelect.innerHTML = '<option value="">No PHP detected</option>';
        } else {
            for (const v of state.phpVersions) {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = `${v.name} (${v.basePath})`;
                if (state.config.php?.activePath && v.basePath.toLowerCase() === state.config.php.activePath.toLowerCase()) {
                    opt.selected = true;
                }
                phpVersionSelect.appendChild(opt);
            }
            if (phpVersionSelect.selectedIndex === -1 && phpVersionSelect.options.length > 0) {
                phpVersionSelect.selectedIndex = 0;
            }
        }

        // Show/hide setup banner if stack has missing components
        const setupBanner = document.getElementById('setup-stack-banner');
        if (setupBanner) {
            const isIncomplete = (state.apacheVersions.length === 0 || state.mysqlVersions.length === 0 || state.phpVersions.length === 0);
            if (isIncomplete) {
                setupBanner.classList.remove('hidden');
            } else {
                setupBanner.classList.add('hidden');
            }
        }
    }

    // -------------------------------------------------------------------------
    // Toolbar Actions
    // -------------------------------------------------------------------------
    btnStartAll.addEventListener('click', async () => {
        showBanner('Starting all services...');
        const res = await api.services.startAll();
        if (!res.success) {
            hideBanner();
            if (res.conflict) {
                handlePortConflict(res.failedService, res.conflict);
            } else {
                showToast(`Failed to start: ${res.error}`, 'error');
            }
        }
    });

    btnStopAll.addEventListener('click', async () => {
        showBanner('Stopping all services...');
        await api.services.stopAll();
        hideBanner();
        showToast('All services stopped.', 'info');
    });

    btnRestartAll.addEventListener('click', async () => {
        showBanner('Restarting all services...');
        const res = await api.services.restartAll();
        hideBanner();
        if (res.success) {
            showToast('All services restarted.', 'success');
        } else {
            showToast(`Restart error: ${res.error}`, 'error');
        }
    });

    btnOpenLocalhost.addEventListener('click', async () => {
        await api.system.openLocalhost();
    });

    btnOpenDocroot.addEventListener('click', async () => {
        const res = await api.system.openDocumentRoot();
        if (!res.success) showToast(res.error, 'error');
    });

    btnOpenTerminal.addEventListener('click', async () => {
        const res = await api.system.openTerminal();
        if (!res.success) showToast(res.error, 'error');
    });

    const btnOpenPackages = document.getElementById('btn-open-packages');
    if (btnOpenPackages) {
        btnOpenPackages.addEventListener('click', () => {
            openSettingsModal('tab-packages');
        });
    }

    const btnBannerDownloadStack = document.getElementById('btn-banner-download-stack');
    if (btnBannerDownloadStack) {
        btnBannerDownloadStack.addEventListener('click', async () => {
            await startDefaultStackDownload();
        });
    }

    // -------------------------------------------------------------------------
    // Apache Actions
    // -------------------------------------------------------------------------
    btnApacheStart.addEventListener('click', async () => {
        updateApacheUI({ status: 'Starting' });
        const res = await api.apache.start();
        if (!res.success) {
            if (res.conflict) {
                handlePortConflict('apache', res);
            } else {
                showToast(`Apache start failed: ${res.error}`, 'error');
            }
        } else {
            showToast(`Apache started on port ${res.port}.`, 'success');
        }
    });

    btnApacheStop.addEventListener('click', async () => {
        updateApacheUI({ status: 'Stopping' });
        await api.apache.stop();
        showToast('Apache stopped.', 'info');
    });

    btnApacheRestart.addEventListener('click', async () => {
        updateApacheUI({ status: 'Starting' });
        const res = await api.apache.restart();
        if (res.success) {
            showToast('Apache restarted successfully.', 'success');
        } else {
            showToast(`Apache restart failed: ${res.error}`, 'error');
        }
    });

    apacheVersionSelect.addEventListener('change', async (e) => {
        try {
            const version = await api.apache.setVersion(e.target.value);
            const settingApache = document.getElementById('setting-apache-version');
            if (settingApache) settingApache.value = e.target.value;
            showToast(`Active Apache switched to: ${version.name}`, 'info');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    btnApacheConfig.addEventListener('click', async () => {
        const res = await api.apache.openConfig();
        if (!res.success) showToast(res.error, 'error');
    });

    btnApacheLogs.addEventListener('click', () => {
        openLogsModal('apache-error');
    });

    btnApacheDir.addEventListener('click', async () => {
        const sel = state.apacheVersions.find(v => v.id === apacheVersionSelect.value);
        if (sel && sel.basePath) {
            await api.system.openPath(sel.basePath);
        }
    });

    apachePortBadge.addEventListener('click', () => {
        openSettingsModal('tab-apache');
    });

    // -------------------------------------------------------------------------
    // MySQL Actions
    // -------------------------------------------------------------------------
    btnMysqlStart.addEventListener('click', async () => {
        updateMysqlUI({ status: 'Starting' });
        const res = await api.mysql.start();
        if (!res.success) {
            if (res.conflict) {
                handlePortConflict('mysql', res);
            } else {
                showToast(`MySQL start failed: ${res.error}`, 'error');
            }
        } else {
            showToast(`MySQL started on port ${res.port}.`, 'success');
        }
    });

    btnMysqlStop.addEventListener('click', async () => {
        updateMysqlUI({ status: 'Stopping' });
        await api.mysql.stop();
        showToast('MySQL stopped.', 'info');
    });

    btnMysqlRestart.addEventListener('click', async () => {
        updateMysqlUI({ status: 'Starting' });
        const res = await api.mysql.restart();
        if (res.success) {
            showToast('MySQL restarted successfully.', 'success');
        } else {
            showToast(`MySQL restart failed: ${res.error}`, 'error');
        }
    });

    mysqlVersionSelect.addEventListener('change', async (e) => {
        try {
            const version = await api.mysql.setVersion(e.target.value);
            const settingMysql = document.getElementById('setting-mysql-version');
            if (settingMysql) settingMysql.value = e.target.value;
            showToast(`Active MySQL switched to: ${version.name}`, 'info');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    btnMysqlCli.addEventListener('click', async () => {
        const res = await api.mysql.launchCli();
        if (!res.success) showToast(res.error, 'error');
    });

    btnMysqlConfig.addEventListener('click', async () => {
        const res = await api.mysql.openConfig();
        if (!res.success) showToast(res.error, 'error');
    });

    btnMysqlData.addEventListener('click', async () => {
        const res = await api.mysql.openDataDir();
        if (!res.success) showToast(res.error, 'error');
    });

    btnMysqlLogs.addEventListener('click', () => {
        openLogsModal('mysql-error');
    });

    mysqlPortBadge.addEventListener('click', () => {
        openSettingsModal('tab-mysql');
    });

    // -------------------------------------------------------------------------
    // PHP Actions
    // -------------------------------------------------------------------------
    phpVersionSelect.addEventListener('change', async (e) => {
        const versionId = e.target.value;
        showBanner('Switching PHP version...');
        try {
            const res = await api.php.setVersion(versionId);
            hideBanner();
            if (res.success) {
                updatePhpUI(res.php);
                const settingPhp = document.getElementById('setting-php-version');
                if (settingPhp) settingPhp.value = versionId;
                showToast(`Switched to ${res.php.name}${res.restartedApache ? ' (Apache restarted)' : ''}`, 'success');
            }
        } catch (err) {
            hideBanner();
            showToast(`Failed to switch PHP: ${err.message}`, 'error');
        }
    });

    btnPhpExtensions.addEventListener('click', async () => {
        const res = await api.php.getExtensions();
        if (!res.success) {
            showToast(res.error, 'error');
            return;
        }
        state.allLoadedExtensions = res.extensions || [];
        renderExtensions(state.allLoadedExtensions);
        modalExtensions.classList.remove('hidden');
    });

    btnPhpInfo.addEventListener('click', async () => {
        const res = await api.php.getInfo();
        if (!res.success) {
            showToast(res.error, 'error');
            return;
        }
        openInfoModal('PHP Information (php -v / --ini)', `${res.versionOutput}\n\n${res.iniOutput}`);
    });

    btnPhpIni.addEventListener('click', async () => {
        const res = await api.php.openIni();
        if (!res.success) showToast(res.error, 'error');
    });

    btnPhpDir.addEventListener('click', async () => {
        const res = await api.php.openDir();
        if (!res.success) showToast(res.error, 'error');
    });

    // -------------------------------------------------------------------------
    // Extensions Modal Search
    // -------------------------------------------------------------------------
    const extSearchInput = document.getElementById('ext-search-input');
    const extCountBadge = document.getElementById('ext-count-badge');
    const extensionsGrid = document.getElementById('extensions-grid');

    function renderExtensions(list) {
        extensionsGrid.innerHTML = '';
        extCountBadge.textContent = `${list.length} module${list.length === 1 ? '' : 's'}`;
        for (const ext of list) {
            const item = document.createElement('div');
            item.className = 'ext-badge';
            item.textContent = ext;
            extensionsGrid.appendChild(item);
        }
    }

    extSearchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = state.allLoadedExtensions.filter(x => x.toLowerCase().includes(q));
        renderExtensions(filtered);
    });

    document.getElementById('btn-close-extensions').addEventListener('click', () => modalExtensions.classList.add('hidden'));
    document.getElementById('btn-done-extensions').addEventListener('click', () => modalExtensions.classList.add('hidden'));

    // -------------------------------------------------------------------------
    // Port Conflict Handling
    // -------------------------------------------------------------------------
    async function handlePortConflict(service, info) {
        state.activeConflict = { service, ...info };
        document.getElementById('conflict-port').textContent = info.port;
        document.getElementById('conflict-proc').textContent = info.processName || 'Unknown';
        document.getElementById('conflict-pid').textContent = info.pid || 'Unknown';

        // Suggest alternative port
        const altPort = await api.ports.suggest(info.port);
        state.activeConflict.suggestedPort = altPort;
        document.getElementById('alt-port-num').textContent = altPort;

        modalConflict.classList.remove('hidden');
    }

    document.getElementById('btn-close-conflict').addEventListener('click', () => modalConflict.classList.add('hidden'));
    document.getElementById('btn-cancel-conflict').addEventListener('click', () => modalConflict.classList.add('hidden'));

    document.getElementById('btn-use-alt-port').addEventListener('click', async () => {
        if (!state.activeConflict) return;
        const { service, suggestedPort } = state.activeConflict;
        modalConflict.classList.add('hidden');

        if (service === 'apache') {
            await api.apache.setPort(suggestedPort);
            apachePortBadge.textContent = `Port: ${suggestedPort}`;
            showToast(`Apache port updated to ${suggestedPort}. Starting...`, 'info');
            await api.apache.start();
        } else if (service === 'mysql') {
            await api.mysql.setPort(suggestedPort);
            mysqlPortBadge.textContent = `Port: ${suggestedPort}`;
            showToast(`MySQL port updated to ${suggestedPort}. Starting...`, 'info');
            await api.mysql.start();
        }
    });

    document.getElementById('btn-kill-conflict').addEventListener('click', async () => {
        if (!state.activeConflict || !state.activeConflict.pid) return;
        const pid = state.activeConflict.pid;
        const proc = state.activeConflict.processName;

        const confirm = window.confirm(`Are you sure you want to terminate process "${proc}" (PID: ${pid})?`);
        if (!confirm) return;

        const res = await api.ports.killPid(pid);
        modalConflict.classList.add('hidden');
        if (res.success) {
            showToast(`Process ${pid} terminated. You can now start the service.`, 'success');
        } else {
            showToast(`Could not terminate process ${pid}. Administrator permissions may be required.`, 'error');
        }
    });

    // -------------------------------------------------------------------------
    // Log Viewer Modal
    // -------------------------------------------------------------------------
    const logContentBox = document.getElementById('log-content-box');
    const logFileInfo = document.getElementById('log-file-info');

    async function fetchLogContent(tabKey) {
        logContentBox.textContent = 'Loading log entries...';
        let content = '';

        if (tabKey === 'apache-error') {
            content = await api.apache.getLogs('error', 65536);
            logFileInfo.textContent = 'Apache Error Log (last 64 KB)';
        } else if (tabKey === 'apache-access') {
            content = await api.apache.getLogs('access', 65536);
            logFileInfo.textContent = 'Apache Access Log (last 64 KB)';
        } else if (tabKey === 'mysql-error') {
            content = await api.mysql.getLogs(65536);
            logFileInfo.textContent = 'MySQL/MariaDB Error Log (last 64 KB)';
        } else if (tabKey === 'devstation') {
            content = await api.logs.getDevStationLog(65536);
            logFileInfo.textContent = 'LAMPS Internal System Log';
        }

        logContentBox.textContent = content || 'Log is currently empty.';
        logContentBox.scrollTop = logContentBox.scrollHeight;
    }

    function openLogsModal(tab = 'apache-error') {
        state.currentLogTab = tab;
        document.querySelectorAll('.log-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.log === tab);
        });
        fetchLogContent(tab);
        modalLogs.classList.remove('hidden');
    }

    btnHeaderLogs.addEventListener('click', () => openLogsModal('apache-error'));
    document.getElementById('btn-close-logs').addEventListener('click', () => modalLogs.classList.add('hidden'));
    document.getElementById('btn-done-logs').addEventListener('click', () => modalLogs.classList.add('hidden'));

    document.querySelectorAll('.log-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', (e) => {
            const target = e.target.dataset.log;
            state.currentLogTab = target;
            document.querySelectorAll('.log-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            fetchLogContent(target);
        });
    });

    document.getElementById('btn-refresh-log').addEventListener('click', () => fetchLogContent(state.currentLogTab));
    document.getElementById('btn-copy-log').addEventListener('click', () => {
        navigator.clipboard.writeText(logContentBox.textContent);
        showToast('Log content copied to clipboard.', 'info');
    });
    document.getElementById('btn-clear-log').addEventListener('click', async () => {
        if (state.currentLogTab === 'devstation') {
            await api.logs.clearDevStationLog();
        }
        logContentBox.textContent = 'Log view cleared.';
    });
    document.getElementById('btn-open-log-dir').addEventListener('click', async () => {
        if (state.currentLogTab === 'devstation') {
            await api.logs.openLogsDir();
        } else {
            await api.apache.openLogsDir();
        }
    });

    // -------------------------------------------------------------------------
    // Settings Modal
    // -------------------------------------------------------------------------
    function openSettingsModal(defaultTab = 'tab-general') {
        loadSettingsForm();
        switchSettingsTab(defaultTab);
        modalSettings.classList.remove('hidden');
    }

    function switchSettingsTab(tabId) {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
        if (tabId === 'tab-packages') {
            renderPackagesTab();
        }
    }

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => switchSettingsTab(e.target.dataset.tab));
    });

    btnHeaderSettings.addEventListener('click', () => openSettingsModal('tab-general'));
    document.getElementById('btn-close-settings').addEventListener('click', () => modalSettings.classList.add('hidden'));
    document.getElementById('btn-cancel-settings').addEventListener('click', () => modalSettings.classList.add('hidden'));

    async function loadSettingsForm() {
        const cfg = await api.config.getAll();
        state.config = cfg;

        // General
        document.getElementById('setting-docroot').value = cfg.documentRoot || '';
        document.getElementById('setting-minimize-tray').checked = !!cfg.minimizeToTray;
        document.getElementById('setting-start-with-windows').checked = !!cfg.startWithWindows;
        document.getElementById('setting-autostart-services').checked = !!cfg.autoStartServices;
        document.getElementById('setting-theme').value = cfg.theme || 'system';

        // Apache
        const apacheVerSelect = document.getElementById('setting-apache-version');
        apacheVerSelect.innerHTML = '';
        for (const v of state.apacheVersions) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = `${v.name} (${v.basePath})`;
            if (cfg.apache?.activePath && v.basePath.toLowerCase() === cfg.apache.activePath.toLowerCase()) opt.selected = true;
            apacheVerSelect.appendChild(opt);
        }
        document.getElementById('setting-apache-http-port').value = cfg.apache?.port || 80;
        document.getElementById('setting-apache-ssl-port').value = cfg.apache?.sslPort || 443;
        renderCustomPathsList('list-custom-apache', cfg.apache?.customPaths || [], 'apache');

        // PHP
        const phpVerSelect = document.getElementById('setting-php-version');
        phpVerSelect.innerHTML = '';
        for (const v of state.phpVersions) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = `${v.name} (${v.basePath})`;
            if (cfg.php?.activePath && v.basePath.toLowerCase() === cfg.php.activePath.toLowerCase()) opt.selected = true;
            phpVerSelect.appendChild(opt);
        }

        renderCustomPathsList('list-custom-php', cfg.php?.customPaths || [], 'php');

        // MySQL
        const mysqlVerSelect = document.getElementById('setting-mysql-version');
        mysqlVerSelect.innerHTML = '';
        for (const v of state.mysqlVersions) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = `${v.name} (${v.basePath})`;
            if (cfg.mysql?.activePath && v.basePath.toLowerCase() === cfg.mysql.activePath.toLowerCase()) opt.selected = true;
            mysqlVerSelect.appendChild(opt);
        }
        document.getElementById('setting-mysql-port').value = cfg.mysql?.port || 3306;
        renderCustomPathsList('list-custom-mysql', cfg.mysql?.customPaths || [], 'mysql');

        // Advanced
        document.getElementById('setting-developer-mode').checked = !!cfg.developerMode;
        if (state.appInfo) {
            document.getElementById('setting-config-filepath').textContent = state.appInfo.configPath;
        }

        // Ports tab table
        refreshPortsTable();

        // Packages tab catalog
        renderPackagesTab();
    }

    function renderCustomPathsList(elementId, paths, serviceType) {
        const list = document.getElementById(elementId);
        list.innerHTML = '';
        if (paths.length === 0) {
            list.innerHTML = '<li style="color: var(--text-muted);">No custom paths added</li>';
            return;
        }

        for (const p of paths) {
            const li = document.createElement('li');
            li.innerHTML = `<span>${p}</span><button class="btn-remove-path" data-path="${p}" data-service="${serviceType}">✕</button>`;
            list.appendChild(li);
        }

        list.querySelectorAll('.btn-remove-path').forEach(b => {
            b.addEventListener('click', async (e) => {
                const targetPath = e.target.dataset.path;
                const sType = e.target.dataset.service;
                if (sType === 'php') await api.php.removePath(targetPath);
                await loadInstalledVersions();
                await loadSettingsForm();
                showToast(`Removed path: ${targetPath}`, 'info');
            });
        });
    }

    document.getElementById('btn-browse-docroot').addEventListener('click', async () => {
        const selected = await api.system.selectDirectory('Select Document Root Directory');
        if (selected) {
            document.getElementById('setting-docroot').value = selected;
        }
    });

    document.getElementById('btn-add-custom-php').addEventListener('click', async () => {
        const selected = await api.system.selectDirectory('Select PHP Installation Directory');
        if (selected) {
            try {
                await api.php.addPath(selected);
                await loadInstalledVersions();
                await loadSettingsForm();
                showToast(`Added PHP folder: ${selected}`, 'success');
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    });

    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        try {
            const docRoot = document.getElementById('setting-docroot').value.trim();
            const minimizeToTray = document.getElementById('setting-minimize-tray').checked;
            const startWithWindows = document.getElementById('setting-start-with-windows').checked;
            const autoStartServices = document.getElementById('setting-autostart-services').checked;
            const theme = document.getElementById('setting-theme').value;
            const devMode = document.getElementById('setting-developer-mode').checked;

            const apachePort = parseInt(document.getElementById('setting-apache-http-port').value, 10);
            const apacheSslPort = parseInt(document.getElementById('setting-apache-ssl-port').value, 10);
            const mysqlPort = parseInt(document.getElementById('setting-mysql-port').value, 10);

            const selectedApache = document.getElementById('setting-apache-version').value;
            const selectedPhp = document.getElementById('setting-php-version').value;
            const selectedMysql = document.getElementById('setting-mysql-version').value;

            // Capture current state before any changes
            const apacheWasRunning = state.statuses.apache.status === 'Running';
            const mysqlWasRunning = state.statuses.mysql.status === 'Running';
            const oldApachePort = state.statuses.apache.port || 80;
            const oldMysqlPort = state.statuses.mysql.port || 3306;
            const apachePortChanged = !isNaN(apachePort) && apachePort !== oldApachePort;
            const mysqlPortChanged = !isNaN(mysqlPort) && mysqlPort !== oldMysqlPort;

            // Apply selected versions first so any port updates apply to the chosen version
            if (selectedPhp) {
                const curPhp = await api.php.getActive();
                if (!curPhp || curPhp.id !== selectedPhp || curPhp.basePath !== selectedPhp) {
                    const res = await api.php.setVersion(selectedPhp);
                    phpVersionSelect.value = selectedPhp;
                    if (res && res.php) updatePhpUI(res.php);
                }
            }

            if (selectedApache && apacheVersionSelect.value !== selectedApache) {
                await api.apache.setVersion(selectedApache);
                apacheVersionSelect.value = selectedApache;
            }

            if (selectedMysql && mysqlVersionSelect.value !== selectedMysql) {
                await api.mysql.setVersion(selectedMysql);
                mysqlVersionSelect.value = selectedMysql;
            }

            // Apply start with windows
            await api.system.setStartWithWindows(startWithWindows);

            // Apply ports (writes config files only; restart is handled below)
            if (!isNaN(apachePort)) await api.apache.setPort(apachePort, apacheSslPort);
            if (!isNaN(mysqlPort)) await api.mysql.setPort(mysqlPort);

            // Update main config
            await api.config.update({
                documentRoot: docRoot,
                minimizeToTray,
                startWithWindows,
                autoStartServices,
                theme,
                developerMode: devMode
            });

            // Update theme attribute
            if (theme === 'dark' || theme === 'light') {
                document.documentElement.setAttribute('data-theme', theme);
            } else {
                document.documentElement.removeAttribute('data-theme');
            }

            // Developer mode box
            devModeBox.classList.toggle('hidden', !devMode);
            if (devMode) renderDevDiagnostics();

            // Close modal first so user sees progress banners
            modalSettings.classList.add('hidden');
            showToast('Settings saved.', 'success');
            sbDocroot.textContent = `Doc: ${docRoot}`;

            // Restart services if their port changed and they were running
            const needsApacheRestart = apachePortChanged && apacheWasRunning;
            const needsMysqlRestart = mysqlPortChanged && mysqlWasRunning;

            if (needsMysqlRestart) {
                showBanner(`Restarting MySQL on port ${mysqlPort}...`);
                const res = await api.mysql.restart();
                if (!res || !res.success) {
                    showToast(`MySQL restart failed: ${res?.error || 'Unknown error'}`, 'error');
                } else {
                    showToast(`MySQL restarted on port ${mysqlPort}.`, 'success');
                }
                hideBanner();
            }

            if (needsApacheRestart) {
                showBanner(`Restarting Apache on port ${apachePort}...`);
                const res = await api.apache.restart();
                if (!res || !res.success) {
                    if (res?.conflict) {
                        handlePortConflict('apache', res);
                    } else {
                        showToast(`Apache restart failed: ${res?.error || 'Unknown error'}`, 'error');
                    }
                } else {
                    showToast(`Apache restarted on port ${apachePort}.`, 'success');
                }
                hideBanner();
            }
        } catch (err) {
            showToast(`Failed to save settings: ${err.message}`, 'error');
        }
    });

    async function refreshPortsTable() {
        const tbody = document.getElementById('ports-table-body');
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Scanning ports...</td></tr>';

        const apachePort = state.statuses.apache.port || 80;
        const mysqlPort = state.statuses.mysql.port || 3306;

        const apRes = await api.ports.check(apachePort);
        const myRes = await api.ports.check(mysqlPort);

        tbody.innerHTML = `
            <tr>
                <td><strong>Apache HTTP</strong></td>
                <td>${apachePort}</td>
                <td>${apRes.inUse ? `<span style="color: #d13438;">● In Use (${apRes.processName || 'PID ' + apRes.pid})</span>` : '<span style="color: #107c41;">● Available</span>'}</td>
                <td>${apRes.inUse ? `<button class="btn-win btn-small" onclick="handleKillPid(${apRes.pid})">End Process</button>` : '—'}</td>
            </tr>
            <tr>
                <td><strong>MySQL</strong></td>
                <td>${mysqlPort}</td>
                <td>${myRes.inUse ? `<span style="color: #d13438;">● In Use (${myRes.processName || 'PID ' + myRes.pid})</span>` : '<span style="color: #107c41;">● Available</span>'}</td>
                <td>${myRes.inUse ? `<button class="btn-win btn-small" onclick="handleKillPid(${myRes.pid})">End Process</button>` : '—'}</td>
            </tr>
        `;
    }

    document.getElementById('btn-refresh-ports').addEventListener('click', refreshPortsTable);

    window.handleKillPid = async (pid) => {
        if (!pid) return;
        const conf = confirm(`Terminate PID ${pid}?`);
        if (conf) {
            await api.ports.killPid(pid);
            refreshPortsTable();
        }
    };

    document.getElementById('btn-open-config-folder').addEventListener('click', async () => {
        if (state.appInfo) {
            await api.system.openPath(state.appInfo.appData);
        }
    });

    document.getElementById('btn-reset-config').addEventListener('click', async () => {
        const conf = confirm('Are you sure you want to reset all LAMPS settings to defaults?');
        if (conf) {
            await api.config.reset();
            modalSettings.classList.add('hidden');
            showToast('Settings reset to defaults.', 'info');
            await init();
        }
    });

    // -------------------------------------------------------------------------
    // Packages & Download Manager
    // -------------------------------------------------------------------------
    const modalDownload = document.getElementById('modal-download');
    const downloadPkgTitle = document.getElementById('download-pkg-title');
    const downloadProgressBar = document.getElementById('download-progress-bar');
    const downloadStatusText = document.getElementById('download-status-text');
    const downloadSpeedText = document.getElementById('download-speed-text');

    api.packages.onProgress((data) => {
        if (data.status === 'downloading') {
            const pct = data.percent || 0;
            downloadProgressBar.style.width = pct + '%';
            const stepPrefix = data.totalSteps ? `[${data.step}/${data.totalSteps}] ` : '';
            downloadStatusText.textContent = `${stepPrefix}Downloading ${data.label || ''}... ${pct}%`;
            downloadSpeedText.textContent = data.speed || '';
        } else if (data.status === 'extracting') {
            downloadProgressBar.style.width = '100%';
            const stepPrefix = data.totalSteps ? `[${data.step}/${data.totalSteps}] ` : '';
            downloadStatusText.textContent = `${stepPrefix}Extracting and configuring ${data.label || ''}...`;
            downloadSpeedText.textContent = 'Please wait';
        } else if (data.status === 'completed') {
            downloadStatusText.textContent = 'Package installation complete!';
            downloadSpeedText.textContent = '';
        }
    });

    async function startSinglePackageDownload(type, id) {
        downloadPkgTitle.textContent = `Installing ${type.toUpperCase()}: ${id}`;
        downloadProgressBar.style.width = '0%';
        downloadStatusText.textContent = 'Connecting...';
        downloadSpeedText.textContent = '';
        modalDownload.classList.remove('hidden');

        try {
            await api.packages.install(type, id);
            modalDownload.classList.add('hidden');
            showToast(`Successfully installed ${id}!`, 'success');
            await loadInstalledVersions();
            const statuses = await api.services.getAllStatuses();
            updateApacheUI(statuses.apache);
            updateMysqlUI(statuses.mysql);
            const activePhp = await api.php.getActive();
            updatePhpUI(activePhp);
        } catch (err) {
            modalDownload.classList.add('hidden');
            showToast(`Installation failed: ${err.message}`, 'error');
        }
    }

    async function startDefaultStackDownload() {
        downloadPkgTitle.textContent = 'Setting Up Default Web Stack (Apache 2.4.68 + PHP 8.5 + MySQL 26.7 / 9.7 LTS)';
        downloadProgressBar.style.width = '0%';
        downloadStatusText.textContent = 'Starting download process...';
        downloadSpeedText.textContent = '';
        modalDownload.classList.remove('hidden');

        try {
            await api.packages.installDefaultStack();
            modalDownload.classList.add('hidden');
            showToast('Default web stack successfully installed and ready!', 'success');
            await loadInstalledVersions();
            const statuses = await api.services.getAllStatuses();
            updateApacheUI(statuses.apache);
            updateMysqlUI(statuses.mysql);
            const activePhp = await api.php.getActive();
            updatePhpUI(activePhp);
        } catch (err) {
            modalDownload.classList.add('hidden');
            showToast(`Default stack setup failed: ${err.message}`, 'error');
        }
    }

    async function renderPackagesTab() {
        const container = document.getElementById('packages-list');
        if (!container) return;
        container.innerHTML = '<div style="padding: 12px; color: var(--text-muted);">Loading official package catalog...</div>';

        try {
            const catalog = await api.packages.getCatalog();
            container.innerHTML = '';

            // 1-Click Install Default Stack Card
            const stackHeader = document.createElement('div');
            stackHeader.className = 'package-stack-header';
            stackHeader.innerHTML = `
                <div class="pkg-header-info">
                    <strong>⚡ Install Complete Default Web Stack</strong>
                    <p>Downloads Apache 2.4.68, PHP 8.5, and MySQL 26.7 / 9.7 LTS in one click.</p>
                </div>
                <button id="btn-tab-install-stack" class="btn-win btn-primary">Download All Defaults</button>
            `;
            container.appendChild(stackHeader);

            document.getElementById('btn-tab-install-stack').addEventListener('click', () => {
                modalSettings.classList.add('hidden');
                startDefaultStackDownload();
            });

            const sections = [
                { key: 'php', title: 'PHP Runtimes', icon: '🐘' },
                { key: 'apache', title: 'Apache Web Servers', icon: '🪶' },
                { key: 'mysql', title: 'MariaDB / MySQL Databases', icon: '🐬' }
            ];

            for (const sec of sections) {
                const list = catalog[sec.key] || [];
                const group = document.createElement('div');
                group.className = 'package-group';
                group.innerHTML = `<h4 class="package-group-header">${sec.icon} ${sec.title}</h4>`;

                const grid = document.createElement('div');
                grid.className = 'package-grid';

                for (const pkg of list) {
                    const card = document.createElement('div');
                    card.className = 'package-card';
                    const noteHtml = pkg.note 
                        ? `<div class="package-card-note" style="color: var(--accent); font-size: 11px; margin-top: 3px; font-weight: 500;">ℹ ${pkg.note}</div>` 
                        : '';
                    card.innerHTML = `
                        <div class="package-card-info">
                            <span class="package-card-title">${pkg.name}</span>
                            <span class="package-card-sub">Version ${pkg.version} &bull; Target: bin/${sec.key}/${pkg.folderName}</span>
                            ${noteHtml}
                        </div>
                        <button class="btn-win btn-small btn-install-pkg" data-type="${sec.key}" data-id="${pkg.id}">Install</button>
                    `;
                    grid.appendChild(card);
                }
                group.appendChild(grid);
                container.appendChild(group);
            }

            container.querySelectorAll('.btn-install-pkg').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const type = e.target.getAttribute('data-type');
                    const id = e.target.getAttribute('data-id');
                    modalSettings.classList.add('hidden');
                    await startSinglePackageDownload(type, id);
                });
            });
        } catch (err) {
            container.innerHTML = `<div style="color: var(--status-error); padding: 12px;">Failed to load catalog: ${err.message}</div>`;
        }
    }

    // -------------------------------------------------------------------------
    // Developer Mode Diagnostics Panel
    // -------------------------------------------------------------------------
    function renderDevDiagnostics() {
        const grid = document.getElementById('dev-info-grid');
        grid.innerHTML = '';

        if (!state.appInfo) return;
        const items = [
            { label: 'LAMPS', val: state.appInfo.appVersion },
            { label: 'Electron', val: state.appInfo.electronVersion },
            { label: 'Node.js', val: state.appInfo.nodeVersion },
            { label: 'OS', val: `${state.appInfo.osType} ${state.appInfo.osRelease} (${state.appInfo.arch})` },
            { label: 'Apache Port', val: String(state.statuses.apache.port) },
            { label: 'Apache PID', val: String(state.statuses.apache.pid || 'none') },
            { label: 'MySQL Port', val: String(state.statuses.mysql.port) },
            { label: 'MySQL PID', val: String(state.statuses.mysql.pid || 'none') },
            { label: 'PHP Version', val: state.statuses.php.version || 'none' }
        ];

        for (const it of items) {
            const div = document.createElement('div');
            div.className = 'dev-item';
            div.innerHTML = `<span>${it.label}:</span> <strong>${it.val}</strong>`;
            grid.appendChild(div);
        }
    }

    document.getElementById('btn-close-dev-box').addEventListener('click', () => {
        devModeBox.classList.add('hidden');
    });

    // -------------------------------------------------------------------------
    // Info Pre Modal
    // -------------------------------------------------------------------------
    function openInfoModal(title, text) {
        document.getElementById('info-modal-title').textContent = title;
        document.getElementById('info-modal-content').textContent = text;
        modalInfo.classList.remove('hidden');
    }

    document.getElementById('btn-close-info').addEventListener('click', () => modalInfo.classList.add('hidden'));
    document.getElementById('btn-done-info').addEventListener('click', () => modalInfo.classList.add('hidden'));

    // -------------------------------------------------------------------------
    // Global Keyboard Shortcuts (Section 28)
    // -------------------------------------------------------------------------
    window.addEventListener('keydown', async (e) => {
        // Ctrl + Shift + A -> Start / Stop Apache
        if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
            e.preventDefault();
            if (state.statuses.apache.status === 'Running') {
                await api.apache.stop();
            } else {
                await api.apache.start();
            }
        }
        // Ctrl + Shift + M -> Start / Stop MySQL
        else if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
            e.preventDefault();
            if (state.statuses.mysql.status === 'Running') {
                await api.mysql.stop();
            } else {
                await api.mysql.start();
            }
        }
        // Ctrl + Shift + R -> Restart All
        else if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
            e.preventDefault();
            btnRestartAll.click();
        }
        // Ctrl + , -> Open Settings
        else if (e.ctrlKey && e.key === ',') {
            e.preventDefault();
            openSettingsModal('tab-general');
        }
        // Ctrl + L -> Open Logs
        else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            openLogsModal('apache-error');
        }
        // Escape -> Close topmost modal
        else if (e.key === 'Escape') {
            if (!modalConflict.classList.contains('hidden')) modalConflict.classList.add('hidden');
            else if (!modalExtensions.classList.contains('hidden')) modalExtensions.classList.add('hidden');
            else if (!modalInfo.classList.contains('hidden')) modalInfo.classList.add('hidden');
            else if (!modalLogs.classList.contains('hidden')) modalLogs.classList.add('hidden');
            else if (!modalSettings.classList.contains('hidden')) modalSettings.classList.add('hidden');
        }
    });

    // Start application
    init();
});
