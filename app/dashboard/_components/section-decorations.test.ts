// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SectionDecorations } from "./editor-extensions";

function makeEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), SectionDecorations],
    content,
  });
}

describe("SectionDecorations", () => {
  it("marks heading-led sections with stable start and end classes", () => {
    const editor = makeEditor("<h2>Intro</h2><p>Training is good</p><h2>Conclusion</h2><p>Bad</p>");
    const blocks = Array.from(editor.view.dom.children);

    expect(blocks).toHaveLength(4);
    expect(blocks.map((block) => block.className)).toEqual([
      "md-block md-heading-block md-section-start",
      "md-block md-section-end",
      "md-block md-heading-block md-section-start",
      "md-block md-section-end",
    ]);

    editor.destroy();
  });

  it("treats pre-heading text as a lead-in without making every paragraph a section start", () => {
    const editor = makeEditor("<p>Lead</p><p>Still lead</p><h2>Real section</h2><p>Body</p>");
    const blocks = Array.from(editor.view.dom.children);

    expect(blocks.map((block) => block.className)).toEqual([
      "md-block md-lead-block md-section-start",
      "md-block md-section-end",
      "md-block md-heading-block md-section-start",
      "md-block md-section-end",
    ]);

    editor.destroy();
  });

  it("does not mark third-level headings as section starts", () => {
    const editor = makeEditor("<h3>Body subhead</h3><p>Detail</p><h2>Real section</h2><p>Body</p>");
    const blocks = Array.from(editor.view.dom.children);

    expect(blocks.map((block) => block.className)).toEqual([
      "md-block md-lead-block md-section-start",
      "md-block md-section-end",
      "md-block md-heading-block md-section-start",
      "md-block md-section-end",
    ]);

    editor.destroy();
  });
});
