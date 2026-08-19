// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// L'app est un fichier statique unique : un simple serveur de fichiers suffit.
const PORT = 4173;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    // L'app enregistre un service worker (PWA) : le bloquer évite de servir
    // une version en cache d'un test à l'autre.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mobile',
      // L'app est pensée mobile d'abord (largeur max 440px) : on teste dans ce format.
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
