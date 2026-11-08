export const THEME_KEY = 'mynto-theme';

/** Applies the stored theme before the first paint of the dashboard. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;
