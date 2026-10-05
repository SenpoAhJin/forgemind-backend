/**
 * Barrel for the moderation rule data.
 *
 * The words live in the per-category files next to this one. This file only
 * re-exports them, so importing the rules never has to know the layout.
 */

export * from './allowlist';
export * from './adult';
export * from './blockedTerms';
export * from './cosplayTerms';
export * from './hate';
export * from './languageTerms';
export * from './prohibited';
export * from './unrelated';
export * from './vulgar';

export const LIMITS = {
  titleMax: 100,
  descriptionMax: 2000,
};

export const PERMITTED_CATEGORY_SLUGS: readonly string[] = [
  'Costumes & Cosplay',
  'Wigs',
  'Props & Accessories',
  'Materials & Fabric',
  'Makeup & Contacts',
  'Photography Services',
  'Commissions & Crafting Services',
];
