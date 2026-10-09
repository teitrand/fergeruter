import { telHref } from "../../../packages/core/index.js";
import { t } from "./i18n.js";

/** Operatør og ferjetelefon. Nummeret blir ei ringelenkje, som i vanilla-appen. */
export function Footer({ chrome }) {
  const vessel = chrome?.vessel;
  const phone = vessel ? vessel.phone : "916 69 340";
  const text = vessel ? t("footer.operatorVessel", { name: vessel.name, phone }) : t("footer.operator");
  const at = phone ? text.indexOf(phone) : -1;
  return (
    <footer className="site-footer">
      <p>
        {at < 0 ? (
          text
        ) : (
          <>
            {text.slice(0, at)}
            <a className="footer-phone" href={telHref(phone)} aria-label={t("signal.callAria", { phone })}>
              {phone}
            </a>
            {text.slice(at + phone.length)}
          </>
        )}
      </p>
      <p>{t("footer.holidays")}</p>
    </footer>
  );
}
