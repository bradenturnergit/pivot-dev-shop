// Google Analytics 4 for pivotdevshop.com — the only script the brand pages run.
//
// It lives in its own file rather than inline so the page's CSP can stay
// script-src 'self' plus Google's tag host, with no 'unsafe-inline'. See the
// CSP comment in firebase.json and "Analytics" in CLAUDE.md.
//
// Visits, page views, referrers and outbound clicks are GA4's own (page_view
// and enhanced measurement). What this file adds is cta_click — every
// "Start a project" button and every mailto link — and work_card_click, each
// tagged with where on the page it was.
(function () {
  // The GA4 web stream's Measurement ID (Admin → Data streams → the web stream).
  // While it is still the placeholder nothing loads and nothing is sent.
  var MEASUREMENT_ID = 'G-XXXXXXXXXX';

  // Only the real domain is counted. PR preview channels, the *.web.app
  // address and a laptop would otherwise pad the numbers with our own visits.
  var LIVE_HOSTS = ['pivotdevshop.com', 'www.pivotdevshop.com'];

  if (!/^G-[A-Z0-9]+$/.test(MEASUREMENT_ID) || MEASUREMENT_ID === 'G-XXXXXXXXXX') return;
  if (LIVE_HOSTS.indexOf(location.hostname) === -1) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);

  var tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(tag);

  // Where on the page a link sits, in words that read in a report: the same
  // "Start a project" appears up to three times per page, and which one gets
  // pressed is the point of tracking it.
  function locationOf(el) {
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    if (el.closest('.hero')) return 'hero';
    if (el.closest('#contact, .cta')) return 'bottom';
    var section = el.closest('section[id]');
    return section ? section.id : 'body';
  }

  // One listener on the document rather than one per link, so a link added to
  // any page is tracked without touching this file.
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    var text = (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    var isEmail = href.indexOf('mailto:') === 0;

    if (link.classList.contains('btn') || isEmail) {
      gtag('event', 'cta_click', {
        cta_text: text,
        cta_location: locationOf(link),
        // An email address is a fixed company inbox here, not a visitor's,
        // but there's no reason to send it either way.
        cta_destination: isEmail ? 'email' : href
      });
    } else if (link.classList.contains('card')) {
      gtag('event', 'work_card_click', {
        card_name: (link.querySelector('.n') || link).textContent.trim(),
        cta_destination: href
      });
    }
  });
})();
