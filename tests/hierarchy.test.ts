import { describe, expect, it } from "vitest";

function getRankPrefix(globalRole?: string, roomRole?: string): string {
  if (globalRole === "admin") return "~";
  if (roomRole === "owner") return "#";
  if (globalRole === "moderator" || roomRole === "moderator") return "@";
  if (globalRole === "driver" || roomRole === "driver") return "%";
  if (globalRole === "voice" || roomRole === "voice") return "+";
  return "";
}

function hasMention(body: string, myName?: string, myHandle?: string): boolean {
  const bodyLower = body.toLowerCase();
  const nameMatch = myName ? bodyLower.includes(myName.toLowerCase()) : false;
  const handleMatch = myHandle ? bodyLower.includes(myHandle.toLowerCase()) : false;
  return nameMatch || handleMatch;
}

function getGlobalRoleWeight(role: string): number {
  if (role === "admin") return 4;
  if (role === "moderator") return 3;
  if (role === "driver") return 2;
  if (role === "voice") return 1;
  return 0;
}

function getRoomRoleWeight(role: string): number {
  if (role === "owner") return 5;
  if (role === "admin") return 4;
  if (role === "moderator") return 3;
  if (role === "driver") return 2;
  if (role === "voice") return 1;
  return 0;
}

function checkRoleHierarchy(actor: any, target: any, roleName: string): boolean {
  if (actor.globalRole === "admin") return true;
  
  const targetGlobalWeight = getGlobalRoleWeight(target.globalRole);
  const targetRoomWeight = getRoomRoleWeight(target.roomRole);
  const actorGlobalWeight = getGlobalRoleWeight(actor.globalRole);
  const actorRoomWeight = getRoomRoleWeight(actor.roomRole);
  
  const requestedGlobalWeight = getGlobalRoleWeight(roleName);
  const requestedRoomWeight = getRoomRoleWeight(roleName);
  
  const isGlobalRole = ["admin", "moderator", "driver", "voice", "user"].includes(roleName);
  
  if (isGlobalRole) {
    if (actor.globalRole !== "admin" && actor.globalRole !== "moderator") return false;
    if (actorGlobalWeight <= targetGlobalWeight) return false;
    if (actorGlobalWeight <= requestedGlobalWeight) return false;
    return true;
  } else {
    const canModifyRoomRole = actor.roomRole === "owner" || actor.roomRole === "moderator";
    if (!canModifyRoomRole) return false;
    
    if (actor.roomRole === "owner") {
      return actor.handle !== target.handle;
    }
    
    if (actor.roomRole === "moderator") {
      if (targetRoomWeight >= 3) return false;
      if (requestedRoomWeight >= 3) return false;
      return true;
    }
  }
  return false;
}

describe("Hierarchy & Chat Features Tests", () => {
  describe("getRankPrefix", () => {
    it("returns correct prefix symbols for roles", () => {
      expect(getRankPrefix("admin", "member")).toBe("~");
      expect(getRankPrefix("user", "owner")).toBe("#");
      expect(getRankPrefix("moderator", "member")).toBe("@");
      expect(getRankPrefix("user", "moderator")).toBe("@");
      expect(getRankPrefix("driver", "member")).toBe("%");
      expect(getRankPrefix("user", "driver")).toBe("%");
      expect(getRankPrefix("voice", "member")).toBe("+");
      expect(getRankPrefix("user", "voice")).toBe("+");
      expect(getRankPrefix("user", "member")).toBe("");
    });
  });

  describe("Name Mentions", () => {
    it("detects mentions case-insensitively", () => {
      expect(hasMention("Hello Mira!", "mira", "mirahandle")).toBe(true);
      expect(hasMention("Hello mirahandle!", "mira", "mirahandle")).toBe(true);
      expect(hasMention("Hello everyone", "mira", "mirahandle")).toBe(false);
    });
  });

  describe("Role Hierarchy Rules", () => {
    it("allows global admins to modify anything", () => {
      const admin = { globalRole: "admin", roomRole: "member", handle: "admin" };
      const target = { globalRole: "moderator", roomRole: "moderator", handle: "target" };
      expect(checkRoleHierarchy(admin, target, "driver")).toBe(true);
    });

    it("prevents global driver from promoting or modifying moderator", () => {
      const driver = { globalRole: "driver", roomRole: "member", handle: "driver" };
      const target = { globalRole: "user", roomRole: "member", handle: "target" };
      expect(checkRoleHierarchy(driver, target, "voice")).toBe(false);
    });

    it("prevents moderator from muting/promoting another moderator in room role", () => {
      const mod = { globalRole: "user", roomRole: "moderator", handle: "mod" };
      const target = { globalRole: "user", roomRole: "moderator", handle: "target" };
      expect(checkRoleHierarchy(mod, target, "driver")).toBe(false);
    });
  });
});
