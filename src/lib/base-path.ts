const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

export const getBasePath = () => {
  const rawBase = (import.meta.env.BASE_URL || "/").trim();
  const normalizedBase = trimTrailingSlashes(rawBase);
  return normalizedBase === "" ? "/" : normalizedBase;
};

export const stripBasePath = (pathname: string) => {
  const basePath = getBasePath();
  const cleanPathname = pathname || "/";

  if (basePath === "/" || !cleanPathname.startsWith(basePath)) {
    return cleanPathname;
  }

  const stripped = cleanPathname.slice(basePath.length);
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
};

export const withBasePath = (pathname: string) => {
  const basePath = getBasePath();
  const cleanPathname = pathname === "" ? "/" : pathname;

  if (basePath === "/") {
    return cleanPathname;
  }

  if (cleanPathname === "/") {
    return `${basePath}/`;
  }

  return `${basePath}${cleanPathname.startsWith("/") ? cleanPathname : `/${cleanPathname}`}`;
};
