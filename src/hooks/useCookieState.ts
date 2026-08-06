import { useEffect, useState } from "react";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * Like useState but persists the value in a cookie.
 * Reads the initial value from the cookie on mount.
 */
export function useCookieState(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => getCookie(key) ?? defaultValue);
  useEffect(() => { setCookie(key, value); }, [key, value]);
  return [value, setValue];
}

/**
 * Numeric cookie state — stores as string, parses to number.
 * Returns the string for the input and the parsed number for computation.
 */
export function useCookieNum(key: string, defaultValue: number): {
  str: string;
  num: number;
  set: (v: string) => void;
} {
  const [str, set] = useCookieState(key, String(defaultValue));
  return { str, num: Number(str) || 0, set };
}
