import { describe, expect, it } from "vitest";
import { isDemoAdmin, roleAtLeast, type Role } from "@/lib/roles";

const ROLES: Role[] = ["public_user", "demo_admin", "master_admin"];

describe("roleAtLeast", () => {
  it("orders the three roles", () => {
    expect(roleAtLeast("master_admin", "demo_admin")).toBe(true);
    expect(roleAtLeast("demo_admin", "master_admin")).toBe(false);
    expect(roleAtLeast("public_user", "demo_admin")).toBe(false);
  });

  it("is reflexive for every role", () => {
    for (const r of ROLES) expect(roleAtLeast(r, r)).toBe(true);
  });

  it("never lets a public user reach a gated section", () => {
    expect(roleAtLeast("public_user", "master_admin")).toBe(false);
  });
});

describe("isDemoAdmin", () => {
  it("matches only the shared demo login", () => {
    expect(isDemoAdmin("demo_admin")).toBe(true);
    expect(isDemoAdmin("master_admin")).toBe(false);
    expect(isDemoAdmin("public_user")).toBe(false);
  });
});
