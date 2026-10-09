import { useRef, useState } from "react";
import { FEEDBACK_GITHUB, feedbackMailto } from "../../../packages/core/index.js";
import { t } from "./i18n.js";
import { useTrack } from "./track.js";
import { closeOnBackdrop, useModal } from "./useModal.js";

/**
 * Tilbakemelding som bindFeedback() i vanilla-appen: ja/nei blir talt anonymt (éin gong
 * per opning), ei skriftleg melding opnar e-posten (mailto) og blir ikkje lagra.
 * `open` styrer vindauget; `onClose` kjem når det blir lukka (Esc, Lukk, bakgrunn).
 */
export function FeedbackDialog({ open, onClose, navigate = (url) => window.location.assign(url) }) {
  const ref = useRef(null);
  const track = useTrack();
  const [rating, setRating] = useState(null);
  const [sent, setSent] = useState(false);
  const [comment, setComment] = useState("");
  useModal(ref, open);

  const close = () => {
    ref.current?.close();
  };
  const reset = () => {
    setRating(null);
    setSent(false);
    setComment("");
    onClose();
  };
  const choose = (value) => {
    setRating(value);
    if (!sent) {
      setSent(true);
      track(value === "yes" ? "Feedback yes" : "Feedback no");
    }
  };
  const send = () => {
    if (!rating) return;
    const text = comment.trim();
    if (!text) {
      close();
      return;
    }
    track("Feedback message");
    const url = feedbackMailto(rating, text);
    close();
    navigate(url);
  };

  return (
    <dialog ref={ref} id="feedback-dialog" className="feedback-dialog" aria-labelledby="feedback-title" onClose={reset} onClick={closeOnBackdrop(ref)}>
      <h2 id="feedback-title">{t("feedback.title")}</h2>
      <p id="feedback-lead">{t("feedback.lead")}</p>
      <div className="feedback-ratings" role="group" aria-labelledby="feedback-lead">
        {["yes", "no"].map((value) => (
          <button
            key={value}
            type="button"
            className={rating === value ? "feedback-rate is-active" : "feedback-rate"}
            data-rating={value}
            aria-pressed={rating === value}
            onClick={() => choose(value)}
          >
            {t(`feedback.${value}`)}
          </button>
        ))}
      </div>
      <p id="feedback-thanks" className="feedback-thanks" hidden={!rating} aria-live="polite">
        {t("feedback.thanks")}
      </p>
      <div id="feedback-extra" hidden={!rating}>
        <label htmlFor="feedback-comment">{t("feedback.commentLabel")}</label>
        <textarea
          id="feedback-comment"
          name="feedback"
          rows={4}
          maxLength={700}
          placeholder={t("feedback.commentPlaceholder")}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <p className="feedback-privacy">{t("feedback.privacy")}</p>
      <p className="feedback-alt">
        <a id="feedback-github" href={FEEDBACK_GITHUB} target="_blank" rel="noreferrer">
          {t("feedback.github")}
        </a>
      </p>
      <div className="feedback-actions">
        <button type="button" id="feedback-send" className="feedback-send" hidden={!rating} onClick={send}>
          {t("feedback.send")}
        </button>
        <button type="button" id="feedback-cancel" className="feedback-cancel" onClick={close}>
          {t("feedback.close")}
        </button>
      </div>
    </dialog>
  );
}
