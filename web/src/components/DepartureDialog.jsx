import { useEffect, useRef } from "react";
import { telHref } from "../../../packages/core/index.js";
import { t } from "./i18n.js";

/**
 * Detaljvindauget for éi avgang. `detail` kjem frå detailModel (null = lukka).
 * Opnar som modal med showModal når det finst; Esc og klikk utanfor lukkar.
 */
export function DepartureDialog({ detail, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (detail && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!detail && dialog.open) {
      dialog.close();
    }
  }, [detail]);
  return (
    <dialog
      ref={ref}
      id="departure-dialog"
      className="install-dialog departure-dialog"
      aria-labelledby="departure-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current.close();
      }}
    >
      <h2 id="departure-title">{detail?.title || ""}</h2>
      <div id="departure-body">
        {(detail?.paragraphs || []).map((item, index) =>
          item.phone ? (
            <p key={index} className={item.className}>
              <a className="stop-phone" href={telHref(item.phone)}>
                {item.text}
              </a>
            </p>
          ) : (
            <p key={index} className={item.className}>
              {item.text}
            </p>
          )
        )}
      </div>
      <div className="feedback-actions">
        <button type="button" id="departure-close" className="feedback-cancel" onClick={() => ref.current?.close()}>
          {t("detail.close")}
        </button>
      </div>
    </dialog>
  );
}
