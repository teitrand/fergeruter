import { NAIS_URL } from "../../../packages/core/index.js";
import { CallLink } from "./CallLink.jsx";
import { t } from "./i18n.js";

/** Teksten med telefonnummeret som ringelenkje, som linkifyPhone() i vanilla-appen. */
function Operator({ text, phone }) {
  const at = phone ? text.indexOf(phone) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <CallLink className="footer-phone" phone={phone} how="footer" aria-label={t("signal.callAria", { phone })}>
        {phone}
      </CallLink>
      {text.slice(at + phone.length)}
    </>
  );
}

/** Operatør og ferjetelefon, AIS-kjelde, høgtidsmerknad og tilbakemelding. */
export function Footer({ chrome, onFeedback }) {
  const vessel = chrome?.vessel;
  const phone = vessel ? vessel.phone : "916 69 340";
  const text = vessel ? t("footer.operatorVessel", { name: vessel.name, phone }) : t("footer.operator");
  return (
    <footer className="site-footer">
      <p>
        <span id="footer-operator">
          <Operator text={text} phone={phone} />
        </span>{" "}
        AIS:{" "}
        <a href={NAIS_URL} target="_blank" rel="noreferrer">
          NAIS / Kystverket
        </a>
        .
      </p>
      <p>{t("footer.holidays")}</p>
      <p>
        <button type="button" id="feedback-open" className="feedback-link" onClick={onFeedback}>
          {t("feedback.open")}
        </button>
      </p>
    </footer>
  );
}
