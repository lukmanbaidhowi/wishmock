import * as assert from "node:assert";

// Basic expect implementation for Node.js
const nodeExpect = (actual: any) => ({
    toBeGreaterThan: (expected: number) => {
        assert.ok(actual > expected, `Expected ${actual} to be greater than ${expected}`);
    },
    toBe: (expected: any) => {
        assert.strictEqual(actual, expected);
    },
    toBeDefined: () => {
        assert.ok(actual !== undefined, `Expected ${actual} to be defined`);
    }
});

let describeFn: any;
let testFn: any;
let beforeAllFn: any;
let afterAllFn: any;
let expectFn: any;

const isBun = typeof process !== "undefined" && process.versions && process.versions.bun;

if (isBun) {
    // Dynamic import to avoid static analysis issues in Node
    const bunTest = await import("bun:test");
    describeFn = bunTest.describe;
    testFn = bunTest.test;
    beforeAllFn = bunTest.beforeAll;
    afterAllFn = bunTest.afterAll;
    expectFn = bunTest.expect;
} else {
    // Node.js implementation
    const nodeTest = await import("node:test");
    describeFn = nodeTest.describe;
    testFn = nodeTest.test;
    beforeAllFn = nodeTest.before; // node:test uses 'before' for setup
    afterAllFn = nodeTest.after;   // node:test uses 'after' for teardown
    expectFn = nodeExpect;
}

export const describe = describeFn;
export const test = testFn;
export const beforeAll = beforeAllFn;
export const afterAll = afterAllFn;
export const expect = expectFn;
