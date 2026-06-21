import { Router } from 'express';
import webpush from 'web-push';

const router = Router();

const VAPID_PUBLIC  = process.env['VAPID_PUBLIC_KEY']  || 'BLlPmW00bzDvxEV_q1aBa-pqnBX60DA2AGUbZSRg0k3Fkeu2xASDo3ycT1HWL3cyCon-t8rXKVfmpRs4YZqELjs';
const VAPID_PRIVATE = process.env['VAPID_PRIVATE_KEY'] || 'NaSi3INcMRbzKHtN0608cHGe1-73A4znMkGiawJrcSQ';

webpush.setVapidDetails('mailto:admin@mygirls.app', VAPID_PUBLIC, VAPID_PRIVATE);

type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
type ScheduleEntry = {
  sub: PushSub;
  intervals: Record<string, number>;
  personaNames: Record<string, string>;
  lastSent: Record<string, number>;
};

const subscriptions = new Map<string, ScheduleEntry>();

const MESSAGES = [
  'என்ன பண்ற? miss ஆகுது 😊',
  'நீ வருவியா? 🥺',
  'ஏன் chat பண்ணல? 💕',
  'Hello?? 👋 நான் இங்க இருக்கேன்!',
  'என்னங்க, மறந்துட்டீங்களா? 😅',
  'உன்னோட voice கேக்கணும் 🥹',
  'யோவ்... response குடு! 😤',
  'உன்னோட message-கு wait பண்றேன் 💬',
];

function sendPushToSub(sub: PushSub, payload: object) {
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: sub.keys },
    JSON.stringify(payload),
  ).catch(() => {});
}

setInterval(() => {
  const now = Date.now();
  for (const [, entry] of subscriptions) {
    for (const [personaId, intervalMin] of Object.entries(entry.intervals)) {
      const last = entry.lastSent[personaId] ?? 0;
      if (now - last >= intervalMin * 60 * 1000) {
        entry.lastSent[personaId] = now;
        const name = entry.personaNames[personaId] ?? 'AI Girl';
        const msg  = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
        sendPushToSub(entry.sub, {
          title: name,
          body: msg,
          personaId,
          icon: '/icon.png',
          badge: '/icon.png',
        });
      }
    }
  }
}, 30_000);

router.get('/push/vapid-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

router.post('/push/subscribe', (req, res) => {
  const { subscription, intervals, personaNames } = req.body as {
    subscription: PushSub;
    intervals: Record<string, number>;
    personaNames: Record<string, string>;
  };
  if (!subscription?.endpoint) { res.status(400).json({ error: 'invalid' }); return; }

  const existing = subscriptions.get(subscription.endpoint);
  subscriptions.set(subscription.endpoint, {
    sub: subscription,
    intervals: intervals ?? {},
    personaNames: personaNames ?? {},
    lastSent: existing?.lastSent ?? {},
  });
  res.json({ ok: true });
});

router.post('/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body as { endpoint: string };
  subscriptions.delete(endpoint);
  res.json({ ok: true });
});

export default router;
