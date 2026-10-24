import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buildExpandedImagePreview, resolveMarkdownMediaPreview } from "./ExpandedImagePreview";

describe("resolveMarkdownMediaPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["t3code:", "https:"],
    ["t3code-dev:", "https:"],
    ["http:", "http:"],
    ["https:", "https:"],
  ])(
    "resolves protocol-relative media on %s without changing its source",
    async (pageProtocol, mediaProtocol) => {
      vi.stubGlobal("window", { location: { protocol: pageProtocol } });
      const source = "//cdn.example.com/recording.mp4?token=a%2FB&v=1#t=2";
      const preview = await resolveMarkdownMediaPreview({
        source,
        createAssetUrl: async () => {
          throw new Error("Remote media must not request a local asset URL.");
        },
      });

      expect(preview?.images[0]).toMatchObject({
        src: `${mediaProtocol}${source}`,
        originalUrl: source,
        actionsSource: {
          src: `${mediaProtocol}${source}`,
          reference: { kind: "url", url: source },
        },
      });
    },
  );
});

describe("buildExpandedImagePreview", () => {
  it("restores image annotations and identifies reply attachments separately from sent images", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", { type: "image/png" });
    const attachment = {
      type: "image" as const,
      id: "screen-1",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: "blob:screen",
      annotations: [
        { id: "circle-1", x: 0.1, y: 0.2, width: 0.3, height: 0.4, comment: "Change this." },
      ],
    };
    expect(
      buildExpandedImagePreview([{ ...attachment, file }], attachment.id, { fromComposer: true })
        ?.images[0]?.composerImageId,
    ).toBe(attachment.id);
    expect(
      buildExpandedImagePreview([attachment], attachment.id)?.images[0]?.composerImageId,
    ).toBeUndefined();
    expect(buildExpandedImagePreview([attachment], attachment.id)?.images[0]).toMatchObject({
      src: attachment.previewUrl,
      annotations: attachment.annotations,
    });
    expect(
      buildExpandedImagePreview([{ ...attachment, file }], attachment.id)?.images[0]
        ?.composerImageId,
    ).toBeUndefined();
  });

  it("keeps MIME type for stored images without a filename extension", () => {
    const preview = buildExpandedImagePreview(
      [
        {
          type: "image",
          id: "heic-1",
          name: "photo",
          mimeType: "image/heic",
          sizeBytes: 3,
          previewUrl: "blob:heic",
        },
      ],
      "heic-1",
    );
    expect(preview?.images[0]).toMatchObject({
      name: "photo",
      mimeType: "image/heic",
      src: "blob:heic",
    });
  });
});
