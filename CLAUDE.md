# skolkik.se (sajten) – så jobbar vi

Svenska i allt: texter, kommentarer, commits, svar. Korta svar. Inga tankstreck i text.

## Vad som ligger här
- Statisk sajt på GitHub Pages (`CNAME` skolkik.se): startsida, artiklar (`unikum-*/`), villkor (`/villkor/`) och integritetspolicy (`/integritet/`). Ingen byggkedja, ren HTML och `style.css`.
- `matsedel/` är Cloudflare-workern bakom `are.skolkik.se`: hämtar Åre kommuns offentliga matsedel en gång per natt och lämnar ut den till appen. Den tar inte emot något från appen.
- Apparna ligger i `~/github-hardrockhodl/skolkik` (iOS, huvudrepo) och `~/github-hardrockhodl/skolkik-skip` (Android).

## Regler som inte får brytas
- Villkor och integritetspolicy ska stämma med vad apparna faktiskt gör. Ändras texten här utan att appen ändrats, eller tvärtom, säg till.
- Sajten och workern lovar samma sak som appen: inget om barnen lämnar telefonen, ingen Unikum-trafik i bakgrunden. Workern får aldrig börja ta emot data.
- Spårning (Meta-pixeln) laddas bara efter samtycke via `samtycke.js`. Nya skript från tredje part följer samma väg.

## Utan att fråga, och med ja först
- Utan att fråga: läsa och ändra filer här, köra workerns tester lokalt.
- Med Chris ja först: commit, push (push publicerar sajten direkt), `wrangler deploy`, ändringar i villkor och integritetspolicy utöver det Chris bett om.
- Fråga inte mitt i en uppgift om du ska fortsätta. Stanna när nästa steg kräver Chris: granskning av juridisk text, commit eller deploy.

## Slutrapport
Kort, och läsbar utan att ha sett arbetet: alla ändrade filer, vilka sidor som påverkas, om `sitemap.xml` behöver uppdateras och om butikstexterna i app-repona berörs.

## Att tänka på
- Samma topp och footer på alla sidor. Ny sida läggs också i `sitemap.xml`.
- `/versioner/` är versionshistoriken, uppdelad på iPhone och Android. Ny version i butik läggs överst under rätt plattform, med bara det som faktiskt är släppt. Ändra samtidigt datumet i sidhuvudet, `dateModified` och `lastmod` i `sitemap.xml`.
- Jobbdatorns Cisco Umbrella spärrar skolkik.se. Kontrollera via `dig @1.1.1.1` innan något kallas trasigt.
- Commit-meddelanden på svenska utan å, ä och ö, som i historiken.
