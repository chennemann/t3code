import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type ImageAnnotation } from "@t3tools/contracts";
import { useComposerDraftStore, type ComposerThreadTarget } from "../composerDraftStore";
import { dataUrlToFile, prepareImageForAttachment } from "./imageCompression";
import { randomUUID } from "./utils";

/** Save editable marks beside the original bytes, without changing the prompt or its uploads. */
export async function attachImageAnnotation(
  target: ComposerThreadTarget,
  source: { src: string; name: string; burnedAnnotationCount?: number | undefined },
  annotations: ReadonlyArray<ImageAnnotation>,
  composerImageId?: string | undefined,
) {
  const store = useComposerDraftStore.getState();
  if (composerImageId) {
    if (!store.setImageAnnotations(target, composerImageId, annotations)) {
      if (annotations.length === 0) return;
      throw new Error(
        "This image is no longer attached to the reply. Delete its annotations to close this view, or restore the attachment.",
      );
    }
    return composerImageId;
  }
  if (annotations.length === 0) return;
  let file: File;
  const embedded = /^data:(image\/[^;,]+)(?:;[^,]*)?,/i.exec(source.src);
  if (embedded) {
    // Desktop permits displaying data URLs, but connect-src blocks fetching them.
    try {
      const mimeType = embedded[1]!;
      file = /;base64,$/i.test(embedded[0])
        ? dataUrlToFile(source.src, source.name, mimeType)
        : new File([decodeURIComponent(source.src.slice(embedded[0].length))], source.name, {
            type: mimeType,
          });
    } catch (cause) {
      throw new Error("The embedded image could not be decoded. Reopen it and try again.", {
        cause,
      });
    }
  } else {
    const response = await fetch(source.src, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok)
      throw new Error("The original image could not be attached. Try opening it again.");
    const blob = await response.blob();
    file = new File([blob], source.name, { type: blob.type });
  }
  const prepared = await prepareImageForAttachment(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
  if (!prepared.ok) throw new Error("The original image could not be prepared for attachment.");
  const image = {
    type: "image" as const,
    id: randomUUID(),
    name: prepared.file.name,
    mimeType: prepared.file.type,
    sizeBytes: prepared.file.size,
    file: prepared.file,
    previewUrl: URL.createObjectURL(prepared.file),
    annotations: annotations.map((mark) => ({ ...mark })),
    ...(source.burnedAnnotationCount
      ? { burnedAnnotationCount: source.burnedAnnotationCount }
      : {}),
  };
  if (!store.addImages(target, [image], { allowDuplicates: true }).includes(image.id)) {
    URL.revokeObjectURL(image.previewUrl);
    throw new Error("There is no room for another image. Remove an attachment and try again.");
  }
  return image.id;
}
