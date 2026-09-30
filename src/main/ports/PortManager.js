const net = require('net');
const { execFile } = require('child_process');
const logger = require('../utils/Logger');

class PortManager {
    /**
     * Check if a port is in use on Windows.
     * Returns: { port, inUse: boolean, pid: number | null, processName: string | null }
     */
    async checkPort(port) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
            return { port: portNum, inUse: false, pid: null, processName: null, error: 'Invalid port number' };
        }

        const isAvailableNet = await this._isPortAvailableViaNet(portNum);
        if (isAvailableNet) {
            return { port: portNum, inUse: false, pid: null, processName: null };
        }

        // Port is occupied; identify PID via netstat
        const netstatInfo = await this._findProcessByNetstat(portNum);
        let processName = null;

        if (netstatInfo && netstatInfo.pid) {
            processName = await this._getProcessNameByPid(netstatInfo.pid);
        }

        logger.warn(`Port ${portNum} is in use by PID ${netstatInfo?.pid || 'unknown'} (${processName || 'unknown process'})`);

        return {
            port: portNum,
            inUse: true,
            pid: netstatInfo ? netstatInfo.pid : null,
            processName: processName || 'Unknown Process'
        };
    }

    /**
     * Simple socket check to see if port is free to bind.
     */
    _isPortAvailableViaNet(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.unref();

            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    resolve(false);
                } else {
                    resolve(false);
                }
            });

            server.once('listening', () => {
                server.close(() => {
                    resolve(true);
                });
            });

            // Listen on 0.0.0.0
            server.listen(port, '0.0.0.0');
        });
    }

    /**
     * Run netstat -ano -p tcp to locate PID listening on given port.
     */
    _findProcessByNetstat(port) {
        return new Promise((resolve) => {
            execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
                if (err || !stdout) return resolve(null);

                const lines = stdout.split(/\r?\n/);
                const targetEnd = `:${port}`;

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('TCP')) continue;

                    // Example: TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    1234
                    const parts = trimmed.split(/\s+/);
                    if (parts.length >= 5) {
                        const localAddress = parts[1];
                        const state = parts[3];
                        const pidStr = parts[4];

                        if (localAddress.endsWith(targetEnd) && state.toUpperCase() === 'LISTENING') {
                            const pid = parseInt(pidStr, 10);
                            if (!isNaN(pid)) {
                                return resolve({ pid, state });
                            }
                        }
                    }
                }

                resolve(null);
            });
        });
    }

    /**
     * Get process name from PID using tasklist.
     */
    _getProcessNameByPid(pid) {
        return new Promise((resolve) => {
            if (!pid || pid <= 0) return resolve(null);

            execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
                if (err || !stdout) return resolve(null);

                const line = stdout.trim();
                if (line.toLowerCase().includes('no tasks')) return resolve(null);

                const parts = line.split('","').map(p => p.replace(/"/g, '').trim());
                if (parts.length > 0 && parts[0]) {
                    return resolve(parts[0]);
                }

                resolve(null);
            });
        });
    }

    /**
     * Suggest next available port if requested port is in use.
     */
    async suggestAvailablePort(startPort) {
        const preferred = [startPort];
        if (startPort === 80) preferred.push(8080, 8000, 8888, 8088);
        else if (startPort === 443) preferred.push(8443, 4433, 9443);
        else if (startPort === 3306) preferred.push(3307, 3308, 33060);

        for (const p of preferred) {
            const res = await this.checkPort(p);
            if (!res.inUse) return p;
        }

        // Sequential search
        let candidate = startPort + 1;
        while (candidate <= 65535 && candidate < startPort + 100) {
            const res = await this.checkPort(candidate);
            if (!res.inUse) return candidate;
            candidate++;
        }

        return startPort;
    }
}

const portManager = new PortManager();
module.exports = portManager;
