// Samtycke för Meta-pixeln och klickhändelser för butiksknapparna.
// Pixelbasen ligger i <head> på varje sida. Utan svar från besökaren
// ligger den i läget fbq('consent', 'revoke') tills "Okej" trycks här.
// Valet sparas i localStorage; vid "Nej tack" laddas pixeln inte alls nästa gång.
// Länken "Kakor" i footern (.samtycke-oppna) nollställer valet så att bannern visas igen.
(function () {
  var NYCKEL = 'skolkik-samtycke';

  function lasVal() {
    try { return localStorage.getItem(NYCKEL); } catch (e) { return null; }
  }
  function sparaVal(v) {
    try { localStorage.setItem(NYCKEL, v); } catch (e) {}
  }
  function glomVal() {
    try { localStorage.removeItem(NYCKEL); } catch (e) {}
  }
  function harFbq() { return typeof window.fbq === 'function'; }

  // Tar bort kakorna pixeln satt på vår domän.
  function rensaKakor() {
    var domaner = ['', '; domain=' + location.hostname, '; domain=.' + location.hostname.split('.').slice(-2).join('.')];
    ['_fbp', '_fbc'].forEach(function (namn) {
      domaner.forEach(function (d) {
        document.cookie = namn + '=; Max-Age=0; path=/' + d;
      });
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;

    // "Kakor" i footern: nollställ valet och ladda om så att bannern visas igen.
    if (e.target.closest('.samtycke-oppna')) {
      e.preventDefault();
      glomVal();
      rensaKakor();
      location.reload();
      return;
    }

    // Butiksknappar: en egen händelse per klick, på alla sidor.
    var a = e.target.closest('a[href]');
    if (!a || !harFbq() || lasVal() === 'nej') return;
    var href = a.href || '';
    if (href.indexOf('apps.apple.com') !== -1) {
      fbq('trackCustom', 'StoreClick', { store: 'ios' });
    } else if (href.indexOf('play.google.com/store/apps') !== -1) {
      fbq('trackCustom', 'StoreClick', { store: 'android' });
    }
  });

  // Bannern visas bara tills ett val är gjort.
  var val = lasVal();
  if (val === 'ja' || val === 'nej') return;

  var banner = document.createElement('div');
  banner.className = 'samtycke';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Kakor');
  banner.innerHTML =
    '<p>Vi använder en pixel från Meta för att se om våra annonser leder hit. Den sätter kakor i din webbläsare. <a href="/integritet/#kakor">Läs mer</a></p>' +
    '<div class="samtycke-knappar">' +
      '<button type="button" class="samtycke-nej">Nej tack</button>' +
      '<button type="button" class="samtycke-ja">Okej</button>' +
    '</div>';

  // Sidan får luft nertill motsvarande bannern, så att den aldrig täcker något.
  function matta() {
    document.body.style.setProperty('--samtycke-h', (banner.offsetHeight + 24) + 'px');
  }
  function stang() {
    window.removeEventListener('resize', matta);
    document.body.classList.remove('har-samtycke');
    document.body.style.removeProperty('--samtycke-h');
    banner.remove();
  }

  banner.querySelector('.samtycke-ja').addEventListener('click', function () {
    sparaVal('ja');
    if (harFbq()) fbq('consent', 'grant');
    stang();
  });
  banner.querySelector('.samtycke-nej').addEventListener('click', function () {
    sparaVal('nej');
    rensaKakor();
    stang();
  });

  document.body.appendChild(banner);
  document.body.classList.add('har-samtycke');
  matta();
  window.addEventListener('resize', matta);
})();
