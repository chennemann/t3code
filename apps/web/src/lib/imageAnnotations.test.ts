import { describe, expect, it } from "vite-plus/test";
import {
  annotationComments,
  annotationLabel,
  annotationRect,
  moveAnnotation,
  type ImageAnnotation,
} from "./imageAnnotations";

const card: ImageAnnotation = {
  id: "card",
  x: 0.1,
  y: 0.4,
  width: 0.8,
  height: 0.1,
  comment: " Reduce padding. ",
};

describe("image annotation geometry", () => {
  it("draws the same region in either drag direction", () => {
    const start = { x: 0.1, y: 0.4 },
      end = { x: 0.9, y: 0.5 };
    expect(annotationRect(start, end)).toEqual(annotationRect(end, start));
    expect(annotationRect(start, end)).toMatchObject({ x: 0.1, y: 0.4, width: 0.8 });
  });

  it("keeps a drag outside the image within the image", () => {
    expect(annotationRect({ x: -0.2, y: 0.2 }, { x: 1.4, y: 1.3 })).toEqual({
      x: 0,
      y: 0.2,
      width: 1,
      height: 0.8,
    });
  });

  it("keeps even a zero-length drag at the bottom right in bounds", () => {
    const rect = annotationRect({ x: 1, y: 1 }, { x: 1, y: 1 });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
  });

  it("moves the whole ellipse without changing its dimensions or comment", () => {
    const moved = moveAnnotation(card, { x: 0.8, y: -0.8 });
    expect(moved).toMatchObject({
      y: 0,
      width: card.width,
      height: card.height,
      comment: card.comment,
    });
    expect(moved.x + moved.width).toBeLessThanOrEqual(1);
  });

  it("keeps the full number badge visible at image edges", () => {
    const label = annotationLabel({ ...card, x: 0.9, y: 0, width: 0.1 }, 432, 996);
    expect(label.x + label.radius).toBeLessThanOrEqual(432);
    expect(label.y - label.radius).toBeGreaterThanOrEqual(0);
  });

  it("leaves the resize corner below the number badge available", () => {
    const label = annotationLabel(card, 432, 996);
    expect(label.y + label.radius).toBeLessThan(card.y * 996);
  });
});

describe("numbered image feedback", () => {
  it("keeps multiline comments as text with the same numbering as the remaining ellipses", () => {
    const checkbox = { ...card, id: "checkbox", comment: "Make this larger.\nKeep it aligned." };
    expect(annotationComments([card, checkbox])).toBe(
      "1. Reduce padding.\n2. Make this larger.\nKeep it aligned.",
    );
    expect(annotationComments([checkbox])).toBe("1. Make this larger.\nKeep it aligned.");
  });
});
