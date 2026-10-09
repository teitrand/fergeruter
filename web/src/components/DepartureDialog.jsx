import { useRef } from "react";
import { CallLink } from "./CallLink.jsx";
import { t } from "./i18n.js";
import { closeOnBackdrop, useModal } from "./useModal.js";

/**
 * Detaljvindauget for éi avgang. `detail` kjem frå detailModel (null = lukka).
 * Opnar som modal med showModal når det finst; Esc og klikk utanfor lukkar.
 */
export function DepartureDialog({ detail, onClose }) {
  const ref = useRef(null);
  useModal(ref, Boolean(detail));
  return (
    <dialog
      ref={ref}
      id="departure-dialog"
      className="install-dialog departure-dialog"
      aria-labelledby="departure-title"
      onClose={onClose}
      onClick={closeOnBackdrop(ref)}
    >
      <h2 id="departure-title">{detail?.title || ""}</h2>
      <div id="departure-body">
        {(detail?.paragraphs || []).map((item, index) =>
          item.phone ? (
            <p key={index} className={item.className}>
              <CallLink className="stop-phone" phone={item.phone} how="detail">
                {item.text}
              </CallLink>
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
