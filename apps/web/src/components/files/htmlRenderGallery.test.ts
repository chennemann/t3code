// @vitest-environment jsdom

import * as NodeVM from "node:vm";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  injectHtmlRenderBootstrap,
  readHtmlRenderImageRequest,
  type HtmlRenderImage,
} from "@t3tools/shared/htmlRender";

const listeners: Array<() => void> = [];
afterEach(() => {
  for (const dispose of listeners.splice(0)) dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function bootstrap(native = false) {
  const post = vi.fn();
  const window = {
    parent: { postMessage: post },
    addEventListener: globalThis.window.addEventListener.bind(globalThis.window),
    removeEventListener: globalThis.window.removeEventListener.bind(globalThis.window),
    ...(native ? { ReactNativeWebView: { postMessage: post } } : {}),
    t3: undefined as
      | { openImages: (images: HtmlRenderImage[], index: number) => boolean }
      | undefined,
  };
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
    add(type, listener, options);
    listeners.push(() => document.removeEventListener(type, listener, options));
  });
  const html = injectHtmlRenderBootstrap("<p>gallery</p>");
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  NodeVM.runInNewContext(script, {
    window,
    document,
    navigator: { userActivation: { isActive: true } },
    setTimeout,
  });
  return {
    window,
    post,
    read: () =>
      readHtmlRenderImageRequest(
        native ? JSON.parse(post.mock.calls[0]![0]) : post.mock.calls[0]![0],
      ),
  };
}

it("opens all slides, including hidden ones, in order from the clicked slide", () => {
  document.body.innerHTML = `<div data-t3-gallery>
    <img src="https://host.test/01.png" alt="01.png" hidden>
    <img src="https://host.test/02.png" alt="02.png">
    <img src="https://host.test/03.png" alt="03.png" hidden>
    <img src="https://host.test/02.png" alt="Thumbnail duplicate">
  </div><img src="https://host.test/other.png">`;
  const { read } = bootstrap();
  document.querySelectorAll("img")[1]!.click();
  expect(read()).toMatchObject({
    index: 1,
    images: [
      { src: "https://host.test/01.png", name: "01.png" },
      { src: "https://host.test/02.png", name: "02.png" },
      { src: "https://host.test/03.png", name: "03.png" },
    ],
  });
});

it("leaves opted-out controls alone and excludes decorative images from the viewer", () => {
  document.body.innerHTML = `<div data-t3-image-viewer="off"><img src="https://host.test/logo.png"></div>
    <img src="data:image/png;base64,YQ==" alt="Screenshot">`;
  const { post, read } = bootstrap();
  document.querySelector("img")!.click();
  expect(post).not.toHaveBeenCalled();
  document.querySelectorAll("img")[1]!.click();
  expect(read()?.images).toEqual([{ src: "data:image/png;base64,YQ==", name: "Screenshot" }]);
});

it("supports virtual galleries by sending the complete supplied list over the native bridge", () => {
  const { window, read } = bootstrap(true);
  const images = [1, 2, 3].map((n) => ({ src: `https://host.test/${n}.png`, name: `${n}.png` }));
  expect(window.t3!.openImages(images, 2)).toBe(true);
  expect(read()).toMatchObject({ images, index: 2 });
});

it("lets an image's click handler supply unmounted slides without the automatic handoff replacing them", () => {
  document.body.innerHTML = '<img src="https://host.test/02.png">';
  const { window, read, post } = bootstrap();
  const images = ["01", "02", "03"].map((name) => ({ src: `https://host.test/${name}.png`, name }));
  const image = document.querySelector("img")!;
  image.addEventListener("click", () => {
    window.t3!.openImages(images, 1);
  });
  image.click();
  expect(post).toHaveBeenCalledTimes(1);
  expect(read()).toMatchObject({ images, index: 1 });
});
