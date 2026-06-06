import { ReactRenderer } from "@tiptap/react";
import { MentionList, type MentionItem } from "@/components/richdoc/MentionList";
import type { Page, Person } from "./types";

/**
 * The notebook's "@" suggestion (convergence N-4): one picker for people AND
 * pages, sourced client-side from the lists the editor already has. Picking a
 * person inserts a `user:<id>` chip; picking a page inserts a `page:<id>` chip
 * that the editor makes clickable (navigates). Mirrors the program mention
 * plumbing — caret-anchored popup, no tippy dep.
 */
export function notebookMention(getData: () => { people: Person[]; pages: Page[] }) {
  return {
    char: "@",
    allowSpaces: false,

    items: ({ query }: { query: string }): MentionItem[] => {
      const q = (query || "").trim().toLowerCase();
      const { people, pages } = getData();
      const peopleItems: MentionItem[] = people
        .filter((p) => !q || (p.name || "").toLowerCase().includes(q))
        .slice(0, 6)
        .map((p) => ({ type: "user", id: `user:${p.id}`, label: p.name || "Someone", sub: "Person" }));
      const pageItems: MentionItem[] = pages
        .filter((p) => !q || (p.title || "").toLowerCase().includes(q))
        .slice(0, 6)
        .map((p) => ({ type: "page", id: `page:${p.id}`, label: p.title || "Untitled", sub: "Page" }));
      return [...pageItems, ...peopleItems];
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
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
          popup = document.createElement("div");
          popup.style.position = "absolute";
          popup.style.zIndex = "60";
          document.body.appendChild(popup);
          popup.appendChild(component.element);
          place(props.clientRect);
        },
        onUpdate: (props: any) => { component?.updateProps(props); place(props.clientRect); },
        onKeyDown: (props: any) => {
          if (props.event.key === "Escape") { popup?.remove(); popup = null; return true; }
          return (component?.ref as any)?.onKeyDown?.(props) ?? false;
        },
        onExit: () => { popup?.remove(); popup = null; component?.destroy(); component = null; },
      };
    },
  };
}
