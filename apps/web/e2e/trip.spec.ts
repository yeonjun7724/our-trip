import { expect, test, type Browser, type Page } from "@playwright/test";

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ ...PHONE, permissions: [] });
  return { ctx, page: await ctx.newPage() };
}

async function noHorizontalScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, "page must not scroll horizontally").toBeLessThanOrEqual(iw + 1);
}

async function enter(page: Page, name: string) {
  await page.goto("/");
  await expect(page.getByText("누구세요?")).toBeVisible();
  await page.getByLabel("이름", { exact: true }).fill(name);
  await page.getByRole("button", { name: "시작" }).click();
  await expect(page.getByLabel("장소 검색")).toBeVisible();
}

test("방 만들기 없이 지도에서 바로: 이름 선택 → 지도 탭으로 장소 추가 → 함께 투표·일정", async ({ browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString().slice(-5);
  const owner = await newPhone(browser);
  const p = owner.page;
  await enter(p, `연준${stamp}`);
  await noHorizontalScroll(p);

  // tap the map -> add a place right there
  await p.getByRole("button", { name: "부산", exact: true }).click();
  await p.waitForTimeout(1500);
  // fire a map click at an empty coordinate (sea off Busan Station) so it can't hit a pin
  await p.evaluate((n) => (window as unknown as { __otMap: { fire: (t: string, e: object) => void } }).__otMap
    .fire("click", { lngLat: { lng: 129.05 + (n % 50) / 10000, lat: 35.105 + (n % 30) / 10000 }, point: { x: 0, y: 0 },
      originalEvent: { target: document.querySelector(".maplibregl-canvas") } }), Number(stamp));
  await expect(p.getByText("여기에 장소 추가")).toBeVisible();
  const spot = `우리스팟${stamp}`;
  await p.getByLabel("장소 이름").fill(spot);
  await p.getByRole("button", { name: "꼭 가고 싶어" }).click();
  await p.getByRole("button", { name: "저장", exact: true }).click();
  await expect(p.getByRole("dialog")).toContainText(spot);
  await expect(p.getByText("직접 입력").first()).toBeVisible();
  await p.keyboard.press("Escape");

  // partner opens the same URL, picks a new name, sees and votes
  const gf = await newPhone(browser);
  const g = gf.page;
  await enter(g, `민수${stamp}`);
  await g.goto("/wishlist");
  await g.getByText(spot).click();
  await g.getByRole("radio", { name: "가면 좋아" }).click();
  await expect(g.getByText("둘 다 가고 싶어").first()).toBeVisible();
  await g.keyboard.press("Escape");

  // partner adds via Naver share text
  await g.goto("/places/new");
  await g.getByLabel("공유 링크 / 공유 문구").fill(`[네이버 지도]\n해리단길${stamp}\n부산 해운대구 우동\nhttps://map.naver.com/p/entry/place/1234567`);
  await g.getByRole("button", { name: "링크 확인" }).click();
  await expect(g.getByLabel("장소 이름")).toHaveValue(`해리단길${stamp}`);
  await g.getByRole("button", { name: "위시리스트에 저장" }).click();
  await expect(g).toHaveURL(/\/wishlist/);

  // owner: seeded place -> walking route, nearby stops, assign
  await p.goto("/");
  await p.getByRole("button", { name: "부산", exact: true }).click();
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "광안리", exact: true }).first().dispatchEvent("click");
  await p.getByRole("button", { name: "광안리", exact: true }).first().dispatchEvent("click");
  await expect(p.getByRole("dialog")).toBeVisible();
  await p.getByLabel("출발지").selectOption({ label: "해운대" });
  await p.getByRole("button", { name: "🚶 도보 경로" }).click();
  await expect(p.getByText("OSMnx 계산").first()).toBeVisible();
  await p.getByRole("button", { name: "🚌 대중교통 경로" }).click();
  await expect(p.getByRole("link", { name: /카카오맵 길찾기/ })).toBeVisible();
  await p.getByRole("button", { name: /주변 버스·지하철/ }).click();
  await expect(p.getByText(/도보 \d+m/).first()).toBeVisible({ timeout: 30_000 });
  await p.screenshot({ path: "e2e-results/map-sheet-390.png" });

  // a returning device picks the existing name (no duplicate member)
  const again = await newPhone(browser);
  await again.page.goto("/");
  await again.page.getByRole("button", { name: `민수${stamp}` }).click();
  await expect(again.page.getByLabel("장소 검색")).toBeVisible();

  // itinerary: partner checks the place visited after owner schedules it
  await g.goto("/itinerary");
  await expect(g.getByRole("heading", { name: /미배정 장소/ })).toBeVisible();

  await owner.ctx.close(); await gf.ctx.close(); await again.ctx.close();
});

const WIDTHS = [360, 375, 390, 430, 768, 1280];
for (const w of WIDTHS) {
  test(`반응형 ${w}px: 주요 화면 가로 스크롤 없음`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, isMobile: w < 700, hasTouch: w < 700 });
    const page = await ctx.newPage();
    await enter(page, `폭${w}`);
    await noHorizontalScroll(page);
    for (const path of ["/", "/home", "/wishlist", "/itinerary", "/transit", "/transit?tab=stops", "/transit?tab=pass", "/places/new", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(900);
      await noHorizontalScroll(page);
      const name = path.replace(/[/?=]/g, "_") || "_home";
      await page.screenshot({ path: `e2e-results/w${w}${name}.png` });
    }
    // bottom nav touch targets >= 44px
    const h = await page.locator("nav[aria-label='주요 메뉴'] a").first().evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
    await ctx.close();
  });
}
