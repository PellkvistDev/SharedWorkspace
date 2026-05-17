const KEY = "wos.theme";

export function initTheme() {
  const t = localStorage.getItem(KEY);
  if (t === "light") document.documentElement.classList.remove("dark");
  else document.documentElement.classList.add("dark");
}

export function getTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function toggleTheme() {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem(KEY, isDark ? "dark" : "light");
}
