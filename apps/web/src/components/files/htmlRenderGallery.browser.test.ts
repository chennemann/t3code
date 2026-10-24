import { expect, it, vi } from "vite-plus/test";
import {
  injectHtmlRenderBootstrap,
  readHtmlRenderImageGallery,
  type HtmlRenderImage,
} from "@t3tools/shared/htmlRender";

/**
 * Runs the page bootstrap against the real document with a stub `window`, so
 * posted messages are observable. Document listeners are removed on dispose.
 */
function bootstrap(native = false) {
  const post = vi.fn();
  const windowListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
  const documentListeners: Array<[string, EventListenerOrEventListenerObject, unknown]> = [];
  const pageWindow = {
    parent: { postMessage: post },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      windowListeners.push([type, listener]);
      window.addEventListener(type, listener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      window.removeEventListener(type, listener),
    ...(native ? { ReactNativeWebView: { postMessage: post } } : {}),
    t3: undefined as
      | { openImages: (images: HtmlRenderImage[], index: number) => boolean }
      | undefined,
  };
  const pageDocument = new Proxy(document, {
    get(target, property) {
      if (property === "addEventListener") {
        return (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) => {
          documentListeners.push([type, listener, options]);
          target.addEventListener(type, listener, options);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const html = injectHtmlRenderBootstrap("<p>gallery</p>");
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  // Runs the page script with a stubbed window in place of the frame's own.
  new Function("window", "document", "navigator", "setTimeout", script)(
    pageWindow,
    pageDocument,
    { userActivation: { isActive: true } },
    setTimeout,
  );
  return {
    window: pageWindow,
    post,
    read: () =>
      readHtmlRenderImageGallery(
        native ? JSON.parse(post.mock.calls[0]![0]) : post.mock.calls[0]![0],
      ),
    [Symbol.dispose]: () => {
      for (const [type, listener] of windowListeners) window.removeEventListener(type, listener);
      for (const [type, listener, options] of documentListeners) {
        document.removeEventListener(type, listener, options as boolean | EventListenerOptions);
      }
      document.body.replaceChildren();
    },
  };
}

it("opens all slides, including hidden ones, in order from the clicked slide", () => {
  document.body.innerHTML = `<div data-t3-gallery>
    <img src="https://host.test/01.png" alt="01.png" hidden>
    <img src="https://host.test/02.png" alt="02.png">
    <img src="https://host.test/03.png" alt="03.png" hidden>
    <img src="https://host.test/02.png" alt="Thumbnail duplicate">
  </div><img src="https://host.test/other.png">`;
  using page = bootstrap();
  document.querySelectorAll("img")[1]!.click();
  expect(page.read()).toMatchObject({
    index: 1,
    images: [
      { src: "https://host.test/01.png", name: "01.png" },
      { src: "https://host.test/02.png", name: "02.png" },
      { src: "https://host.test/03.png", name: "03.png" },
    ],
  });
});

it("leaves opted-out images alone and excludes decorative images from the viewer", () => {
  document.body.innerHTML = `<div data-t3-image-viewer="off"><img src="https://host.test/logo.png"></div>
    <img src="data:image/png;base64,YQ==" alt="Screenshot">`;
  using page = bootstrap();
  document.querySelector("img")!.click();
  expect(page.post).not.toHaveBeenCalled();
  document.querySelectorAll("img")[1]!.click();
  expect(page.read()?.images).toEqual([{ src: "data:image/png;base64,YQ==", name: "Screenshot" }]);
});

it("supports virtual galleries by sending the complete supplied list over the native bridge", () => {
  using page = bootstrap(true);
  const images = [1, 2, 3].map((n) => ({ src: `https://host.test/${n}.png`, name: `${n}.png` }));
  expect(page.window.t3!.openImages(images, 2)).toBe(true);
  expect(page.read()).toMatchObject({ images, index: 2 });
});

it("lets an image's click handler supply unmounted slides without the automatic handoff replacing them", () => {
  document.body.innerHTML = '<img src="https://host.test/02.png">';
  using page = bootstrap();
  const images = ["01", "02", "03"].map((name) => ({ src: `https://host.test/${name}.png`, name }));
  const image = document.querySelector("img")!;
  image.addEventListener("click", () => {
    page.window.t3!.openImages(images, 1);
  });
  image.click();
  expect(page.post).toHaveBeenCalledTimes(1);
  expect(page.read()).toMatchObject({ images, index: 1 });
});
