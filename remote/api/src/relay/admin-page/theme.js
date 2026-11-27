function savedAdminTheme() {
  try {
    return localStorage.getItem("openbot.admin.theme");
  } catch {
    return null;
  }
}

const savedTheme = savedAdminTheme();
if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
