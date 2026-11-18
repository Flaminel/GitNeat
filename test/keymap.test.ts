import assert from "node:assert/strict";
import { test } from "node:test";
import { filterKeymapGroups, keymapGroups, matchAccel, menuAccels } from "../src/keymap";

const press = (code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("CmdOrCtrl matches either key but not both", () => {
  assert.ok(matchAccel("CmdOrCtrl+T", press("KeyT", { metaKey: true })));
  assert.ok(matchAccel("CmdOrCtrl+T", press("KeyT", { ctrlKey: true })));
  assert.ok(!matchAccel("CmdOrCtrl+T", press("KeyT", { ctrlKey: true, metaKey: true })));
  assert.ok(!matchAccel("CmdOrCtrl+T", press("KeyT", { ctrlKey: true, shiftKey: true })));
});

test("Ctrl+Tab and Ctrl+Shift+Tab differ by shift", () => {
  assert.ok(matchAccel("Ctrl+Tab", press("Tab", { ctrlKey: true })));
  assert.ok(!matchAccel("Ctrl+Tab", press("Tab", { ctrlKey: true, shiftKey: true })));
  assert.ok(matchAccel("Ctrl+Shift+Tab", press("Tab", { ctrlKey: true, shiftKey: true })));
});

test("Alt, digit, slash, F11 and zoom accelerators match", () => {
  assert.ok(matchAccel("Alt+T", press("KeyT", { altKey: true })));
  assert.ok(!matchAccel("Alt+T", press("KeyT", { altKey: true, metaKey: true })));
  assert.ok(matchAccel("CmdOrCtrl+3", press("Digit3", { metaKey: true })));
  assert.ok(matchAccel("Ctrl+Cmd+3", press("Digit3", { metaKey: true, ctrlKey: true })));
  assert.ok(!matchAccel("CmdOrCtrl+3", press("Digit3", { metaKey: true, ctrlKey: true })));
  assert.ok(matchAccel("CmdOrCtrl+/", press("Slash", { ctrlKey: true })));
  assert.ok(matchAccel("F11", press("F11")));
  assert.ok(matchAccel("CmdOrCtrl+=", press("Equal", { metaKey: true, shiftKey: true })));
});

test("menuAccels walks submenus and skips items without a key", () => {
  const list = menuAccels([
    {
      label: "View",
      items: [
        { type: "item", id: "a", label: "A", accel: "CmdOrCtrl+A" },
        { type: "item", id: "b", label: "B", accel: null },
        { type: "sub", label: "S", items: [{ type: "item", id: "c", label: "C", accel: "F11" }] },
      ],
    },
  ]);
  assert.deepEqual(list, [
    { id: "a", accel: "CmdOrCtrl+A" },
    { id: "c", accel: "F11" },
  ]);
});

test("shortcut table uses the platform modifier", () => {
  const mac = keymapGroups(true).flatMap((g) => g.keymaps);
  const other = keymapGroups(false).flatMap((g) => g.keymaps);
  assert.deepEqual(mac.find((k) => k.label === "Open tabs list")?.keys, ["⌘ Shift A"]);
  assert.deepEqual(other.find((k) => k.label === "Open tabs list")?.keys, ["Ctrl Shift A"]);
  assert.deepEqual(other.find((k) => k.label === "Toggle Full Screen")?.keys, ["Ctrl Shift F", "F11"]);
});

test("filter matches label or key and drops empty groups", () => {
  const groups = keymapGroups(false);
  const byLabel = filterKeymapGroups(groups, "zoom");
  assert.deepEqual(byLabel.map((g) => g.name), ["UI"]);
  assert.equal(byLabel[0].keymaps.length, 3);
  assert.equal(filterKeymapGroups(groups, "").length, groups.length);
  assert.equal(filterKeymapGroups(groups, "no such shortcut").length, 0);
});
