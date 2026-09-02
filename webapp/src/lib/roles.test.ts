import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE,
  ROLES,
  isDemoAdmin,
  isMasterAdmin,
  roleAtLeast,
  toRole,
} from "@/lib/roles";

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

describe("ROLES and toRole", () => {
  it("lists every role in the type, weakest first", () => {
    expect(ROLES).toEqual(["public_user", "demo_admin", "master_admin"]);
    for (let i = 1; i < ROLES.length; i++) {
      expect(roleAtLeast(ROLES[i], ROLES[i - 1])).toBe(true);
      expect(roleAtLeast(ROLES[i - 1], ROLES[i])).toBe(false);
    }
  });

  it("narrows an unknown value, failing to the weakest role", () => {
    expect(toRole("master_admin")).toBe("master_admin");
    for (const junk of [null, undefined, "", "root", 7, {}]) {
      expect(toRole(junk)).toBe(DEFAULT_ROLE);
    }
    expect(DEFAULT_ROLE).toBe("public_user");
  });
});

describe("isMasterAdmin", () => {
  it("matches only the operator", () => {
    expect(isMasterAdmin("master_admin")).toBe(true);
    expect(isMasterAdmin("demo_admin")).toBe(false);
    expect(isMasterAdmin("public_user")).toBe(false);
  });

  it("agrees with roleAtLeast, which it replaced in some call sites", () => {
    for (const r of ROLES) expect(isMasterAdmin(r)).toBe(roleAtLeast(r, "master_admin"));
  });
});
