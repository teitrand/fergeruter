import { useEffect, useState } from "react";

/**
 * Tikkar på kvart minuttskifte (pluss 200 ms), og når fana blir synleg att.
 * Returnerer epoke-ms. Core les sjølv klokka (Date.now), så verdien er mest ein
 * grunn til å teikne på nytt; send han vidare der ein funksjon tek `now`.
 */
export function useClock() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      timer = setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, 60000 - (Date.now() % 60000) + 200);
    };
    const wake = () => {
      if (document.hidden) return;
      setNowMs(Date.now());
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return nowMs;
}
