"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.withTransaction = withTransaction;
const pg_1 = require("pg");
const config_1 = require("./config");
/**
 * Single shared pool. Connects as the non-superuser application role
 * (forgemind_app) — never `postgres`.
 */
exports.pool = new pg_1.Pool({
    host: config_1.config.db.host,
    port: config_1.config.db.port,
    database: config_1.config.db.database,
    user: config_1.config.db.user,
    password: config_1.config.db.password,
    ssl: config_1.config.db.ssl ? { rejectUnauthorized: false } : false,
    max: 10,
});
exports.pool.on('error', (err) => {
    // Never log the connection string or password.
    console.error('[db] idle client error:', err.message);
});
async function query(text, params) {
    const result = await exports.pool.query(text, params);
    return result.rows;
}
async function withTransaction(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const value = await fn(client);
        await client.query('COMMIT');
        return value;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=db.js.map