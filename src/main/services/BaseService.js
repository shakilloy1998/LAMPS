const EventEmitter = require('events');

class BaseService extends EventEmitter {
    constructor(name) {
        super();
        this.name = name;
        this.serviceStatus = 'Stopped'; // 'Stopped', 'Starting', 'Running', 'Stopping', 'Error', 'Port Conflict'
        this.activeVersion = null;
        this.pid = null;
        this.lastError = null;
    }

    setStatus(status, meta = {}) {
        this.serviceStatus = status;
        this.emit('status-changed', {
            service: this.name,
            status: this.serviceStatus,
            pid: this.pid,
            ...meta
        });
    }

    async detect() {
        throw new Error('detect() must be implemented by subclass');
    }

    async start() {
        throw new Error('start() must be implemented by subclass');
    }

    async stop() {
        throw new Error('stop() must be implemented by subclass');
    }

    async restart() {
        await this.stop();
        return await this.start();
    }

    async status() {
        return {
            name: this.name,
            status: this.serviceStatus,
            pid: this.pid,
            version: this.getVersion(),
            port: this.getPort(),
            lastError: this.lastError
        };
    }

    getVersion() {
        return this.activeVersion ? this.activeVersion.version : 'Not Detected';
    }

    getPort() {
        return null;
    }

    async setPort(newPort) {
        throw new Error('setPort() must be implemented by subclass');
    }

    async validateConfiguration() {
        return { valid: true, errors: [] };
    }
}

module.exports = BaseService;
