// Applies the saved color theme before the page paints, so it never flashes
// the default first. Crimson is the default; the picker lives in app.js.
(function () {
  var THEMES = ['crimson', 'midnight-blue', 'ice-blue', 'navy-red', 'jcothron2'];
  var saved = null;
  try { saved = localStorage.getItem('tb-theme'); } catch (e) { /* storage unavailable */ }
  document.documentElement.setAttribute('data-theme', THEMES.indexOf(saved) >= 0 ? saved : 'crimson');
})();
