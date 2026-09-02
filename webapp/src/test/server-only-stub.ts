/**
 * `server-only` throws at build time if a module is pulled into a client bundle.
 * It has no runtime behaviour, so under Vitest it resolves here instead — see
 * the alias in vitest.config.ts.
 */
export {};
