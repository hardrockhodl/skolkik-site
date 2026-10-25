# matsedel-are

Cloudflare-worker som läser grundskolornas matsedel på
[are.se](https://www.are.se/kommun-och-politik/mat-och-maltider/mat-i-forskola-och-skola/matsedel-for-grundskolan)
en gång per dag och serverar den som JSON och kalender.

| Sökväg           | Innehåll                                              |
| ---------------- | ----------------------------------------------------- |
| `/matsedel.json` | Dagar från idag, eller från `?from=ÅÅÅÅ-MM-DD`        |
| `/matsedel.ics`  | Heldagshändelser att prenumerera på (`webcal://…`)    |
| `/health`        | Senaste försök, lyckade hämtning och fel              |

Sidan visar bara två veckor. Workern sparar passerade dagar i åtta veckor, så
att JSON med `?from=` och kalendern har lite historik.

Går sidan inte att tolka (inga dagar, ogiltiga datum, datum långt från idag)
skrivs ingenting över. Felet syns i `/health` och som misslyckad cron-körning.

## Utveckling

```bash
npm install
npm test
npm run dev   # sedan: curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"
```

## Driftsättning

KV-namnrymden `matsedel-are-MENU` finns redan och står i `wrangler.jsonc`.

```bash
npx wrangler login
npm run deploy
```

Hamnar på `https://are.skolkik.se` (egen domän, se `routes` i
`wrangler.jsonc`) och `https://matsedel-are.chrs-lrssn.workers.dev`.
Kalendern prenumereras på som `webcal://are.skolkik.se/matsedel.ics`.
