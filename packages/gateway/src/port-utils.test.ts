import { describe, expect, it } from "vitest";
import { isPortInUse, findProcessOnPort } from "./port-utils.js";

describe("port-utils", () => {
  it("findProcessOnPort returns null for unlikely port", () => {
    expect(findProcessOnPort(59999)).toBeNull();
  });

  it("isPortInUse returns false for unlikely port", () => {
    expect(isPortInUse(59999)).toBe(false);
  });
});
