import './config/env.js'

// Run the async SQLite migrations before importing modules that open the database.
await import('./migrate.js')
await import('./app.js')
