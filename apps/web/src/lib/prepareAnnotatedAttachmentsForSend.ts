import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_TOTAL_IMAGE_BYTES,
} from "@t3tools/contracts";
import type { ComposerImageAttachment, ComposerFileAttachment } from "../composerDraftStore";
import { prepareImageForAttachment } from "./imageCompression";
import { renderImageAnnotations } from "./renderImageAnnotations";
import { randomUUID } from "./utils";
import { resizeSnapShotSource } from "./snapShotSource";

/** Fresh upload ids prevent the original image's cached upload from replacing the rendered copy. */
export async function prepareAnnotatedAttachmentsForSend(
  attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
) {
  const result: Array<ComposerImageAttachment | ComposerFileAttachment> = [];
  let totalImageBytes = 0;
  // Decode one image at a time to avoid holding several full-resolution bitmaps in memory.
  for (const attachment of attachments) {
    if (attachment.type !== "image" || !attachment.annotations?.length) {
      result.push(attachment);
      continue;
    }
    const offset = attachment.burnedAnnotationCount ?? 0;
    const marks = attachment.annotations.slice(offset);
    if (!marks.length) {
      result.push(attachment);
      continue;
    }
    const rendered = await renderImageAnnotations(attachment.file, marks, offset);
    const prepared = await prepareImageForAttachment(rendered, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
    if (!prepared.ok)
      throw new Error(`Annotations on '${attachment.name}' could not be prepared for sending.`);
    result.push({
      ...attachment,
      id: randomUUID(),
      name: prepared.file.name,
      mimeType: prepared.file.type,
      sizeBytes: prepared.file.size,
      file: prepared.file,
      ...(attachment.source
        ? { source: resizeSnapShotSource(attachment.source, prepared.imageSize) }
        : {}),
      burnedAnnotationCount: attachment.annotations.length,
    });
  }
  for (const attachment of result)
    if (attachment.type === "image") totalImageBytes += attachment.sizeBytes;
  if (totalImageBytes > PROVIDER_SEND_TURN_MAX_TOTAL_IMAGE_BYTES)
    throw new Error(
      "The annotated images exceed the message image size limit. Remove an image and try again.",
    );
  return result;
}
