import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { ExpandedImageDialog } from "./ExpandedImageDialog";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/attachImageAnnotation", () => ({ attachImageAnnotation: mocks.save }));

const mark = {
  id: "mark",
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.2,
  comment: "First image comment",
};

// Real pixels so each image loads and reaches the annotation editor.
function imageSource(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 8, 8);
  return canvas.toDataURL("image/png");
}

function setup() {
  mocks.save.mockReset().mockResolvedValue("saved-attachment");
  const close = vi.fn();
  const dialog = (
    <ExpandedImageDialog
      preview={{
        images: [
          { src: imageSource("red"), name: "01.png", annotations: [mark] },
          { src: imageSource("green"), name: "02.png" },
          { src: imageSource("blue"), name: "03.png" },
        ],
        index: 0,
      }}
      composerTarget={{
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
      }}
      onClose={close}
    />
  );
  return { close, dialog };
}

const image = (name: string) => page.getByRole("img", { name, exact: true });

// Browser tests load no app CSS, so the dialog's fixed inert backdrop covers its
// unstyled popup and pointer clicks never reach it; click through the DOM instead.
async function click(name: string | RegExp) {
  const button = page.getByRole("button", { name, exact: typeof name === "string" });
  await expect.element(button).toBeInTheDocument();
  await act(() => (button.element() as HTMLButtonElement).click());
}

async function startEditing() {
  await click(/Edit annotations/);
  await expect.element(page.getByLabelText("Image annotation editor")).toBeInTheDocument();
}

it("saves edited annotations before moving and restores each image's draft on wraparound", async () => {
  const { close, dialog } = setup();
  await using _screen = await render(dialog);
  await startEditing();
  await click("Delete annotation 1");
  await click("Next media");
  await expect.element(image("02.png")).toBeInTheDocument();
  expect(mocks.save).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ name: "01.png" }),
    [],
    undefined,
  );
  await expect.element(page.getByLabelText("Image annotation editor")).toBeInTheDocument();
  await click("Next media");
  await expect.element(image("03.png")).toBeInTheDocument();
  await click("Next media");
  await expect.element(image("01.png")).toBeInTheDocument();
  await expect.element(page.getByLabelText("Comment 1")).not.toBeInTheDocument();
  await click("Previous media");
  await expect.element(image("03.png")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it("keeps the current image and edits when saving fails, then allows retry", async () => {
  const { close, dialog } = setup();
  await using _screen = await render(dialog);
  await startEditing();
  await click("Delete annotation 1");
  mocks.save.mockRejectedValueOnce(new Error("No room for another attachment"));
  await click("Next media");
  await expect.element(page.getByRole("alert")).toHaveTextContent("No room for another attachment");
  await expect.element(image("01.png")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  await click("Next media");
  await expect.element(image("02.png")).toBeInTheDocument();
});

it("lets the reader discard unsaved edits after a fetch error and continue without reloading", async () => {
  const { close, dialog } = setup();
  await using _screen = await render(dialog);
  await startEditing();
  await click("Delete annotation 1");
  mocks.save.mockRejectedValue(new TypeError("Failed to fetch"));
  await click("Next media");
  await expect.element(page.getByRole("alert")).toHaveTextContent("Failed to fetch");
  await click(/Discard unsaved changes/);
  await expect.element(page.getByLabelText("Image annotation editor")).not.toBeInTheDocument();
  await expect
    .poll(
      () => document.querySelector('[aria-label="Saved annotation comments"]')?.textContent ?? "",
    )
    .toContain(mark.comment);
  await click("Next media");
  await expect.element(image("02.png")).toBeInTheDocument();
  await click("Close image preview");
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledOnce();
});
