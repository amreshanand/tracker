const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "tempmail.com", "throwaway.email", "yopmail.com",
  "getnada.com", "maildrop.cc", "temp-mail.org", "fakeinbox.com",
  "trashmail.com", "mailnesia.com", "mytemp.email", "tempinbox.com",
  "spamgourmet.com", "emailondeck.com", "inboxbear.com", "burnermail.io",
  "mailexpire.com", "harakirimail.com", "mt2009.com", "mailmoat.com",
  "maileater.com", "mintemail.com", "sogetthis.com", "pookmail.com",
  "spambox.us", "spam.la", "spamdailynews.com", "thankyou2010.com",
  "mailshell.com", "binkmail.com", "mytrashmail.com", "trash2009.com",
  "mailexpire.com", "dontreg.com", "haltospam.com", "kasmail.com",
  "linkemail.com", "mycleaninbox.net", "mynetcorner.net", "nospamthanks.com",
  "mytrashmail.net", "trashinbox.net", "wuzup.net", "put2.net",
  "discardmail.com", "discardmail.de", "mailinater.com", "nepwk.com",
  "temporaryinbox.com", "temporaryemail.net", "sogetthis.com",
  "mailmetrash.com", "despam.net", "trashymail.com", "safe-mail.net",
  "spamspot.com", "spamcero.com", "spamdecoy.net", "spamfree24.com",
  "spamfree24.de", "spamfree24.eu", "spamfree24.info", "spamfree24.net",
  "spamfree24.org", "spamkill.info", "spamlot.net", "spamoff.xyz",
  "spamslicer.com", "spamthisplease.com", "spamtrail.com", "spamwc.de",
  "speed.1s.fr", "stuff.maybeyoureat.com", "suioe.com", "svxr.org",
  "telegrafux.ru", "temp.alternary.net", "temp-emails.com",
  "temp-mail.org", "temp-mail.ru", "tempail.com", "tempemail.biz",
  "tempemail.co.za", "tempemail.co", "tempemail.com", "tempemail.net",
  "tempinbox.co.za", "tempmail.co", "tempmail.it", "tempmail.ws",
  "tempmail.de", "tempmailer.com", "tempmailer.de", "tempsky.com",
  "tempthe.net", "thankyou2010.com", "thc.st", "thetrashmail.net",
  "thraml.com", "throwaway.email", "throwaway.de", "throwaway.xyz",
  "timagi.com", "trash2009.com", "trash2010.com", "trash-amil.com",
  "trash-mail.com", "trash-mail.de", "trash-me.com", "trashcanmail.com",
  "trashdevil.de", "trashemail.de", "trashemails.de", "trashinbox.com",
  "trashinbox.de", "trashmail.com", "trashmail.de", "trashmail.me",
  "trashmail.net", "trashmail.org", "trashmail.ws", "trashmailer.com",
  "trashmails.com", "trashymail.com", "trbvm.com", "tropicalbrown.com",
  "trungtamtoeic.com", "ttz5.com", "tualias.com", "uggsrock.com",
  "umail.net", "upliftnow.com", "uqq.net", "urfunktion.se", "uroid.com",
  "utiket.us", "valemail.net", "venompen.com", "veryrealleather.info",
  "veryrealemail.com", "vfemail.net", "vipmail.name", "vipmail.pw",
  "vipxm.net", "vnedu.me", "voemail.com", "vomoto.com", "vp.yzar.org",
  "vubby.com", "walkmail.net", "walkmail.ru", "wants.dickshots.com",
  "webm4il.info", "webmail.1up.orange.com", "webtrip.ch", "wetrainbayarea.com",
  "wh4f.org", "whatiaas.com", "whatpaas.com", "wholesalecheapjerseys.com",
  "williamcastillo.co", "winemaven.info", "wir.zp.ua", "wootap.net",
  "work4teens.com", "workinghomework.com", "worldbreak.com", "wpadmin.in",
  "wupics.com", "xagloo.com", "xemaps.com", "xents.com", "xmaily.com",
  "xoxox.cc", "xsimit.com", "xyzfree.net", "ycedr.com", "yep.it",
  "yogamaven.com", "yopmail.com", "yopmail.fr", "yopmail.net",
  "ypmail.webarnak.com", "yuurok.com", "zehnminuten.de", "zehnminutenmail.de",
  "zippymail.info", "zoaxe.com", "zoemail.org",
]);

const DISPOSABLE_REGEX = /^(mail|temp|trash|spam|throw|fake|burner)/i;

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  if (DISPOSABLE_REGEX.test(domain)) return true;
  return false;
}
