import { expect, test, type Page } from "@playwright/test";

async function enter(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("이름", { exact: true }).fill(name);
  await page.getByRole("button", { name: "시작" }).click();
  await expect(page.getByLabel("장소 검색")).toBeVisible();
}

test("가계부 정산 · 체크리스트 · 장소 대화", async ({ browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString().slice(-5);
  const mk = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const a = await (await mk()).newPage();
  const b = await (await mk()).newPage();
  await enter(a, `가${stamp}`);
  await enter(b, `나${stamp}`);

  // A pays 30,000 split with B
  await a.goto("/expenses");
  await a.getByRole("button", { name: "기록" }).click();
  await a.getByLabel("금액").fill("30000");
  await a.getByLabel("내용").fill(`KTX${stamp}`);
  const split = a.getByRole("dialog").getByRole("button", { name: new RegExp(`나${stamp}`) }).last();
  await split.click();
  await a.getByRole("button", { name: /30,000원 저장/ }).click();
  await expect(a.getByText(`KTX${stamp}`)).toBeVisible();
  await a.getByRole("tab", { name: "정산" }).click();
  await expect(a.getByText(new RegExp(`나${stamp}.*가${stamp}`)).first()).toBeVisible();

  // B sees the transfer they owe
  await b.goto("/expenses");
  await expect(b.getByText(`KTX${stamp}`)).toBeVisible();

  // checklist: unique item, checked by the partner, visible to both
  await a.goto("/checklist");
  await a.getByLabel("항목 추가").fill(`우산${stamp}`);
  await a.getByLabel("항목 추가").press("Enter");
  await expect(a.getByRole("button", { name: `우산${stamp}` })).toBeVisible();
  await b.goto("/checklist");
  await b.getByRole("button", { name: `우산${stamp}` }).click();
  await a.reload();
  await expect(a.getByText(`나${stamp} 완료`).first()).toBeVisible();

  // comment on a place, visible to the partner
  await a.goto("/wishlist");
  await a.getByText("광안리").first().click();
  await a.getByLabel("댓글").fill(`야경 보자 ${stamp}`);
  await a.getByRole("button", { name: "보내기" }).click();
  await expect(a.getByText(`야경 보자 ${stamp}`)).toBeVisible();
  await b.goto("/wishlist");
  await b.getByText("광안리").first().click();
  await expect(b.getByText(`야경 보자 ${stamp}`)).toBeVisible();
});
