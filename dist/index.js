"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const node_os_1 = __importDefault(require("node:os"));
const path = __importStar(require("path"));
const router_1 = require("./auth/router");
const router_2 = require("./calendar/router");
const router_3 = require("./users/router");
const router_4 = require("./marketplace/router");
const photosRouter_1 = __importDefault(require("./marketplace/photosRouter"));
const offersRouter_1 = __importDefault(require("./marketplace/offersRouter"));
const photoCleanup_1 = require("./marketplace/photoCleanup");
const config_1 = require("./config");
const db_1 = require("./db");
const errors_1 = require("./db/errors");
const settingsRegistry_1 = require("./settings/settingsRegistry");
const expirySweep_1 = require("./trades/expirySweep");
const app = (0, express_1.default)();
/**
 * Ports an Expo dev server may be reached on. A browser origin is only accepted
 * on one of these, so this is not a blanket "any LAN origin" rule.
 */
const EXPO_DEV_PORTS = new Set(['8081', '19006', '8082']);
/** True for RFC1918 addresses plus loopback and `.local` mDNS names. */
function isPrivateLanHost(host) {
    // 127.0.0.1 is included because Expo web on this machine frequently resolves
    // its own origin as http://127.0.0.1:8081 rather than http://localhost:8081,
    // and refusing that origin would silently break the very first request.
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local'))
        return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m)
        return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    // RFC1918 private ranges
    if (a === 10)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    // Tailscale CGNAT range: 100.64.0.0/10 (100.64.0.0 to 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    return false;
}
/**
 * Native iOS/Android `fetch` sends no `Origin` header and is therefore not
 * subject to CORS at all — these rules only govern Expo web. A web preview
 * opened on the LAN (`http://192.168.1.5:8081`) has an origin that cannot be
 * written down in advance, because the PC's address changes with the network,
 * so private-LAN origins on Expo dev ports are accepted alongside the explicit
 * `CORS_ORIGINS` list.
 */
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    if (config_1.config.corsOrigins.includes(origin))
        return true;
    const m = /^http:\/\/([^/:]+|\[[^\]]+\])(?::(\d+))?$/.exec(origin);
    if (!m)
        return false;
    const port = m[2] ?? '';
    if (!EXPO_DEV_PORTS.has(port))
        return false;
    return isPrivateLanHost(m[1].replace(/^\[|\]$/g, ''));
}
/**
 * Browser clients (Expo web) are subject to CORS; native clients are not.
 * The allowlist is explicit — an empty CORS_ORIGINS blocks browser access rather
 * than defaulting to "*", because the auth endpoints are credential-bearing.
 */
if (config_1.config.corsOrigins.length > 0) {
    app.use((0, cors_1.default)({
        origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
        credentials: true,
    }));
}
app.use(express_1.default.json());
// Make database pool available to routes
app.set('db', db_1.pool);
/**
 * Phase 3 Step 2 scope: backend + database only.
 * The listing-screener AI endpoint is deliberately NOT implemented — it is gated
 * on the Path 1 / Path 2 decision in docs/ai/LISTING_SCREENER_AI_PLAN.md.
 */
app.get('/health', async (_req, res) => {
    // Config guard: refuse to connect if password is masked or empty
    if (config_1.config.dbPasswordInvalid) {
        return res.status(503).json({
            status: 'error',
            db: 'unavailable',
        });
    }
    try {
        await db_1.pool.query('SELECT 1');
        res.json({
            status: 'ok',
            db: 'ok',
        });
    }
    catch (err) {
        const classification = (0, errors_1.classifyDbError)(err);
        console.error(`[health] database check failed: ${classification.logReason}`);
        res.status(503).json({
            status: 'error',
            db: 'unavailable',
        });
    }
});
/**
 * Phase 3 Step 3: real authentication against PostgreSQL.
 * See src/auth/router.ts for the endpoint contract.
 */
app.use('/auth', router_1.authRouter);
/**
 * Public Event Calendar: community-submitted event listings
 * See src/calendar/router.ts for endpoint details
 */
app.use('/calendar', router_2.calendarRouter);
/**
 * User Management: list users, verification (Head only)
 * See src/users/router.ts for endpoint details
 */
app.use('/users', router_3.usersRouter);
/**
 * Marketplace photos: upload and attach to listings.
 * Must come before marketplaceRouter (JSON-only middleware incompatible with multipart).
 */
app.use('/marketplace', photosRouter_1.default);
/**
 * Marketplace offers: create, accept, decline, withdraw structured offers.
 */
app.use('/marketplace/offers', offersRouter_1.default);
/**
 * Marketplace chat: text-only messaging, one thread per (listing, buyer).
 * Send-time moderation only. Chat content never classified or used as AI input.
 */
const chatRouter_1 = __importDefault(require("./marketplace/chatRouter"));
app.use('/marketplace/chat', chatRouter_1.default);
/**
 * AI Attire Matcher: proxies matching requests to Flask AI service.
 * Requires verified marketplace account.
 */
const matcherRouter_1 = __importDefault(require("./ai/matcherRouter"));
app.use('/api/ai', matcherRouter_1.default);
/**
 * Inventory: user-owned attire items (owned_attire table).
 * GET /inventory/mine and POST /inventory.
 */
const inventoryRouter_1 = require("./inventory/inventoryRouter");
app.use('/inventory', inventoryRouter_1.inventoryRouter);
/**
 * Trades: user-to-user item trades (swap, sale).
 * M1 Trade Backend - server-side item ownership and state machine.
 */
const tradesRouter_1 = __importDefault(require("./trades/tradesRouter"));
app.use('/trades', tradesRouter_1.default);
/**
 * Marketplace Registration: cosplayer submits, reads back own registration.
 * See src/marketplace/router.ts for endpoint details
 */
app.use('/marketplace', router_4.marketplaceRouter);
/**
 * Serve uploaded photos with safe headers.
 */
app.use('/uploads', express_1.default.static(path.join(process.cwd(), 'uploads'), {
    setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'public, max-age=31536000');
    },
}));
app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint' });
});
/**
 * Terminal error handler. Without this, Express answers a malformed JSON body
 * with its default HTML page, which embeds a stack trace and absolute server
 * paths in the response.
 */
app.use((err, _req, res, _next) => {
    const isBodyParseError = err.type === 'entity.parse.failed';
    if (isBodyParseError) {
        res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
        return;
    }
    console.error('[api] unhandled error:', err.message);
    res.status(err.status ?? 500).json({
        error: 'server_error',
        message: 'Something went wrong. Please try again.',
    });
});
/** Non-internal IPv4 addresses, so the startup banner shows a usable URL. */
function lanAddresses() {
    const found = [];
    for (const entries of Object.values(node_os_1.default.networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && !entry.internal)
                found.push(entry.address);
        }
    }
    return found;
}
/**
 * Check database connectivity at startup.
 * Logs clear status but does NOT exit on failure — keep the server running
 * so /health is diagnosable.
 */
async function checkDatabaseConnection() {
    if (config_1.config.dbPasswordInvalid) {
        console.error('database: UNAVAILABLE (DB_PASSWORD is empty or a placeholder mask)');
        return;
    }
    try {
        await db_1.pool.query('SELECT 1');
        console.log('database: OK');
    }
    catch (err) {
        const classification = (0, errors_1.classifyDbError)(err);
        console.error(`database: UNREACHABLE (${classification.logReason})`);
    }
}
const server = app.listen(config_1.config.port, config_1.config.host, async () => {
    console.log(`forgemind-backend listening on ${config_1.config.host}:${config_1.config.port} (${config_1.config.nodeEnv})`);
    if (config_1.config.corsOrigins.length > 0) {
        console.log(`CORS origins: ${config_1.config.corsOrigins.join(', ')} (plus private-LAN origins on Expo dev ports)`);
    }
    else {
        console.log('CORS origins: none configured (browser requests will be blocked)');
    }
    // The device reads this host out of Metro, so print exactly what the phone
    // will use rather than making the reader run `ipconfig` themselves.
    for (const address of lanAddresses()) {
        console.log(`  phone / LAN:  http://${address}:${config_1.config.port}`);
    }
    console.log('  this PC:      http://localhost:' + config_1.config.port);
    console.log('  android emu:  http://10.0.2.2:' + config_1.config.port);
    console.log('  health:       GET /health');
    // Check database after server starts
    await checkDatabaseConnection();
    // Verify required settings exist
    try {
        await (0, settingsRegistry_1.verifyRequiredSettings)(db_1.query);
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        console.error('Server startup FAILED - missing required settings');
        process.exit(1);
    }
    // Start photo cleanup timer
    (0, photoCleanup_1.startPhotoCleanup)();
    // Start trade expiry sweep
    (0, expirySweep_1.startExpirySweep)();
});
const shutdown = async () => {
    (0, photoCleanup_1.stopPhotoCleanup)();
    (0, expirySweep_1.stopExpirySweep)();
    server.close();
    await db_1.pool.end();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
exports.default = app;
//# sourceMappingURL=index.js.map