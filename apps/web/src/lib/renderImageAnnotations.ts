import type { ImageAnnotation } from "@t3tools/contracts";
import { ANNOTATION_COLOR, annotationLabel } from "./imageAnnotations";

/** Produce a send-only PNG; the source file and editable draft marks remain untouched. */
export async function renderImageAnnotations(
  file: File,
  annotations: ReadonlyArray<ImageAnnotation>,
  numberOffset = 0,
) {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image annotations could not be rendered in this browser.");
    context.drawImage(image, 0, 0);
    for (const [index, mark] of annotations.entries()) {
      const label = annotationLabel(mark, image.width, image.height);
      context.strokeStyle = ANNOTATION_COLOR;
      context.lineWidth = Math.max(3, label.radius / 5);
      context.beginPath();
      context.ellipse(
        (mark.x + mark.width / 2) * image.width,
        (mark.y + mark.height / 2) * image.height,
        (mark.width * image.width) / 2,
        (mark.height * image.height) / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.beginPath();
      context.arc(label.x, label.y, label.radius, 0, Math.PI * 2);
      context.fillStyle = ANNOTATION_COLOR;
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = `600 ${label.radius * 1.2}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(numberOffset + index + 1), label.x, label.y);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("The annotated image could not be encoded.")),
        "image/png",
      ),
    );
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-annotated.png`, {
      type: "image/png",
    });
  } finally {
    image.close();
  }
}
