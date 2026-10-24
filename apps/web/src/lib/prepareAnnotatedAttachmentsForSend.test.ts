import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ComposerImageAttachment, ComposerFileAttachment } from "../composerDraftStore";
import { prepareAnnotatedAttachmentsForSend } from "./prepareAnnotatedAttachmentsForSend";
import { renderImageAnnotations } from "./renderImageAnnotations";
import { attachmentContextRecord } from "./composerContextRecords";

vi.mock("./renderImageAnnotations", () => ({ renderImageAnnotations: vi.fn() }));
const mark = {
  id: "circle-1",
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  comment: "Make this larger.",
};
const original = (): ComposerImageAttachment => {
  const file = new File([new Uint8Array([1, 2, 3])], "original.png", { type: "image/png" });
  return {
    type: "image",
    id: "original",
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: "blob:original",
    file,
    annotations: [mark],
  };
};
const rendered = new File([new Uint8Array([4, 5, 6])], "original-annotated.png", {
  type: "image/png",
});

beforeEach(() => vi.mocked(renderImageAnnotations).mockReset().mockResolvedValue(rendered));
afterEach(() => vi.restoreAllMocks());

describe("prepare annotated attachments for sending", () => {
  it("uses a fresh rendered upload while preserving the editable draft and unrelated attachments", async () => {
    const source = Object.freeze(original());
    const plain = { ...original(), id: "plain", annotations: [] };
    const file: ComposerFileAttachment = {
      type: "file",
      id: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      file: new File(["a"], "notes.txt"),
    };
    const result = await prepareAnnotatedAttachmentsForSend([plain, source, file]);
    expect(result[0]).toBe(plain);
    expect(result[2]).toBe(file);
    expect(result[1]?.id).not.toBe(source.id);
    expect(result[1]?.file).toBe(rendered);
    expect(result[1]).toMatchObject({
      name: rendered.name,
      mimeType: "image/png",
      sizeBytes: rendered.size,
      annotations: [mark],
      burnedAnnotationCount: 1,
    });
    expect(source.file).not.toBe(rendered);
    expect(source.previewUrl).toBe("blob:original");
    expect(source.burnedAnnotationCount).toBeUndefined();
    const context = attachmentContextRecord({
      attachment: { ...result[1]!, id: source.id },
      attachmentId: "rendered-upload",
    });
    expect(context).toMatchObject({
      contextId: "image_original",
      attachmentId: "rendered-upload",
      burnedAnnotationCount: 1,
      annotations: [mark],
    });
  });

  it("only burns new circles onto a flattened snapshot and continues its numbering", async () => {
    const source = {
      ...original(),
      burnedAnnotationCount: 1,
      annotations: [mark, { ...mark, id: "circle-2", comment: "New request." }],
    };
    const result = await prepareAnnotatedAttachmentsForSend([source]);
    expect(renderImageAnnotations).toHaveBeenCalledWith(source.file, [source.annotations[1]], 1);
    expect(result[0]).toMatchObject({ burnedAnnotationCount: 2, annotations: source.annotations });
    const unchanged = { ...source, burnedAnnotationCount: 2 };
    expect((await prepareAnnotatedAttachmentsForSend([unchanged]))[0]).toBe(unchanged);
  });

  it("leaves draft pixels and marks available when rendering fails, so a retry renders again", async () => {
    const source = original();
    vi.mocked(renderImageAnnotations).mockRejectedValueOnce(
      new Error("Image could not be decoded."),
    );
    await expect(prepareAnnotatedAttachmentsForSend([source])).rejects.toThrow("decoded");
    expect(source.annotations).toEqual([mark]);
    expect(new Uint8Array(await source.file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const retried = await prepareAnnotatedAttachmentsForSend([source]);
    expect(retried[0]?.file).toBe(rendered);
    expect(retried[0]?.id).not.toBe(source.id);
  });
});
