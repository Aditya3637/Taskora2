import { ReactRenderer } from "@tiptap/react";
import { apiFetch } from "@/lib/api";
import { MentionList, type MentionItem } from "./MentionList";

/**
 * TipTap suggestion config for the @ menu. items() hits our visibility-scoped
 * search endpoint; render() manages a lightweight popup positioned at the
 * caret (no tippy dependency).
 */
export function mentionSuggestion() {
  return {
    char: "@",
    allowSpaces: false,

    items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
      const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
      if (!bid) return [];
      try {
        const r = await apiFetch(
          `/api/v1/mentions/search?business_id=${bid}&q=${encodeURIComponent(query)}`,
        );
        return (r?.results ?? []) as MentionItem[];
      } catch {
        return [];
      }
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
        onUpdate: (props: any) => {
          component?.updateProps(props);
          place(props.clientRect);
        },
        onKeyDown: (props: any) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            popup = null;
            return true;
          }
          return (component?.ref as any)?.onKeyDown?.(props) ?? false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
