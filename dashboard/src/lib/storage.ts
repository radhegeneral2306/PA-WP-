// localStorage can throw (private mode, blocked storage). Never let that break the app.
export function getItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function removeItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const TOKEN_KEY = "rt.token";
export const getToken = () => getItem(TOKEN_KEY);
export const setToken = (t: string) => setItem(TOKEN_KEY, t);
export const clearToken = () => removeItem(TOKEN_KEY);
