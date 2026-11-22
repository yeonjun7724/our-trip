import { expect, test, type CDPSession, type Page } from "@playwright/test";

/** The map must follow fingers and chips: real touch events, then read the camera. */
interface Cam { lng: number; lat: number; zoom: number }
const cam = (p: Page) => p.evaluate<Cam>(() => {
  const m = (window as unknown as { __otMap: { getCenter: () => { lng: number; lat: number }; getZoom: () => number } }).__otMap;
  return { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom() };
});

async function swipe(c: CDPSession, x: number, y: number, dx: number, dy: number) {
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function tap(c: CDPSession, x: number, y: number) {
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("지도 이동: 드래그·칩 이동·상세 닫기·더블탭 확대", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const c = await ctx.newCDPSession(p);
  await p.goto("/");
  await p.getByLabel("이름", { exact: true }).fill(`지도${Date.now() % 100000}`);
  await p.getByRole("button", { name: "시작" }).click();
  await p.getByLabel("장소 검색").waitFor();
  await p.waitForTimeout(2500);

  // dragging moves the map and folds the cards away
  const before = await cam(p);
  await swipe(c, 300, 420, -120, 0);
  await p.waitForTimeout(1200);
  expect((await cam(p)).lng).toBeGreaterThan(before.lng + 0.1);
  await p.getByRole("button", { name: "장소 카드 펼치기" }).click();
  await expect(p.getByRole("button", { name: "장소 카드 펼치기" })).toBeHidden();

  // selecting a pin must not break later moves (used to fling the map into the sea south of Busan)
  await p.getByRole("button", { name: "포항", exact: true }).click();
  await p.waitForTimeout(1200);
  await p.locator(".ot-pin").first().dispatchEvent("click");
  await p.waitForTimeout(1000);
  await p.getByRole("button", { name: "부산", exact: true }).click();
  await p.waitForTimeout(1200);
  const busan = await cam(p);
  expect(Math.abs(busan.lat - 35.1)).toBeLessThan(0.3);
  expect(busan.zoom).toBeGreaterThan(8);

  // tapping the chip that's already on brings the map back
  await swipe(c, 300, 420, -200, -150);
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "부산", exact: true }).click();
  await p.waitForTimeout(1200);
  const back = await cam(p);
  expect(Math.abs(back.lng - busan.lng)).toBeLessThan(0.02);

  // with the detail open the map still drags, and closing it leaves the view alone
  const pin = p.locator(".ot-pin").first();
  await pin.dispatchEvent("click");
  await p.waitForTimeout(1000);
  await pin.dispatchEvent("click");
  await expect(p.getByRole("dialog")).toBeVisible();
  await p.waitForTimeout(1000);
  const opened = await cam(p);
  await swipe(c, 195, 200, -100, 60);
  await p.waitForTimeout(1200);
  const dragged = await cam(p);
  expect(dragged.lng).toBeGreaterThan(opened.lng);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);
  const closed = await cam(p);
  expect(Math.abs(closed.lng - dragged.lng) + Math.abs(closed.zoom - dragged.zoom)).toBeLessThan(0.001);

  // double tap zooms; it does not open "여기에 장소 추가". A single tap still does.
  await tap(c, 60, 560);
  await p.waitForTimeout(90);
  await tap(c, 60, 560);
  await p.waitForTimeout(1000);
  expect((await cam(p)).zoom).toBeGreaterThan(closed.zoom + 0.5);
  await expect(p.getByText("여기에 장소 추가").first()).toBeHidden();
  await tap(c, 60, 560);
  await expect(p.getByRole("dialog")).toContainText("여기에 장소 추가");

  // moving the spot keeps the typed name
  await p.getByLabel("장소 이름").fill("임시 이름");
  await tap(c, 320, 260);
  await p.waitForTimeout(700);
  await expect(p.getByLabel("장소 이름")).toHaveValue("임시 이름");
  await ctx.close();
});
