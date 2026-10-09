import { useEffect, useRef, useState } from "react";
import { appMode } from "../../../packages/core/index.js";

/**
 * Install-knappen som bindInstallPrompt() i vanilla-appen:
 * - skjult når sida alt er opna som installert app
 * - har nettlesaren eiga installering (beforeinstallprompt), blir ho brukt
 * - elles opnar knappen rettleiinga (`help`)
 * Sjølve service workeren (offline) kjem i PR 6; knappen og rettleiinga er berre skalet.
 * @returns {{ visible: boolean, helpOpen: boolean, install: () => void, closeHelp: () => void }}
 */
export function useInstall(track, { enabled = true } = {}) {
  const [visible, setVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const deferred = useRef(null);

  useEffect(() => {
    if (!enabled || appMode(window) === "pwa") return undefined;
    setVisible(true);
    const onPrompt = (event) => {
      event.preventDefault();
      deferred.current = event;
      setVisible(true);
    };
    const onInstalled = () => {
      track("App installed", { how: "native" });
      deferred.current = null;
      setVisible(false);
      setHelpOpen(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [enabled, track]);

  const install = async () => {
    const prompt = deferred.current;
    if (prompt) {
      track("Install app", { how: "native" });
      deferred.current = null;
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") setVisible(false);
      return;
    }
    track("Install app", { how: "help" });
    setHelpOpen(true);
  };

  return { visible, helpOpen, install, closeHelp: () => setHelpOpen(false) };
}
