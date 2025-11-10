// Minimal ambient declarations so VS Code resolves `bun:test` in this repo
// This is intentionally lightweight; Bun's full typings are richer.
declare module "bun:test" {
  export type TestCallback = () => any | Promise<any>;

  export interface TestFn {
    (name: string, fn: TestCallback): void;
    // Support optional timeout/options as third arg (used in repo tests)
    (name: string, fn: TestCallback, timeoutOrOptions: number | { timeout?: number }): void;
    (fn: TestCallback): void;
  }

  export interface ExpectMatcher {
    toHaveBeenCalledWith(...args: any[]): void;
    toHaveBeenCalledTimes(count: number): void;
    toHaveProperty(property: string, value?: any): void;
    toBe(expected: any): void;
  }

  export interface ExpectStatic extends ExpectMatcher {
    objectContaining(obj: any): any;
  }

  export namespace vi {
    interface Mock<T = any> {
      fn<F extends (...args: any[]) => any>(impl?: F): F & Mock;
      mockClear(): void;
      mockReset(): void;
      mockRestore(): void;
      mockImplementation<F extends (...args: any[]) => any>(impl: F): Mock & F;
      mockReturnValue(value: any): Mock;
      mockReturnValueOnce(value: any): Mock;
      mock: {
        calls: any[][];
        results: Array<{ type: string; value: any }>;
      };
    }
  }

  export const test: TestFn;
  export const it: TestFn;
  export const describe: (name: string, fn: () => void) => void;
  export const beforeAll: (fn: TestCallback) => void;
  export const afterAll: (fn: TestCallback) => void;
  export const beforeEach: (fn: TestCallback) => void;
  export const afterEach: (fn: TestCallback) => void;

  // Very loose expect typing to satisfy editor intellisense
  export function expect<T = any>(actual: T): ExpectMatcher & { [key: string]: any };
  export namespace expect {
    function objectContaining(obj: any): any;
  }

  // Minimal mocking utilities to satisfy TS in this repo
  export const vi: {
    fn: <F extends (...args: any[]) => any>(impl?: F) => F & vi.Mock;
    mock: {
      module: (id: string, factory: () => any) => void;
    };
    spyOn: (object: any, method: string) => vi.Mock;
  };
  export const mock: any;
}
