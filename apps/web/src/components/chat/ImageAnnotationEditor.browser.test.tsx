import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import "~/index.css";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";

vi.mock("~/lib/observeResize", () => ({
  observeResize: (_element: Element, callback: ResizeObserverCallback) => {
    callback(
      [{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    return () => {};
  },
}));

const draft = vi.fn();
const save = vi.fn().mockResolvedValue(undefined);

function editor(action: "zoom" | "annotate") {
  draft.mockClear();
  save.mockClear();
  const canvas = document.createElement("canvas");
  canvas.width = 2000;
  canvas.height = 1000;
  return (
    <ImageAnnotationEditor
      src={canvas.toDataURL("image/png")}
      name="screenshot.png"
      initialAction={action}
      onApply={save}
      onDraftChange={draft}
      onBusyChange={() => {}}
      onDiscard={() => {}}
    />
  );
}

async function load(container: HTMLElement) {
  await vi.waitFor(() => expect(container.querySelector("img")?.naturalWidth).toBe(2000));
  await vi.waitFor(() => expect(container.querySelector("svg[aria-label]")).not.toBeNull());
  return container.querySelector<HTMLElement>('[role="region"]')!;
}

async function pointer(element: Element, type: string, x: number, y: number, ctrlKey = false) {
  const event = new PointerEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    button: 0,
    ctrlKey,
  });

  await act(() => element.dispatchEvent(event));
}

it("draws and saves a source-pixel rectangle with Ctrl while zoomed and panned", async () => {
  await using screen = await render(editor("zoom"), { router: false });
  using _capture = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  using _release = vi
    .spyOn(Element.prototype, "releasePointerCapture")
    .mockImplementation(() => {});
  const container = screen.container;
  const viewport = await load(container);
  await act(() => viewport.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(container.textContent).toContain("200%");
  const svg = container.querySelector("svg[aria-label]")!;
  // The image is twice its fit size, with its top-left scrolled out of view.
  using _bounds = vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: -200,
    top: -50,
    width: 1152,
    height: 576,
  } as DOMRect);
  await pointer(svg, "pointerdown", 88, 94, true);
  await pointer(svg, "pointermove", 376, 238, true);
  await pointer(svg, "pointerup", 376, 238, true);
  expect(draft.mock.lastCall?.[0]).toEqual([
    expect.objectContaining({
      x: 0.25,
      y: 0.25,
      width: 0.25,
      height: 0.25,
      imageSize: { width: 2000, height: 1000 },
    }),
  ]);
  expect(svg.querySelector("ellipse")).toBeNull();
  expect(svg.querySelector("rect")?.getAttribute("width")).toBe("500");
  await act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close annotation editor"]')!.click(),
  );
  expect(save.mock.lastCall?.[0].annotations[0]).toMatchObject({
    imageSize: { width: 2000, height: 1000 },
  });
  expect(container.textContent).toContain("200%");
});

it("temporarily zooms and pans with Ctrl in annotation mode without creating marks", async () => {
  await using screen = await render(editor("annotate"), { router: false });
  using _capture = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  using _release = vi
    .spyOn(Element.prototype, "releasePointerCapture")
    .mockImplementation(() => {});
  const container = screen.container;
  const viewport = await load(container);
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: -Math.log(2) / 0.002,
    ctrlKey: true,
  });
  await act(() => viewport.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true);
  expect(container.textContent).toContain("200%");
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  await pointer(viewport, "pointerdown", 100, 100, true);
  await pointer(viewport, "pointermove", 40, 70, true);
  await pointer(viewport, "pointerup", 40, 70, true);
  expect(viewport.scrollLeft).toBe(60);
  expect(viewport.scrollTop).toBe(30);
  expect(container.querySelector('[aria-label="Comment 1"]')).toBeNull();
  const svg = container.querySelector("svg[aria-label]")!;
  using _bounds = vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: -60,
    top: -30,
    width: 1152,
    height: 576,
  } as DOMRect);
  await pointer(svg, "pointerdown", 228, 114);
  await pointer(svg, "pointermove", 516, 258);
  await pointer(svg, "pointerup", 516, 258);
  expect(draft.mock.lastCall?.[0][0]).toMatchObject({
    x: 0.25,
    y: 0.25,
    width: 0.25,
    height: 0.25,
  });
  expect(container.textContent).toContain("200%");
});
