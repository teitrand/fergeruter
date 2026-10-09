import { useEffect } from "react";

/**
 * Opnar <dialog> som modal når `open` blir sann, og lukkar han når han blir usann.
 * Same som vanilla: showModal når det finst, elles open-attributtet.
 */
export function useModal(ref, open) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [ref, open]);
}

/** Klikk på bakgrunnen (sjølve <dialog>-elementet) lukkar. */
export function closeOnBackdrop(ref) {
  return (event) => {
    if (event.target === ref.current) ref.current.close();
  };
}
