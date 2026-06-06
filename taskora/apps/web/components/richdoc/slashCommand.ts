import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  Heading1, Heading2, Heading3, Type, List, ListOrdered, ListChecks,
  Quote, Lightbulb, ChevronRight, Minus, Code, Table as TableIcon, Image as ImageIcon,
} from "lucide-react";
import { SlashList, type SlashItem } from "./SlashList";

type SlashOptions = { onImage?: () => void };

/** The static block catalog for the "/" menu. */
function allItems(opts: SlashOptions): SlashItem[] {
  const run = (fn: (c: any) => any) => ({ editor, range }: { editor: any; range: any }) =>
    fn(editor.chain().focus().deleteRange(range)).run();

  return [
    { title: "Text", subtitle: "Plain paragraph", icon: Type, command: run((c) => c.setParagraph()) },
    { title: "Heading 1", subtitle: "Big section heading", icon: Heading1, command: run((c) => c.setNode("heading", { level: 1 })) },
    { title: "Heading 2", subtitle: "Medium heading", icon: Heading2, command: run((c) => c.setNode("heading", { level: 2 })) },
    { title: "Heading 3", subtitle: "Small heading", icon: Heading3, command: run((c) => c.setNode("heading", { level: 3 })) },
    { title: "Bullet list", subtitle: "Unordered list", icon: List, command: run((c) => c.toggleBulletList()) },
    { title: "Numbered list", subtitle: "Ordered list", icon: ListOrdered, command: run((c) => c.toggleOrderedList()) },
    { title: "To-do list", subtitle: "Checkboxes you can tick", icon: ListChecks, command: run((c) => c.toggleTaskList()) },
    { title: "Quote", subtitle: "Capture a quote", icon: Quote, command: run((c) => c.toggleBlockquote()) },
    { title: "Callout", subtitle: "Highlighted box", icon: Lightbulb, command: run((c) => c.setCallout()) },
    { title: "Toggle", subtitle: "Collapsible section", icon: ChevronRight, command: run((c) => c.setDetails()) },
    { title: "Divider", subtitle: "Horizontal rule", icon: Minus, command: run((c) => c.setHorizontalRule()) },
    { title: "Code block", subtitle: "Monospaced code", icon: Code, command: run((c) => c.toggleCodeBlock()) },
    { title: "Table", subtitle: "3×3 with header row", icon: TableIcon, command: run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
    {
      title: "Image / file",
      subtitle: "Upload an attachment",
      icon: ImageIcon,
      command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); opts.onImage?.(); },
    },
  ];
}

/**
 * Notion-style "/" slash menu. Built on TipTap's Suggestion utility (the same
 * plumbing as @-mentions), with a caret-anchored popup (no tippy dep). The
 * "Image / file" item delegates to the host's upload picker via options.onImage.
 */
export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",
  addOptions() { return { onImage: undefined }; },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => props.command({ editor, range }),
        items: ({ query }) => {
          const q = query.toLowerCase();
          return allItems(options).filter(
            (i) => i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q),
          );
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: HTMLDivElement | null = null;

          const place = (clientRect?: (() => DOMRect | null) | null) => {
            if (!popup || !clientRect) return;
            const rect = clientRect();
            if (!rect) return;
            popup.style.left = `${rect.left + window.scrollX}px`;
            popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
          };

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashList, { props, editor: props.editor });
              popup = document.createElement("div");
              popup.style.position = "absolute";
              popup.style.zIndex = "60";
              document.body.appendChild(popup);
              popup.appendChild(component.element);
              place(props.clientRect);
            },
            onUpdate: (props: any) => {
              component?.updateProps(props);
              place(props.clientRect);
            },
            onKeyDown: (props: any) => {
              if (props.event.key === "Escape") { popup?.remove(); popup = null; return true; }
              return (component?.ref as any)?.onKeyDown?.(props) ?? false;
            },
            onExit: () => {
              popup?.remove(); popup = null;
              component?.destroy(); component = null;
            },
          };
        },
      }),
    ];
  },
});
