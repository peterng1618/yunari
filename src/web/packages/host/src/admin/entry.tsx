import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Chooser } from "./chooser.js";
import "./admin.css";

/**
 * The host's React admin entry, served at `/` when a display has several saved
 * themes and none chosen.
 *
 * **Why a second build.** The host's other pages (`pair.html`, `rotation.js`)
 * are served from source with no build step, but a React entry needs bundling.
 * It is its own Vite build (`vite.admin.config.ts`) into `dist-admin`, never the
 * player's: the player bundle is React-free and size-budgeted, while this page
 * is served to a display over the LAN. `/settings` is not here either — it
 * routes to the editor's React settings mode, so one settings surface owns the
 * machine's facts.
 */
const root = document.querySelector("#app");
if (root === null) throw new Error("The chooser root is missing #app.");

createRoot(root).render(
  <StrictMode>
    <Chooser />
  </StrictMode>,
);
