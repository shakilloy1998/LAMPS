const EventEmitter = require('events');
const apacheManager = require('./ApacheManager');
const phpManager = require('./PHPManager');
const mysqlManager = require('./MySQLManager');
const configManager = require('../config/ConfigManager');
const logger = require('../utils/Logger');

class ServiceManager extends EventEmitter {
    constructor() {
        super();
        this.apache = apacheManager;
        this.php = phpManager;
        this.mysql = mysqlManager;
        this.pollingTimer = null;
        this.isTransitioning = false;

        // Forward service status changes
        this.apache.on('status-changed', (data) => this.emit('status-update', data));
        this.php.on('status-changed', (data) => this.emit('status-update', data));
        this.mysql.on('status-changed', (data) => this.emit('status-update', data));
    }

    async init() {
        logger.info('Initializing LAMPS ServiceManager...');
        await this.php.init();
        await this.apache.init();
        await this.mysql.init();

        // Start background polling for real-time status updates
        this.startPolling(2500);

        // Auto start if configured
        if (configManager.get('autoStartServices')) {
            logger.info('Auto-starting services as configured...');
            this.startAll().catch(err => logger.error('Auto-start failed:', err));
        }
    }

    startPolling(intervalMs = 2500) {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        this.pollingTimer = setInterval(async () => {
            if (this.isTransitioning) return;
            try {
                await this.apache.checkStatus();
                await this.mysql.checkStatus();
            } catch (err) {
                logger.debug('Polling error: ' + err.message);
            }
        }, intervalMs);
    }

    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    async getAllStatuses() {
        return {
            apache: await this.apache.status(),
            php: await this.php.status(),
            mysql: await this.mysql.status()
        };
    }

    /**
     * Start All services: MySQL first, then Apache.
     */
    async startAll() {
        this.isTransitioning = true;
        this.emit('action-progress', { action: 'startAll', step: 'mysql', message: 'Starting MySQL...' });
        logger.info('Executing Start All: Starting MySQL...');

        const mysqlResult = await this.mysql.start();
        if (!mysqlResult.success && !mysqlResult.message?.includes('already running')) {
            this.isTransitioning = false;
            this.emit('action-progress', { action: 'startAll', step: 'error', message: `MySQL failed to start: ${mysqlResult.error}` });
            return { success: false, failedService: 'mysql', error: mysqlResult.error, conflict: mysqlResult.conflict };
        }

        this.emit('action-progress', { action: 'startAll', step: 'apache', message: 'MySQL started. Starting Apache...' });
        logger.info('Executing Start All: Starting Apache...');

        const apacheResult = await this.apache.start();
        this.isTransitioning = false;

        if (!apacheResult.success && !apacheResult.message?.includes('already running')) {
            this.emit('action-progress', { action: 'startAll', step: 'error', message: `Apache failed to start: ${apacheResult.error}` });
            return { success: false, failedService: 'apache', error: apacheResult.error, conflict: apacheResult.conflict };
        }

        this.emit('action-progress', { action: 'startAll', step: 'done', message: 'All services started successfully.' });
        logger.info('All services started successfully.');
        return { success: true };
    }

    /**
     * Stop All services: Apache first, then MySQL.
     */
    async stopAll() {
        this.isTransitioning = true;
        this.emit('action-progress', { action: 'stopAll', step: 'apache', message: 'Stopping Apache...' });
        logger.info('Executing Stop All: Stopping Apache...');

        await this.apache.stop();

        this.emit('action-progress', { action: 'stopAll', step: 'mysql', message: 'Apache stopped. Stopping MySQL...' });
        logger.info('Executing Stop All: Stopping MySQL...');

        await this.mysql.stop();

        this.isTransitioning = false;
        this.emit('action-progress', { action: 'stopAll', step: 'done', message: 'All services stopped.' });
        logger.info('All services stopped successfully.');
        return { success: true };
    }

    /**
     * Restart All services: Stop All, then Start All.
     */
    async restartAll() {
        if (this.isTransitioning) {
            return { success: false, error: 'Services are already transitioning. Please wait.' };
        }
        this.isTransitioning = true;
        try {
            this.emit('action-progress', { action: 'restartAll', step: 'stopping', message: 'Restarting all services (stopping)...' });
            logger.info('RestartAll: stopping Apache...');
            await this.apache.stop();
            logger.info('RestartAll: stopping MySQL...');
            await this.mysql.stop();

            // Give OS time to fully release ports before re-binding
            await new Promise(r => setTimeout(r, 800));

            this.emit('action-progress', { action: 'restartAll', step: 'starting', message: 'Restarting all services (starting)...' });
            logger.info('RestartAll: starting MySQL...');
            const mysqlResult = await this.mysql.start();
            if (!mysqlResult.success && !mysqlResult.message?.includes('already running')) {
                this.emit('action-progress', { action: 'restartAll', step: 'error', message: `MySQL failed: ${mysqlResult.error}` });
                return { success: false, failedService: 'mysql', error: mysqlResult.error, conflict: mysqlResult.conflict };
            }

            logger.info('RestartAll: starting Apache...');
            const apacheResult = await this.apache.start();
            if (!apacheResult.success && !apacheResult.message?.includes('already running')) {
                this.emit('action-progress', { action: 'restartAll', step: 'error', message: `Apache failed: ${apacheResult.error}` });
                return { success: false, failedService: 'apache', error: apacheResult.error, conflict: apacheResult.conflict };
            }

            this.emit('action-progress', { action: 'restartAll', step: 'done', message: 'All services restarted successfully.' });
            logger.info('All services restarted successfully.');
            return { success: true };
        } finally {
            this.isTransitioning = false;
        }
    }

    /**
     * Handle PHP version switch: update config, restart Apache if running.
     */
    async switchPhpVersion(versionId) {
        const wasApacheRunning = (this.apache.serviceStatus === 'Running');
        logger.info(`Switching PHP version to ${versionId}. Apache running: ${wasApacheRunning}`);

        const newPhp = await this.php.setActiveVersion(versionId);

        if (wasApacheRunning) {
            this.emit('action-progress', { action: 'switchPhp', step: 'restarting-apache', message: 'Restarting Apache with new PHP...' });
            await this.apache.restart();
        }

        return { success: true, php: newPhp, restartedApache: wasApacheRunning };
    }

    async shutdown() {
        this.stopPolling();
        logger.info('LAMPS shutting down services...');
        try {
            await this.stopAll();
        } catch (e) {
            logger.error('Error during shutdown:', e);
        }
    }
}

const serviceManager = new ServiceManager();
module.exports = serviceManager;
