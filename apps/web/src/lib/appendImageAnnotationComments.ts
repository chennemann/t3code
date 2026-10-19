import type { ImageAnnotation } from "@t3tools/contracts";
import { formatImageAnnotationBounds } from "@t3tools/shared/composerContextReferences";

/** Adds saved comments to the outgoing text without changing the editable draft. */
export function appendImageAnnotationComments(
  prompt: string,
  images: ReadonlyArray<{ name: string; annotations?: ReadonlyArray<ImageAnnotation> }>,
) {
  const blocks = images.flatMap((image) => {
    const comments = (image.annotations ?? []).flatMap((annotation, index) => {
      const comment = annotation.comment.trim();
      const bounds = annotation.imageSize ? ` [${formatImageAnnotationBounds(annotation)}]` : "";
      return comment ? [`${index + 1}.${bounds} ${comment}`] : [];
    });
    return comments.length > 0 ? [`annotations for ${image.name}:\n${comments.join("\n")}`] : [];
  });
  return [prompt, ...blocks].filter((part) => part.length > 0).join("\n\n");
}
