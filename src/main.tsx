import * as React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { Boundary } from "./components/Boundary";
import { forget } from "./project/keep";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element.");

/*
 * Wrapped, so that a fault has somewhere to be reported.
 *
 * React unmounts the whole tree when a render throws and the page under this
 * one is nearly black, so uncaught, every kind of fault looks the same from
 * outside: a black screen with nothing on it. See `Boundary`.
 */
createRoot(container).render(
  <React.StrictMode>
    <Boundary onDiscard={forget}>
      <App />
    </Boundary>
  </React.StrictMode>,
);
