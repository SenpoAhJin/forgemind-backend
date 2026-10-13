"use strict";
/**
 * Chat Moderation - Send-time screening only
 *
 * Rule-based blocklist check. Message bodies are NEVER logged, scored, or used as AI input.
 * Benign test messages loaded from separate files for verification.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BENIGN_USER_SET = exports.BENIGN_TEST_SET = void 0;
exports.screenMessage = screenMessage;
const normalize_1 = require("../moderation/normalize");
const chatBlocklist_1 = require("./chatBlocklist");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Compile blocklist once at module load
const compiled = chatBlocklist_1.CHAT_BLOCKLIST.map(term => (0, normalize_1.compileWord)(term));
function screenMessage(body) {
    // R9: Message body is NEVER logged
    const target = (0, normalize_1.toTarget)(body);
    const blocked = compiled.some(term => (0, normalize_1.containsTerm)(target, term));
    return { blocked };
}
// Load benign test messages from files (for verification only, not used in screening)
function loadBenignMessages(filename) {
    const file = path.join(__dirname, '..', '..', 'scripts', 'data', filename);
    if (!fs.existsSync(file))
        return [];
    const content = fs.readFileSync(file, 'utf8');
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
}
exports.BENIGN_TEST_SET = loadBenignMessages('benign_marketplace.txt');
exports.BENIGN_USER_SET = loadBenignMessages('benign_user.txt');
//# sourceMappingURL=chatModeration.js.map