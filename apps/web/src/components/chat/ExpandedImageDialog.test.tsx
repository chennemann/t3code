// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ExpandedImageDialog } from "./ExpandedImageDialog";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/attachImageAnnotation", () => ({ attachImageAnnotation: save }));

let root: Root;
let container: HTMLDivElement;
const close = vi.fn();
const mark = {
  id: "mark",
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.2,
  comment: "First image comment",
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  save.mockReset().mockResolvedValue("saved-attachment");
  close.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(
      <ExpandedImageDialog
        preview={{
          images: [
            { src: "https://host.test/01.png", name: "01.png", annotations: [mark] },
            { src: "https://host.test/02.png", name: "02.png" },
            { src: "https://host.test/03.png", name: "03.png" },
          ],
          index: 0,
        }}
        composerTarget={{
          environmentId: EnvironmentId.make("environment"),
          threadId: ThreadId.make("thread"),
        }}
        onClose={close}
      />,
    ),
  );
  const annotate = Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Edit annotations"),
  )!;
  await act(() => annotate.click());
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  await act(() => button.click());
}

it("saves edited annotations before moving and restores each image's draft on wraparound", async () => {
  await click("Delete annotation 1");
  await click("Next media");
  expect(save).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ name: "01.png" }),
    [],
    undefined,
  );
  expect(document.querySelector('img[alt="02.png"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Image annotation editor"]')).not.toBeNull();
  await click("Next media");
  expect(document.querySelector('img[alt="03.png"]')).not.toBeNull();
  await click("Next media");
  expect(document.querySelector('img[alt="01.png"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Comment 1"]')).toBeNull();
  await click("Previous media");
  expect(document.querySelector('img[alt="03.png"]')).not.toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
});

it("keeps the current image and edits when saving fails, then allows retry", async () => {
  const image = document.querySelector<HTMLImageElement>('img[alt="01.png"]')!;
  await act(() => image.dispatchEvent(new Event("load")));
  await click("Delete annotation 1");
  save.mockRejectedValueOnce(new Error("No room for another attachment"));
  await click("Next media");
  expect(document.querySelector('img[alt="01.png"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "No room for another attachment",
  );
  expect(close).not.toHaveBeenCalled();
  await click("Next media");
  expect(document.querySelector('img[alt="02.png"]')).not.toBeNull();
});
