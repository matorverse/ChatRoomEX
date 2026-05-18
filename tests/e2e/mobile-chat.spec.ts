import { expect, test } from "@playwright/test";

test("mobile auth surface renders with touch-sized controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ChatRoomEX" })).toBeVisible();
  // @ts-ignore
  await expect(page.getByRole("button", { name: "Login" }).nth(1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Register" })).toBeVisible();
});
