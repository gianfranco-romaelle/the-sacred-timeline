import { useEffect, useState } from "react";
import { stripBasePath, withBasePath } from "./base-path";

// The current frontend uses a tiny history wrapper instead of a full router so
// the experimental views can move independently from future app-shell choices.
function normalizePathname(pathname) {
  if (!pathname || pathname === "") return "/";
  const clean = pathname.replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

export function getCurrentPathname() {
  if (typeof window === "undefined") return "/";
  return normalizePathname(stripBasePath(window.location.pathname));
}

export function navigateTo(pathname, { replace = false } = {}) {
  if (typeof window === "undefined") return;
  const nextPath = normalizePathname(pathname);
  const currentPath = getCurrentPathname();
  if (nextPath === currentPath && !replace) return;

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", withBasePath(nextPath));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useCurrentPathname() {
  const [pathname, setPathname] = useState(getCurrentPathname);

  useEffect(() => {
    function handlePopstate() {
      setPathname(getCurrentPathname());
    }

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  return pathname;
}
