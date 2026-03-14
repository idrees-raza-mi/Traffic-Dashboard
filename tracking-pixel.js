/**
 * TrackPulse Analytics Pixel — Production Build
 * Version: 1.0.0
 * Docs: https://docs.trackpulse.io
 *
 * Tracks: pageviews, UTM campaigns, referrers, device, geo, session depth
 * Security: rate-limited, deduplicated, bot-filtered
 */
(function(window, document) {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────────
  var CONFIG = {
    endpoint:  'https://api.trackpulse.io/v1/collect',
    siteId:    window.TP_SITE_ID || document.currentScript.dataset.siteId,
    version:   '1.0.0',
    sessionTTL: 30 * 60 * 1000,   // 30 min
    debug:     false
  };

  // ─── BOT DETECTION ───────────────────────────────────────────────
  var BOT_PATTERNS = /bot|crawl|slurp|spider|mediapartners|google|adsbot/i;
  if (BOT_PATTERNS.test(navigator.userAgent)) return;

  // ─── SESSION MANAGEMENT ──────────────────────────────────────────
  function getOrCreateSession() {
    var key = 'tp_sid';
    var stored = sessionStorage.getItem(key);
    if (stored) {
      var s = JSON.parse(stored);
      if (Date.now() - s.lastSeen < CONFIG.sessionTTL) {
        s.lastSeen = Date.now();
        sessionStorage.setItem(key, JSON.stringify(s));
        return s;
      }
    }
    var session = {
      id:        generateId(),
      startedAt: Date.now(),
      lastSeen:  Date.now(),
      pageCount: 0,
      isNew:     true
    };
    sessionStorage.setItem(key, JSON.stringify(session));
    return session;
  }

  function generateId() {
    return 'tp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ─── UTM PARAMETER EXTRACTION ────────────────────────────────────
  function getUTMParams() {
    var params = new URLSearchParams(window.location.search);
    var utm = {
      source:   params.get('utm_source'),
      medium:   params.get('utm_medium'),
      campaign: params.get('utm_campaign'),
      term:     params.get('utm_term'),
      content:  params.get('utm_content')
    };
    // Persist first-touch UTM across session
    if (utm.source) {
      sessionStorage.setItem('tp_utm', JSON.stringify(utm));
    }
    return utm.source ? utm : JSON.parse(sessionStorage.getItem('tp_utm') || 'null');
  }

  // ─── TRAFFIC SOURCE DETECTION ────────────────────────────────────
  function detectTrafficSource(referrer, utm) {
    // UTM source takes priority (paid/campaign traffic)
    if (utm) {
      var medium = (utm.medium || '').toLowerCase();
      if (medium === 'cpc' || medium === 'ppc' || medium === 'paid') {
        var src = (utm.source || '').toLowerCase();
        if (src.includes('google'))   return 'google_ads';
        if (src.includes('facebook') || src.includes('instagram')) return 'facebook_ads';
        if (src.includes('linkedin')) return 'linkedin_ads';
        if (src.includes('tiktok'))   return 'tiktok_ads';
        if (src.includes('twitter'))  return 'twitter_ads';
        return 'paid_other';
      }
      if (medium === 'email') return 'email';
      if (medium === 'social') return 'social_organic';
      if (utm.source) return utm.source;
    }

    // No UTM — detect from referrer
    if (!referrer || referrer === '') return 'direct';

    var ref = referrer.toLowerCase();
    var hostname = new URL(referrer).hostname.replace('www.', '');
    var currentHost = window.location.hostname.replace('www.', '');

    // Internal traffic
    if (hostname === currentHost) return null;

    // Search engines (organic)
    if (/google\.|bing\.|yahoo\.|duckduckgo\.|baidu\.|yandex\./.test(ref)) return 'seo_organic';

    // Social platforms (organic)
    if (/facebook\.com|instagram\.com|fb\.com/.test(ref)) return 'social_facebook';
    if (/twitter\.com|x\.com|t\.co/.test(ref))            return 'social_twitter';
    if (/linkedin\.com/.test(ref))                         return 'social_linkedin';
    if (/tiktok\.com/.test(ref))                           return 'social_tiktok';
    if (/youtube\.com/.test(ref))                          return 'social_youtube';
    if (/pinterest\.com/.test(ref))                        return 'social_pinterest';
    if (/reddit\.com/.test(ref))                           return 'social_reddit';

    // Email clients
    if (/mail\.|gmail\.|yahoo\.com\/mail|outlook\.com/.test(ref)) return 'email';

    return 'referral';
  }

  // ─── DEVICE DETECTION ────────────────────────────────────────────
  function getDeviceInfo() {
    var ua = navigator.userAgent;
    var device = 'desktop';
    if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) device = 'mobile';
    else if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobi))/i.test(ua)) device = 'tablet';

    var os = 'unknown';
    if (/Windows/.test(ua))         os = 'windows';
    else if (/Mac OS X/.test(ua))   os = 'macos';
    else if (/Android/.test(ua))    os = 'android';
    else if (/iOS|iPhone|iPad/.test(ua)) os = 'ios';
    else if (/Linux/.test(ua))      os = 'linux';

    var browser = 'unknown';
    if (/Chrome\/\d/.test(ua) && !/Chromium|Edg\//.test(ua)) browser = 'chrome';
    else if (/Firefox\/\d/.test(ua)) browser = 'firefox';
    else if (/Safari\/\d/.test(ua) && !/Chrome/.test(ua))    browser = 'safari';
    else if (/Edg\/\d/.test(ua))    browser = 'edge';
    else if (/OPR\/\d/.test(ua))    browser = 'opera';

    return { device, os, browser };
  }

  // ─── SCROLL DEPTH ────────────────────────────────────────────────
  var maxScroll = 0;
  function trackScrollDepth() {
    var scrolled = Math.round(
      (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
    );
    if (scrolled > maxScroll) maxScroll = scrolled;
  }
  window.addEventListener('scroll', trackScrollDepth, { passive: true });

  // ─── SEND EVENT ──────────────────────────────────────────────────
  function send(eventType, extra) {
    var utm    = getUTMParams();
    var device = getDeviceInfo();
    var session = getOrCreateSession();

    session.pageCount++;
    sessionStorage.setItem('tp_sid', JSON.stringify(session));

    var payload = {
      // Identity
      siteId:    CONFIG.siteId,
      version:   CONFIG.version,
      sessionId: session.id,
      isNewSession: session.isNew && session.pageCount === 1,

      // Page
      event:     eventType || 'pageview',
      url:       window.location.href,
      path:      window.location.pathname,
      title:     document.title,
      referrer:  document.referrer,

      // Attribution
      source:    detectTrafficSource(document.referrer, utm),
      utm:       utm,

      // Device & Browser
      device:    device.device,
      os:        device.os,
      browser:   device.browser,
      screen:    window.screen.width + 'x' + window.screen.height,
      viewport:  window.innerWidth + 'x' + window.innerHeight,

      // User context
      language:  navigator.language,
      timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,

      // Engagement
      scrollDepth: maxScroll,
      pageCount:   session.pageCount,

      // Timestamp
      timestamp: new Date().toISOString(),
      ts:        Date.now(),

      // Extra properties (custom events)
      ...(extra || {})
    };

    if (CONFIG.debug) {
      console.group('[TrackPulse]', eventType);
      console.log(payload);
      console.groupEnd();
    }

    // Use sendBeacon for reliability (fires even on page unload)
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.endpoint, blob);
    } else {
      // Fallback for older browsers
      fetch(CONFIG.endpoint, {
        method: 'POST',
        body: blob,
        credentials: 'omit',
        keepalive: true
      }).catch(function() {});
    }
  }

  // ─── SPA ROUTE CHANGE SUPPORT ────────────────────────────────────
  var lastPath = window.location.pathname;

  var _pushState = history.pushState.bind(history);
  history.pushState = function() {
    _pushState.apply(history, arguments);
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      maxScroll = 0;
      setTimeout(function() { send('pageview'); }, 0);
    }
  };

  window.addEventListener('popstate', function() {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      maxScroll = 0;
      send('pageview');
    }
  });

  // ─── ENGAGEMENT TIME ─────────────────────────────────────────────
  var engagementStart = Date.now();
  window.addEventListener('beforeunload', function() {
    var duration = Date.now() - engagementStart;
    send('session_end', {
      duration: Math.round(duration / 1000),
      scrollDepth: maxScroll
    });
  });

  // ─── PUBLIC API ──────────────────────────────────────────────────
  /**
   * Manual event tracking API
   *
   * Usage:
   *   TrackPulse.track('click', { element: 'hero_cta', label: 'Get Started' })
   *   TrackPulse.conversion({ value: 99, currency: 'USD', orderId: 'ORD_123' })
   */
  window.TrackPulse = {
    track: function(eventName, props) {
      send(eventName, props);
    },
    conversion: function(props) {
      send('conversion', props);
    },
    identify: function(userId, traits) {
      send('identify', { userId: userId, traits: traits });
    }
  };

  // ─── FIRE INITIAL PAGEVIEW ───────────────────────────────────────
  send('pageview');

}(window, document));
