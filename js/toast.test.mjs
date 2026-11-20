// Run with: node --test js/toast.test.mjs
import "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setToastSink, showToast } from "./toast.js";

function region() {
  return document.getElementById("toast-region");
}

beforeEach(() => {
  // Render for real (the shared helper installs a recording sink).
  setToastSink(null);
  region()?.replaceChildren();
});

test("error toast uses role=alert, info/success use role=status", () => {
  showToast("bad", { type: "error" });
  showToast("fyi");
  showToast("ok", { type: "success" });
  const [a, b, c] = region().children;
  assert.equal(a.getAttribute("role"), "alert");
  assert.equal(b.getAttribute("role"), "status");
  assert.equal(c.getAttribute("role"), "status");
  assert.match(b.className, /toast--info/);
  assert.match(c.className, /toast--success/);
});

test("unknown type falls back to info", () => {
  showToast("x", { type: "bogus" });
  assert.match(region().children[0].className, /toast--info/);
});

test("close button and handle.dismiss remove the toast", () => {
  const h = showToast("one");
  showToast("two");
  assert.equal(region().children.length, 2);
  h.dismiss();
  h.dismiss(); // idempotent
  assert.equal(region().children.length, 1);
  const close = region().children[0].children.find((c) =>
    c.className.includes("toast__close")
  );
  close.click();
  assert.equal(region().children.length, 0);
});

test("auto-dismiss: 5s for info, 10s for errors and actions", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showToast("info");
  showToast("err", { type: "error" });
  showToast("act", { action: { label: "Undo", onClick() {} } });
  t.mock.timers.tick(5000);
  assert.equal(region().children.length, 2);
  t.mock.timers.tick(5000);
  assert.equal(region().children.length, 0);
});

test("duration 0 is sticky; custom duration honoured", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showToast("sticky", { duration: 0 });
  showToast("short", { duration: 1000 });
  t.mock.timers.tick(20000);
  assert.equal(region().children.length, 1);
});

test("hover pauses auto-dismiss and leave resumes it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showToast("hover me");
  const el = region().children[0];
  el.dispatchEvent({ type: "mouseenter" });
  t.mock.timers.tick(60000);
  assert.equal(region().children.length, 1);
  el.dispatchEvent({ type: "mouseleave" });
  t.mock.timers.tick(5000);
  assert.equal(region().children.length, 0);
});

test("action button runs its callback and dismisses", () => {
  let clicked = 0;
  showToast("deleted", { action: { label: "Undo", onClick: () => clicked++ } });
  const btn = region().children[0].children.find((c) =>
    c.className.includes("toast__action")
  );
  assert.equal(btn.textContent, "Undo");
  btn.click();
  assert.equal(clicked, 1);
  assert.equal(region().children.length, 0);
});
