declare module "@sentry/node" {
  export function init(options: Record<string, unknown>): void;
}

declare module "vitest" {
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: (actual: unknown) => {
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
  };
}

declare module "vitest/config" {
  export function defineConfig(config: Record<string, unknown>): Record<string, unknown>;
}

declare module "@playwright/test" {
  type Page = {
    goto(url: string): Promise<void>;
    getByRole(role: string, options?: Record<string, unknown>): unknown;
  };

  export const devices: Record<string, Record<string, unknown>>;
  export function defineConfig(config: Record<string, unknown>): Record<string, unknown>;
  export const test: (name: string, fn: (args: { page: Page }) => Promise<void>) => void;
  export const expect: (locator: unknown) => {
    toBeVisible(): Promise<void>;
  };
}
