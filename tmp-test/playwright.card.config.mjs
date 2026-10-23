// 临时配置：验证商品卡图片尺寸 / 名称省略 / 名称与价格间距（跑完删除）
import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const BACKEND_PORT = 3998
const FRONTEND_PORT = 5998

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${FRONTEND_PORT}`, trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, channel: 'chrome' } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true, channel: 'chrome' } },
  ],
  webServer: [
    {
      command: 'node tests/prepare-test-db.mjs && node server/index.js',
      cwd: projectRoot,
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DB_PATH: './server/test.db',
        PORT: String(BACKEND_PORT),
        TRUST_PROXY: '1',
        JWT_SECRET: 'playwright-test-only-jwt-secret',
        CUSTOMER_JWT_SECRET: 'playwright-test-only-customer-jwt-secret',
        UPLOAD_DIR: './uploads',
        PUBLIC_BASE_URL: `http://localhost:${FRONTEND_PORT}`,
        CORS_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
        CAPTCHA_TEST_ECHO: '1',
      },
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: projectRoot,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
    },
  ],
})
