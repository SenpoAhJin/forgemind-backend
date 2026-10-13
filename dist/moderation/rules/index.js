"use strict";
/**
 * Barrel for the moderation rule data.
 *
 * The words live in the per-category files next to this one. This file only
 * re-exports them, so importing the rules never has to know the layout.
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMITTED_CATEGORY_SLUGS = exports.LIMITS = void 0;
__exportStar(require("./allowlist"), exports);
__exportStar(require("./adult"), exports);
__exportStar(require("./blockedTerms"), exports);
__exportStar(require("./cosplayTerms"), exports);
__exportStar(require("./hate"), exports);
__exportStar(require("./languageTerms"), exports);
__exportStar(require("./prohibited"), exports);
__exportStar(require("./unrelated"), exports);
__exportStar(require("./vulgar"), exports);
exports.LIMITS = {
    titleMax: 100,
    descriptionMax: 2000,
};
exports.PERMITTED_CATEGORY_SLUGS = [
    'Costumes & Cosplay',
    'Wigs',
    'Props & Accessories',
    'Materials & Fabric',
    'Makeup & Contacts',
    'Photography Services',
    'Commissions & Crafting Services',
];
//# sourceMappingURL=index.js.map