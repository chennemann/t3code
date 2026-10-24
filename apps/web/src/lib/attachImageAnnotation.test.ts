import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ThreadId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ImageAnnotation,
} from "@t3tools/contracts";
import {
  useComposerDraftStore,
  partializeComposerDraftStoreState,
  COMPOSER_DRAFT_STORAGE_KEY,
  type ComposerImageAttachment,
} from "../composerDraftStore";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { setLocalStorageItem, removeLocalStorageItem } from "../hooks/useLocalStorage";
import { attachImageAnnotation } from "./attachImageAnnotation";
import { readAttachmentUpload, useAttachmentUploadStore } from "./attachmentUploadQueue";
import { attachmentContextRecord } from "./composerContextRecords";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";

const target = {
  environmentId: EnvironmentId.make("annotation-test"),
  threadId: ThreadId.make("annotation-thread"),
};
const mark: ImageAnnotation = {
  id: "circle-1",
  x: 0.1,
  y: 0.2,
  width: 0.4,
  height: 0.3,
  comment: "Make this larger.",
};
const image = (id: string): ComposerImageAttachment => {
  const file = new File([new Uint8Array([1, 2, 3])], `${id}.png`, { type: "image/png" });
  return {
    id,
    type: "image",
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  };
};
const extraUrls: string[] = [];

describe("editable image annotations", () => {
  beforeEach(() =>
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} }),
  );
  afterEach(() => {
    for (const attachment of useComposerDraftStore.getState().getComposerDraft(target)?.images ??
      [])
      URL.revokeObjectURL(attachment.previewUrl);
    for (const url of extraUrls.splice(0)) URL.revokeObjectURL(url);
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
    useAttachmentUploadStore.setState({ uploadsByImageId: {} });
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
  });

  it("attaches the original agent image with editable marks and leaves the prompt alone", async () => {
    const store = useComposerDraftStore.getState();
    const existing = image("existing");
    store.addImages(target, [existing]);
    store.setPrompt(target, "Keep the current colors.");
    const original = image("agent-screenshot");
    extraUrls.push(original.previewUrl);
    await attachImageAnnotation(target, { src: original.previewUrl, name: original.name }, [mark]);
    const draft = store.getComposerDraft(target)!;
    expect(draft.images[0]).toBe(existing);
    expect(new Uint8Array(await draft.images[1]!.file.arrayBuffer())).toEqual(
      new Uint8Array(await original.file.arrayBuffer()),
    );
    expect(draft.images[1]?.name).toBe(original.name);
    expect(draft.images[1]?.annotations).toEqual([mark]);
    expect(draft.prompt).toBe("Keep the current colors.");
  });

  it("edits at the attachment limit without changing pixels, position, prompt, or upload", async () => {
    const store = useComposerDraftStore.getState();
    const originals = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS }, (_, i) =>
      image(String(i)),
    );
    store.addImages(target, originals);
    store.setPrompt(target, "Existing feedback.");
    const original = originals[1]!;
    const upload = {
      status: "failed" as const,
      environmentId: target.environmentId,
      reason: "Previous upload failed.",
    };
    useAttachmentUploadStore.setState({ uploadsByImageId: { [original.id]: upload } });
    const source = { src: "must-not-fetch", name: original.name };
    await attachImageAnnotation(target, source, [mark], original.id);
    await attachImageAnnotation(
      target,
      source,
      [
        { ...mark, x: 0.3, comment: "Edited comment." },
        { ...mark, id: "circle-2", comment: "" },
      ],
      original.id,
    );
    const draft = store.getComposerDraft(target)!;
    expect(draft.images.map((i) => i.id)).toEqual(originals.map((i) => i.id));
    expect(draft.images[1]?.file).toBe(original.file);
    expect(draft.images[1]?.previewUrl).toBe(original.previewUrl);
    expect(draft.images[0]).toBe(originals[0]);
    expect(draft.images[1]?.annotations).toMatchObject([
      { id: mark.id, x: 0.3, comment: "Edited comment." },
      { id: "circle-2", comment: "" },
    ]);
    expect(draft.prompt).toBe("Existing feedback.");
    expect(readAttachmentUpload(original.id)).toBe(upload);
    expect((await fetch(original.previewUrl)).ok).toBe(true);
  });

  it("persists the latest geometry and comments across reload, even if image serialization was already in flight", async () => {
    const store = useComposerDraftStore.getState();
    const original = image("original");
    store.addImages(target, [original]);
    await attachImageAnnotation(
      target,
      { src: original.previewUrl, name: original.name },
      [mark],
      original.id,
    );
    const serializedImage = {
      id: original.id,
      name: original.name,
      mimeType: original.mimeType,
      sizeBytes: original.sizeBytes,
      dataUrl: "data:image/png;base64,AQID",
    };
    // The byte serializer started before the mark was saved. Its storage receipt confirms the image id only.
    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      {
        version: useComposerDraftStore.persist.getOptions().version,
        state: {
          ...partializeComposerDraftStoreState(useComposerDraftStore.getState()),
          draftsByThreadKey: {
            [scopedThreadKey(target)]: { prompt: "", attachments: [serializedImage] },
          },
        },
      },
      Schema.Unknown,
    );
    await store.syncPersistedAttachments(target, [serializedImage]);
    const persisted = JSON.parse(
      JSON.stringify(partializeComposerDraftStoreState(useComposerDraftStore.getState())),
    );
    const reloaded = useComposerDraftStore.persist.getOptions().merge!(
      persisted,
      useComposerDraftStore.getInitialState(),
    );
    const restored = Object.values(reloaded.draftsByThreadKey)[0];
    expect(restored?.images[0]?.annotations).toEqual([mark]);
    expect(new Uint8Array(await restored!.images[0]!.file.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("sends numbered regions and comments to the provider without inserting them into the user's text", async () => {
    const store = useComposerDraftStore.getState();
    const original = image("original");
    store.addImages(target, [original]);
    await attachImageAnnotation(
      target,
      { src: original.previewUrl, name: original.name },
      [mark],
      original.id,
    );
    const draft = store.getComposerDraft(target)!;
    const record = attachmentContextRecord({
      attachment: draft.images[0]!,
      attachmentId: "uploaded-original",
    });
    const projected = projectComposerContextForProvider({
      text: "Please make these changes.",
      records: [record],
    });
    expect(draft.prompt).toBe("");
    expect(projected).toContain("attachmentId: uploaded-original");
    expect(projected).toContain("1. x=0.1, y=0.2, width=0.4, height=0.3");
    expect(projected).toContain("Make this larger.");
  });

  it("clears all marks without removing the attachment", async () => {
    const store = useComposerDraftStore.getState();
    const original = image("original");
    store.addImages(target, [original]);
    const source = { src: original.previewUrl, name: original.name };
    await attachImageAnnotation(target, source, [mark], original.id);
    await attachImageAnnotation(target, source, [], original.id);
    expect(store.getComposerDraft(target)?.images).toHaveLength(1);
    expect(store.getComposerDraft(target)?.images[0]?.annotations).toEqual([]);
  });

  it("does not attach a removed image again", async () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(target, "Existing feedback.");
    const before = store.getComposerDraft(target);
    await expect(
      attachImageAnnotation(
        target,
        { src: "must-not-fetch", name: "image.png" },
        [mark],
        "removed",
      ),
    ).rejects.toThrow("no longer attached");
    expect(store.getComposerDraft(target)).toBe(before);
    await attachImageAnnotation(
      target,
      { src: "must-not-fetch", name: "image.png" },
      [],
      "removed",
    );
    expect(store.getComposerDraft(target)).toBe(before);
  });
});
