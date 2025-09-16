import { describe, expect, test } from "bun:test";
import { groupLoadedServices } from "../frontend/lib/services.js";

describe("frontend/lib/services: groupLoadedServices", () => {
  test("groups methods by service", () => {
    const input = [
      "a.A/One",
      "a.A/Two",
      "b.B/Do",
      "c.C/Act",
    ];
    const m = groupLoadedServices(input);
    expect(m.get("a.A")).toEqual(["One", "Two"]);
    expect(m.get("b.B")).toEqual(["Do"]);
    expect(m.get("c.C")).toEqual(["Act"]);
  });

  test("handles empty and malformed entries", () => {
    const input = ["justname", "", "/OnlyMethod"];
    const m = groupLoadedServices(input as any);
    const unknown = m.get("(unknown)") || [];
    expect(unknown).toContain("justname");
    expect(Array.from(m.keys()).length).toBeGreaterThan(0);
  });
});
