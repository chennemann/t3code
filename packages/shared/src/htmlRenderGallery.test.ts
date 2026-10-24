import { describe, expect, it } from "vite-plus/test";

import { readHtmlRenderImageGallery } from "./htmlRenderGallery.ts";

describe("readHtmlRenderImageGallery", () => {
  const images = [
    { src: "data:image/png;base64,YQ==", name: "01.png" },
    { src: "https://host.test/02.png", name: "02.png" },
    { src: "https://host.test/03.png", name: "03.png" },
  ];
  const notification = (params: unknown) => ({
    jsonrpc: "2.0",
    method: "t3/notifications/open-image",
    params,
  });

  it("retains the full ordered gallery and starts at the clicked image", () => {
    expect(readHtmlRenderImageGallery(notification({ ...images[1], images, index: 1 }))).toEqual({
      images,
      index: 1,
    });
  });

  it("opens a plain single-image notification as a one-image gallery", () => {
    expect(
      readHtmlRenderImageGallery(notification({ src: "https://host.test/a.png", name: "" })),
    ).toEqual({ images: [{ src: "https://host.test/a.png", name: "Image" }], index: 0 });
  });

  it.each([-1, 3, 0.5, Number.NaN, "1", undefined])(
    "rejects invalid selected index %s",
    (index) => {
      expect(readHtmlRenderImageGallery(notification({ images, index }))).toBeUndefined();
    },
  );

  it.each([
    "file:///secret.png",
    "C:/secret.png",
    "javascript:alert(1)",
    "data:text/html,hi",
    "blob:other-frame",
  ])("rejects an unsupported image source without changing the gallery: %s", (src) => {
    expect(
      readHtmlRenderImageGallery(
        notification({ images: [images[0], { src, name: "bad" }], index: 0 }),
      ),
    ).toBeUndefined();
  });

  it.each([null, {}, [], [{ src: "https://host.test/a.png" }], Array(201).fill(images[0])])(
    "rejects an invalid gallery",
    (gallery) => {
      expect(
        readHtmlRenderImageGallery(notification({ images: gallery, index: 0 })),
      ).toBeUndefined();
    },
  );
});
