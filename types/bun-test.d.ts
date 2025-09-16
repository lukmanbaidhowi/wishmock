// Minimal ambient declarations so VS Code resolves `bun:test` in this repo
// This is intentionally lightweight; Bun's full typings are richer.
declare module "bun:test" {
  export type TestCallback = () => any | Promise<any>;

  export interface TestFn {
    (name: string, fn: TestCallback): void;
    (fn: TestCallback): void;
  }

  export const test: TestFn;
  export const it: TestFn;
  export const describe: (name: string, fn: () => void) => void;
  export const beforeAll: (fn: TestCallback) => void;
  export const afterAll: (fn: TestCallback) => void;
  export const beforeEach: (fn: TestCallback) => void;
  export const afterEach: (fn: TestCallback) => void;

  // Very loose expect typing to satisfy editor intellisense
  export function expect<T = any>(actual: T): any;

  // Minimal mocking utilities to satisfy TS in this repo
  export const vi: any;
}
