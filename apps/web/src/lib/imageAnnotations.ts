import type { ImageAnnotation } from "@t3tools/contracts";
export type { ImageAnnotation } from "@t3tools/contracts";

export interface AnnotationPoint {
  x: number;
  y: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function annotationRect(start: AnnotationPoint, end: AnnotationPoint) {
  const x = clamp(Math.min(start.x, end.x), 0, 0.995);
  const y = clamp(Math.min(start.y, end.y), 0, 0.995);
  return {
    x,
    y,
    width: Math.max(0.005, clamp(Math.max(start.x, end.x)) - x),
    height: Math.max(0.005, clamp(Math.max(start.y, end.y)) - y),
  };
}

export function moveAnnotation(mark: ImageAnnotation, delta: AnnotationPoint) {
  return {
    ...mark,
    x: clamp(mark.x + delta.x, 0, 1 - mark.width),
    y: clamp(mark.y + delta.y, 0, 1 - mark.height),
  };
}

export function annotationLabel(mark: ImageAnnotation, imageWidth: number, imageHeight: number) {
  const radius = Math.min(
    Math.max(14, Math.min(imageWidth, imageHeight) * 0.03),
    Math.min(imageWidth, imageHeight) / 2,
  );
  return {
    radius,
    x: clamp((mark.x + mark.width) * imageWidth, radius, imageWidth - radius),
    // Leave the resize corner exposed beneath the numbered indicator.
    y: clamp(mark.y * imageHeight - radius * 1.6, radius, imageHeight - radius),
  };
}

export function annotationComments(marks: ReadonlyArray<ImageAnnotation>) {
  return marks.map((mark, index) => `${index + 1}. ${mark.comment.trim()}`).join("\n");
}

export const ANNOTATION_COLOR = "#ff454f";
