import { Extension } from "@tiptap/core";
import { TextSelection, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Enter inside a heading starts a fresh body paragraph below it instead of
// ProseMirror's default split, which keeps the heading type when the cursor is
// mid-text and silently spawns a second heading (i.e. a new section box).
export const HeadingEnter = Extension.create({
  name: "headingEnter",
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) =>
        editor.commands.command(({ tr, state, dispatch }) => {
          if (state.selection.$from.parent.type.name !== "heading") return false;
          if (!state.selection.empty) tr.deleteSelection();
          const after = tr.selection.$from.after();
          tr.insert(after, state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
          dispatch?.(tr.scrollIntoView());
          return true;
        }),
    };
  },
});

export const SectionDecorations = Extension.create({
  name: "sectionDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];

            state.doc.forEach((node, offset, index) => {
              const next = index + 1 < state.doc.childCount ? state.doc.child(index + 1) : null;
              const isHeading = node.type.name === "heading" && (node.attrs.level === 1 || node.attrs.level === 2);
              const isStart = index === 0 || isHeading;
              const isEnd = index === state.doc.childCount - 1 || next?.type.name === "heading";
              const classes = ["md-block"];

              if (isHeading) classes.push("md-heading-block");
              if (!isHeading && index === 0) classes.push("md-lead-block");
              if (isStart) classes.push("md-section-start");
              if (isEnd) classes.push("md-section-end");

              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  class: classes.join(" "),
                }),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
