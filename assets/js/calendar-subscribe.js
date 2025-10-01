(function () {
  const link = document.querySelector('[data-calendar-subscribe]');
  if (!link) return;

  const CALENDAR_ID = 'Z2FtZXNsYWIuYmFuZ2Fsb3JlQGdtYWlsLmNvbQ';
  const GOOGLE_RENDER = `https://calendar.google.com/calendar/r?cid=${CALENDAR_ID}`;
  const GOOGLE_SUBSCRIBE = `https://calendar.google.com/calendar/u/0?cid=${CALENDAR_ID}`;
  const ICS_BASE = 'https://calendar.google.com/calendar/ical/gameslab.bangalore%40gmail.com/public/basic.ics';
  const WEB_CAL = ICS_BASE.replace('https://', 'webcal://');

  const navigatorInfo = typeof navigator !== 'undefined' ? navigator : {};
  const userAgent = (navigatorInfo.userAgent || '').toLowerCase();
  const platform = (
    (navigatorInfo.userAgentData && navigatorInfo.userAgentData.platform) ||
    navigatorInfo.platform ||
    ''
  ).toLowerCase();
  const maxTouchPoints = navigatorInfo.maxTouchPoints || 0;

  const isAndroid = userAgent.includes('android');
  const isIOS =
    /(iphone|ipad|ipod)/.test(userAgent) ||
    (platform === 'macintel' && maxTouchPoints > 1);
  const isMac = platform.includes('mac');

  let targetHref = GOOGLE_RENDER;

  if (isIOS) {
    targetHref = WEB_CAL;
  } else if (isAndroid) {
    targetHref = GOOGLE_SUBSCRIBE;
  } else if (isMac) {
    targetHref = WEB_CAL;
  } else {
    targetHref = GOOGLE_RENDER;
  }

  link.setAttribute('href', targetHref);
})();
