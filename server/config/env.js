import dotenv from 'dotenv'

// .env provides shared fallbacks; the environment file overrides only for that runtime.
dotenv.config({ path: '.env' })
dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}`, override: true })
