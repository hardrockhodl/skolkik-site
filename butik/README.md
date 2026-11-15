# skolkik-butik

Cloudflare-worker som tar emot köphändelser från App Store (App Store Server
Notifications V2) och räknar dem, så att nya, uppsagda och utgångna
prenumerationer syns direkt i stället för dagen efter.

Bara för egen statistik. Workern får händelserna från Apple, aldrig från appen,
och sparar produkt, erbjudande, land, pris och Apples anonyma id för
prenumerationen. Inget namn, ingen mejl, inget om barnen. Nedladdningar kommer
inte den här vägen, de står i Sales and Trends.

| Sökväg        | Innehåll                                                         |
| ------------- | ---------------------------------------------------------------- |
| `POST /apple` | Apples notiser. Signaturen kontrolleras mot Apple Root CA G3     |
| `POST /google?token=…` | Google Plays notiser via Pub/Sub. Hemligheten i adressen krävs |
| `GET /stats`  | Aktiva, dagens händelser, 14 dagar bakåt, senaste 25. Kräver token |
| `GET /health` | När senaste händelsen kom                                        |

`/stats` visar produktion. Sandlådan (TestFlight) fås med `?env=Sandbox`.

Prenumerationer som startade innan workern kopplades in syns först när nästa
händelse kommer för dem (förnyelse, uppsägning, utgång).

## Utveckling

```bash
npm install
npm test        # kräver Node 22.5 eller senare (node:sqlite i testerna)
npm run typecheck
```

Testerna signerar med en egen kedja i `test/fixtures/testkedja.json`. Den har
inget med Apple att göra och godkänns inte av den driftsatta workern.

## Driftsättning

```bash
npx wrangler login
# D1-databasen skolkik-butik finns redan och står i wrangler.jsonc.
npx wrangler d1 migrations apply skolkik-butik --remote
npx wrangler secret put STATS_TOKEN           # valfri lång slumpsträng
npm run deploy
```

Hamnar på `https://skolkik-butik.chrs-lrssn.workers.dev`.

I App Store Connect: appen, App Information, App Store Server Notifications.
Sätt både Production Server URL och Sandbox Server URL till
`https://skolkik-butik.chrs-lrssn.workers.dev/apple`, version 2.

Läs av:

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" https://skolkik-butik.chrs-lrssn.workers.dev/stats
```

Ett köp i TestFlight ger en sandlådenotis och är enklaste sättet att se att
kedjan håller hela vägen.

## Google Play

Play skickar Real-time developer notifications till ett Pub/Sub-ämne, och en
push-prenumeration skickar dem vidare hit. Notisen innehåller bara händelsen
och köpets token, så erbjudande, pris och land saknas för Google. Token sparas
aldrig, bara dess SHA-256.

```bash
npx wrangler secret put GOOGLE_PUSH_TOKEN     # valfri lång slumpsträng
npm run deploy
```

I Google Cloud, projektet `neteye-play`:

1. Pub/Sub, skapa ämnet `play-rtdn` (utan standardprenumeration).
2. På ämnet, lägg till `google-play-developer-notifications@system.gserviceaccount.com`
   med rollen Pub/Sub Publisher.
3. Skapa en prenumeration på ämnet, leveranstyp Push, adress
   `https://skolkik-butik.chrs-lrssn.workers.dev/google?token=<GOOGLE_PUSH_TOKEN>`.

I Play Console: SkolKik, Generera intäkter med Play, Konfigurera
intäktsgenerering, Realtidsaviseringar för utvecklare. Ämnesnamn
`projects/neteye-play/topics/play-rtdn`. Knappen för testavisering ger en
`TEST` under `/stats?env=Sandbox`.
