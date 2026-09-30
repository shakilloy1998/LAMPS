# LAMPS — Local Apache MySQL PHP Stack for Windows

<div align="center">

![LAMPS Logo](src/renderer/assets/icon.png)

**A lightweight, modern Electron-based development environment manager for Windows.**  
Manage Apache, MySQL/MariaDB, and PHP — multiple versions, zero configuration headaches.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d6.svg)](https://github.com/shakilloy1998/LAMPS/releases)
[![Electron](https://img.shields.io/badge/Electron-44-47848f.svg)](https://electronjs.org)
[![PHP](https://img.shields.io/badge/PHP-7.4%20%7C%208.1%20%7C%208.5-777bb4.svg)](https://php.net)

</div>

---

## ✨ Features

- **One-click Start / Stop / Restart** for Apache and MySQL
- **Multi-version PHP** — switch between PHP 7.4, 8.1, 8.5 instantly
- **Port management** — change Apache/MySQL ports; services auto-restart
- **Built-in package manager** — download PHP, Apache, MySQL versions directly
- **Laravel-ready** — all essential extensions enabled by default (pdo_mysql, pgsql, mbstring, curl, gd, zip, intl, …)
- **Terminal integration** — opens a terminal with the active stack pre-loaded in PATH
- **Document Root** — point Apache at any folder, one click to open in browser
- **Developer diagnostics** panel for quick health checks
- **System tray** integration with quick controls

---

## 📸 Screenshots

> _Add screenshots here_

---

## 🚀 Getting Started

### Download the Installer (Recommended)

Download the latest `LAMPS-Setup-x.x.x.exe` from the [**Releases**](https://github.com/shakilloy1998/LAMPS/releases) page and run it.

### Build from Source

**Prerequisites:**
- [Node.js](https://nodejs.org) 18+
- [Git](https://git-scm.com)
- Windows 10/11 (x64)

```bash
# Clone the repository
git clone https://github.com/shakilloy1998/LAMPS.git
cd LAMPS

# Install dependencies
npm install

# Run in development mode
npm start

# Build the installer
npm run dist
```

> **Note:** The bundled Apache, MySQL, and PHP binaries are large and not included in this repository.  
> Place them in `bin/apache/`, `bin/mysql/`, and `bin/php/` respectively, or use the built-in Package Manager to download them.

---

## 🗂️ Project Structure

```
LAMPS/
├── main.js                    # Electron main process entry point
├── preload.js                 # Context bridge (secure IPC)
├── package.json
├── src/
│   ├── main/
│   │   ├── config/            # ConfigManager — persistent settings
│   │   ├── ports/             # PortManager — port conflict detection
│   │   ├── processes/         # ProcessManager — spawn/kill/track services
│   │   ├── services/          # ApacheManager, MySQLManager, PHPManager, ServiceManager
│   │   └── utils/             # Logger, SystemDetector, TerminalLauncher
│   └── renderer/
│       ├── index.html         # Main UI
│       ├── app.js             # Renderer logic
│       └── styles.css         # UI styles
├── bin/
│   ├── apache/                # Apache binaries (not tracked in git)
│   ├── mysql/                 # MySQL/MariaDB binaries (not tracked in git)
│   └── php/                   # PHP binaries (not tracked in git)
└── dist/                      # Build output (not tracked in git)
```

---

## ⚙️ Configuration

Settings are stored in:
```
%APPDATA%\LAMPS\config.json
```

You can reset all settings from **Settings → Reset to Defaults**.

---

## 🤝 Contributing

Contributions are welcome! Please:

1. **Fork** the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a **Pull Request**

Please open an [issue](https://github.com/shakilloy1998/LAMPS/issues) first for large changes.

---

## 🐛 Reporting Bugs

Open an [issue](https://github.com/shakilloy1998/LAMPS/issues) and include:
- Your Windows version
- LAMPS version (shown in title bar)
- Steps to reproduce
- Logs from **Ctrl+L → Logs**

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 🙏 Acknowledgements

- [Electron](https://electronjs.org) — Desktop framework
- [Apache HTTP Server](https://httpd.apache.org) — Web server
- [MariaDB](https://mariadb.org) — Database
- [PHP](https://php.net) — Server-side scripting
