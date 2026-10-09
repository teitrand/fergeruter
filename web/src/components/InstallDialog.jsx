import { useRef } from "react";
import { FJORD1_SMS_URL, installHint } from "../../../packages/core/index.js";
import { t } from "./i18n.js";
import { closeOnBackdrop, useModal } from "./useModal.js";

const SECTIONS = [
  { hint: "ios", steps: ["install.ios.1", "install.ios.2", "install.ios.3"], note: "install.ios.note" },
  { hint: "android", steps: ["install.android.1", "install.android.2"] },
  { hint: "desktop", steps: ["install.desktop.1"] },
];

/** Knappen øvst til høgre. Skjult når sida er installert app (sjå useInstall). */
export function InstallButton({ visible, onClick }) {
  return (
    <button
      type="button"
      id="install-btn"
      className="install-btn"
      hidden={!visible}
      aria-haspopup="dialog"
      aria-controls="install-dialog"
      onClick={onClick}
    >
      {t("install.app")}
    </button>
  );
}

/** Rettleiing for heimeskjermen. Den truleg rette plattforma blir framheva (installHint i core). */
export function InstallDialog({ open, onClose, hint = typeof navigator !== "undefined" ? installHint(navigator) : "desktop" }) {
  const ref = useRef(null);
  useModal(ref, open);
  return (
    <dialog ref={ref} id="install-dialog" className="install-dialog" aria-labelledby="install-title" onClose={onClose} onClick={closeOnBackdrop(ref)}>
      <h2 id="install-title">{t("install.title")}</h2>
      <p>{t("install.lead")}</p>
      {SECTIONS.map((section) => (
        <section
          key={section.hint}
          className={section.hint === hint ? "install-steps is-likely" : "install-steps"}
          data-install-hint={section.hint}
          aria-current={section.hint === hint ? "true" : undefined}
        >
          <h3>{t(`install.${section.hint}.title`)}</h3>
          <ol>
            {section.steps.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
          {section.note ? <p className="install-aside">{t(section.note)}</p> : null}
        </section>
      ))}
      <p className="install-note">
        <span>{t("install.notify")}</span>{" "}
        <a href={FJORD1_SMS_URL} target="_blank" rel="noreferrer">
          {t("messages.sms")}
        </a>
      </p>
      <div className="feedback-actions">
        <button type="button" id="install-close" className="feedback-cancel" onClick={() => ref.current?.close()}>
          {t("feedback.close")}
        </button>
      </div>
    </dialog>
  );
}
