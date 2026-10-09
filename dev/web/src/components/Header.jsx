import { LangSwitch } from "./LangSwitch.jsx";
import { t } from "./i18n.js";

const ROUTES = ["1136", "1135"];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#073b4c" />
      <path d="M8 42c6 4 12 4 18 0s12-4 18 0 12 4 18 0" fill="none" stroke="#7ec8c3" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 38 32 20l10 6h8l-6 12H18z" fill="#f4efe4" />
      <rect x="28" y="16" width="3" height="10" fill="#e07a3d" />
    </svg>
  );
}

/** Samband: Standal–Trandal (1136) eller Sæbø–Leknes (1135). Kombirute kjem frå meldingane. */
function RouteSwitch({ routeChoice, onChange }) {
  return (
    <div className="header-routes">
      <span id="route-switch-label" className="route-switch-label">
        {t("route.label")}
      </span>
      <div className="filters route-switch" role="group" aria-labelledby="route-switch-label">
        {ROUTES.map((value) => (
          <button
            key={value}
            type="button"
            className={routeChoice === value ? "chip is-active" : "chip"}
            aria-pressed={routeChoice === value}
            onClick={() => onChange(value)}
          >
            {t(`route.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Statuslinja: kvar ferja er no og neste avgang, alltid om i dag. */
export function Lede({ lede }) {
  if (!lede) return null;
  if (lede.noTrips) {
    return <p className="lede" id="lede-status">{t("lede.noTripsToday")}</p>;
  }
  const parts = [];
  if (lede.status) parts.push(lede.status);
  if (lede.next) parts.push(t("lede.nextDeparture", lede.next));
  return (
    <p className="lede" id="lede-status">
      {`${parts.join(". ")}.`}
      {lede.logWarning ? (
        <>
          {" "}
          <span className="lede-warn">
            {lede.logWarning.when ? t("signal.logLate", { when: lede.logWarning.when }) : t("signal.logMissing")}
          </span>
        </>
      ) : null}
    </p>
  );
}

export function Header({ chrome, lede, ui, onRoute, onLang }) {
  return (
    <header className={chrome ? "site-header" : "site-header is-pending-route"}>
      <div className="header-tools">
        <LangSwitch lang={ui.lang} onChange={onLang} />
      </div>
      <BrandMark />
      <p className="eyebrow">{t(chrome?.eyebrowKey || "eyebrow")}</p>
      <div className="header-title">
        <h1 id="route-title">{t(chrome?.titleKey || "route.title1136")}</h1>
        {chrome?.kombi ? (
          <span id="route-badge" className="route-badge">
            {t("route.badgeKombi")}
          </span>
        ) : null}
      </div>
      <RouteSwitch routeChoice={ui.routeChoice} onChange={onRoute} />
      <Lede lede={lede} />
    </header>
  );
}
