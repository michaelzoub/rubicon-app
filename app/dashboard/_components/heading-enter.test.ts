// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { HeadingEnter } from "./editor-extensions";

function makeEditor(withFix: boolean) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } })];
  if (withFix) extensions.push(HeadingEnter);
  return new Editor({ element, extensions, content: "<h2>Header</h2><p>Body</p>" });
}

function pressEnter(editor: Editor) {
  editor.view.someProp("handleKeyDown", (f) =>
    f(editor.view, new KeyboardEvent("keydown", { key: "Enter" })),
  );
}

function headingCount(editor: Editor) {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") count += 1;
  });
  return count;
}

// "Header" content sits at doc positions 1..7; pos 4 is mid-word ("Hea|der").
const MID_HEADING = 4;

describe("Enter inside a heading", () => {
  it("default behavior spawns a SECOND heading mid-word (the reported bug)", () => {
    const editor = makeEditor(false);
    editor.commands.setTextSelection(MID_HEADING);
    pressEnter(editor);
    expect(headingCount(editor)).toBe(2);
    editor.destroy();
  });

  it("with HeadingEnter, mid-word Enter creates a paragraph, not a new heading", () => {
    const editor = makeEditor(true);
    editor.commands.setTextSelection(MID_HEADING);
    pressEnter(editor);
    expect(headingCount(editor)).toBe(1);
    // The block right after the (still single) heading is a paragraph.
    const heading = editor.state.doc.child(0);
    expect(heading.type.name).toBe("heading");
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    editor.destroy();
  });

  it("with HeadingEnter, Enter at end of heading also yields a paragraph", () => {
    const editor = makeEditor(true);
    editor.commands.setTextSelection(7); // end of "Header"
    pressEnter(editor);
    expect(headingCount(editor)).toBe(1);
    editor.destroy();
  });
});
