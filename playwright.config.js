import { defineConfig } from '@playwright/test'

// 后端使用独立端口与独立数据库副本，避免与本地正在运行的开发服务（3001/5173）冲突。
// NODE_ENV=test：config/env.js 不会加载 .env.development，所有配置完全来自下面的 env，
// 保证测试运行环境确定（数据库、密钥、端口均可控）。
const BACKEND_PORT = 3999
const FRONTEND_PORT = 5999

export default defineConfig({
  testDir: './tests',
  // 接口级测试直接打后端，串行执行：避免限流计数互相干扰，也让断言里的库存变化互不影响
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${BACKEND_PORT}`,
  },
  webServer: [
    {
      // 先用 data.db 的副本准备 server/test.db（含已知口令的测试管理员），
      // 再启动后端；测试全部通过 API 进行，数据改动只落在副本上
      command: 'node tests/prepare-test-db.mjs && node server/index.js',
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DB_PATH: './server/test.db',
        PORT: String(BACKEND_PORT),
        JWT_SECRET: 'playwright-test-only-jwt-secret',
        CUSTOMER_JWT_SECRET: 'playwright-test-only-customer-jwt-secret',
        UPLOAD_DIR: './uploads',
        PUBLIC_BASE_URL: `http://localhost:${FRONTEND_PORT}`,
        CORS_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
        // 仅测试环境回显验证码文本（见 server/routes/captcha.js），供接口用例完成登录
        CAPTCHA_TEST_ECHO: '1',
      },
    },
    {
      // 前端 dev server：本套测试只打后端 API，但按要求一并拉起，保证环境完整可复用
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
