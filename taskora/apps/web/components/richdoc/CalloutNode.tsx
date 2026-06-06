import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: () => ReturnType;
      toggleCallout: () => ReturnType;
    };
  }
}

/**
 * A Notion-style callout block — a highlighted container that holds normal
 * block content (the 💡 icon is decorative, added via CSS). Persisted as
 * <div data-callout> so it survives the JSON↔HTML round-trip.
 */
export const CalloutNode = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "", class: "wd-callout" }), 0];
  },

  addCommands() {
    return {
      setCallout: () => ({ commands }) => commands.wrapIn(this.name),
      toggleCallout: () => ({ commands }) => commands.toggleWrap(this.name),
    };
  },
});
