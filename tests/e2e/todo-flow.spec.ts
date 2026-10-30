import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";

const E2E_COOKIE_MUTATION_OPTIONS = {
  headers: { origin: E2E_BASE_URL },
};

function localDay(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("the today view deep link lists what is due today", async ({ page }) => {
  const title = `今天交稿 ${Date.now()}`;
  const later = `下周再说 ${Date.now()}`;
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title, due_at: localDay() },
  });
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title: later, due_at: localDay(3) },
  });

  await page.goto("/projects?view=today");
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(later)).toHaveCount(0);

  await page.goto("/projects?view=upcoming");
  await expect(page.getByText(later)).toBeVisible();
});

test("a ticked memo line completes the task it scheduled", async ({ page }) => {
  const line = `写周报 ${Date.now()}`;
  const memoResponse = await page.request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: `- [ ] ${line}`, visibility: "private" },
  });
  const memo = (await memoResponse.json()) as { name: string; id: string };
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title: line, due_at: localDay(), source_memo_id: memo.name },
  });

  // The timeline card advertises the scheduled to-do.
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /待办 0\/1|To-dos 0\/1/ }),
  ).toBeVisible();

  await page.request.patch(`/api/app/memos/${memo.id}`, {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: `- [x] ${line}`, visibility: "private" },
  });
  const tasks = await page.request.get(
    `/api/app/tasks?source_memo_id=${encodeURIComponent(memo.name)}`,
  );
  const body = (await tasks.json()) as { tasks: { status: string }[] };
  expect(body.tasks[0]?.status).toBe("done");
});
