/**
 * DEPRECATED — DO NOT USE
 *
 * This file contained a hash-based simulation that generated fake availability
 * data based on (productHash + pincodeHash) % 100 probability estimates.
 *
 * It has been superseded by the real HTTP-based checker in:
 *   src/lib/availability-service.ts  (orchestration)
 *   src/lib/flipkart-api-checker.ts  (Flipkart Rome API + Puppeteer)
 *
 * No exports from this file should be used anywhere.
 * This file is kept only as a placeholder to avoid import errors during migration.
 * It can be safely deleted once all imports are confirmed removed.
 */

export {};
