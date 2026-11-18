import { expect, test } from "@playwright/test";

/**
 * The visual tip of every place pin must sit on the place's real coordinate.
 * Measures, in screen pixels, the distance between the pin tip and map.project(lngLat).
 */
test("지도 핀 끝이 실제 좌표와 일치한다 (오차 ≤ 3px)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByLabel("이름", { exact: true }).fill(`핀검사${Date.now() % 10000}`);
  await page.getByRole("button", { name: "시작" }).click();
  await page.getByLabel("장소 검색").waitFor();
  await page.getByRole("button", { name: "경주", exact: true }).click();
  await page.waitForTimeout(2500);

  const trip = await page.request.get("/api/me").then((r) => r.json());
  const places: { name: string; latitude: number | null; longitude: number | null }[] =
    await page.request.get(`/api/trips/${trip.trip_id}/places`).then((r) => r.json());
  const want = new Map(places.filter((p) => p.latitude != null).map((p) => [p.name, [p.longitude!, p.latitude!]]));

  const results = await page.evaluate((entries) => {
    const map = (window as unknown as { __otMap: { project: (ll: [number, number]) => { x: number; y: number } } }).__otMap;
    const canvas = document.querySelector(".maplibregl-canvas")!.getBoundingClientRect();
    const out: { name: string; dx: number; dy: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".ot-pin")) {
      const name = el.getAttribute("aria-label") ?? "";
      const ll = (entries as [string, [number, number]][]).find(([n]) => n === name)?.[1];
      const tip = el.querySelector<HTMLElement>("[data-tip]");
      if (!ll || !tip) continue;
      const r = tip.getBoundingClientRect();
      const p = map.project(ll);
      out.push({ name, dx: r.left + r.width / 2 - (canvas.left + p.x), dy: r.top + r.height / 2 - (canvas.top + p.y) });
    }
    return out;
  }, [...want.entries()]);

  console.log(results.map((r) => `${r.name}: dx=${r.dx.toFixed(1)} dy=${r.dy.toFixed(1)}`).join("\n"));
  expect(results.length).toBeGreaterThanOrEqual(4);
  for (const r of results) expect(Math.hypot(r.dx, r.dy), r.name).toBeLessThanOrEqual(3);
  await ctx.close();
});
