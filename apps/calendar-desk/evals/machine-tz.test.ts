import { test, expect } from "bun:test";
import { machineZone, pinMachineZone } from "./machine-tz";

test("machineZone reads the zone out of the /etc/localtime link", () => {
  expect(machineZone(() => "/var/db/timezone/zoneinfo/Asia/Kolkata")).toBe("Asia/Kolkata");
  expect(machineZone(() => { throw new Error("nope"); })).toBeNull();
});

test("pinMachineZone replaces bun's UTC, keeps an explicit zone, and does nothing without a machine zone", () => {
  expect(pinMachineZone({ TZ: "UTC" }, "Asia/Kolkata")).toBe("Asia/Kolkata");
  expect(pinMachineZone({}, "Asia/Kolkata")).toBe("Asia/Kolkata");
  expect(pinMachineZone({ TZ: "Europe/Paris" }, "Asia/Kolkata")).toBe("Europe/Paris");
  expect(pinMachineZone({ TZ: "UTC" }, null)).toBe("UTC");
});
