import { describe, expect, it } from "vite-plus/test";
import { appendImageAnnotationComments } from "./appendImageAnnotationComments";

const mark = (comment: string) => ({
  id: "circle",
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  comment,
});

describe("appendImageAnnotationComments", () => {
  it("groups comments by filename and appends them after the user's message", () => {
    expect(
      appendImageAnnotationComments("Please update these screens.", [
        { name: "image1.png", annotations: [mark("annotation 1"), mark("annotation 2")] },
        { name: "plain.png" },
        { name: "image2.png", annotations: [mark("another change")] },
      ]),
    ).toBe(
      "Please update these screens.\n\nannotations for image1.png:\n1. annotation 1\n2. annotation 2\n\nannotations for image2.png:\n1. another change",
    );
  });

  it("uses the comments as the entire message when no text was typed", () => {
    expect(
      appendImageAnnotationComments("", [
        { name: "image.png", annotations: [mark("Enlarge it.")] },
      ]),
    ).toBe("annotations for image.png:\n1. Enlarge it.");
  });

  it("skips blank comments while keeping the numbers used on the image", () => {
    expect(
      appendImageAnnotationComments("", [
        { name: "empty.png", annotations: [mark(" \n ")] },
        { name: "image.png", annotations: [mark(""), mark("  Make it larger.  ")] },
      ]),
    ).toBe("annotations for image.png:\n2. Make it larger.");
  });

  it("leaves messages without comments unchanged, including the empty-message fallback", () => {
    const images = [{ name: "image.png" }, { name: "marked.png", annotations: [mark(" \n ")] }];
    expect(appendImageAnnotationComments("Original message", images)).toBe("Original message");
    expect(appendImageAnnotationComments("", images)).toBe("");
  });

  it("preserves multiline comments and leaves saved comments untouched", () => {
    const annotations = Object.freeze([Object.freeze(mark("  First line\nSecond line  "))]);
    expect(appendImageAnnotationComments("", [{ name: "image.png", annotations }])).toBe(
      "annotations for image.png:\n1. First line\nSecond line",
    );
    expect(annotations[0]?.comment).toBe("  First line\nSecond line  ");
  });
});
