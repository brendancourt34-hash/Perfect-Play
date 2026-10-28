# Perfect Play — Stage 4: Champion Data Commercial Enquiry

**Status:** Outreach preparation only. No purchase, API key, schema change, or code change was made in this stage.
**Date:** 2026-09-04

---

## Official contact routes (verified)

Champion Data does not publish a self-serve API signup or public pricing — access is gated behind a sales/commercial conversation. Two legitimate, official contact routes were found:

### Option A — Website contact form (recommended primary route)

**URL:** https://www.championdata.com/contact/

This is Champion Data's own official contact page (verified live on `championdata.com`, their primary domain). It has no free-text subject line — instead:

| Field | What to enter |
|---|---|
| Name | Your name |
| Email | Your contact email |
| Organisation | "Perfect Play" (or your registered business name, if different) |
| **Areas of interest** (dropdown) | Select **"Sport Data Platforms"** — the closest match to an API/data-licensing enquiry. If that option isn't available when you open the form, **"Data & Analytics"** is the next-best fit. |
| Message | Paste the enquiry body below (everything from "Hi Champion Data team," down to the sign-off) |
| URL | Leave blank (this field appears to be a spam-trap/honeypot, not a real field) |

### Option B — Service Desk "Commercial Enquiries" (official fallback / more detailed route)

**URL:** https://championdata.atlassian.net/servicedesk/customer/portal/8

This is Champion Data's own Atlassian-hosted service desk (subdomain of `championdata.net`, operated by Champion Data — not a third party). Under **"Other Enquiries"**, select the **"Commercial Enquiries"** request type. The portal allows anonymous submission (no account required) based on its configuration. Use the same enquiry text as below in the description field.

### Note on a direct email address

Third-party contact-aggregator sites (not Champion Data's own domain) list **info@championdata.com.au** as a general/stat-enquiries address. This was **not found on any Champion Data–owned page** in this research, so treat it as **unverified — lower confidence**. If both official routes above go unanswered after a reasonable follow-up period, it's a reasonable fallback to try, but it is not the recommended first move.

---

## The enquiry (use as contact-form "Message" / service-desk description, or as an email body if a direct address is used)

**Subject (if sending as an email):**
> Perfect Play — NRL/AFL Sports Data API & Commercial Licensing Enquiry

**Body:**

> Hi Champion Data team,
>
> My name is [Your Name], and I'm reaching out on behalf of **Perfect Play**, a new Australian sports statistics and analysis product currently in development, covering NRL and AFL. Perfect Play is not yet launched and does not currently have users, customers, or revenue — this enquiry is to validate technical and commercial feasibility with a data partner before we commit to a provider.
>
> **The product concept:** for each round of a competition, Perfect Play identifies a fixed set of "qualifying" players based on their starting position in each game, and checks whether enough of them met a specific statistical condition. For NRL specifically, that means: identifying the four players who **started** each game at winger, and checking whether at least two of them scored a try. This calculation is repeated for every game in a round, and the round is flagged "Perfect" only if every game qualifies. We understand Champion Data is the official statistics provider to both the NRL and the AFL, which is why we'd like to explore a data partnership rather than build on a lower-confidence source — the accuracy of "who actually started in which position" matters more to us than raw stat volume.
>
> We'd appreciate your help confirming the following before we proceed:
>
> **Data coverage & accuracy**
> 1. Can you provide NRL historical match data for the 2024, 2025, and 2026 seasons, plus ongoing access to future seasons?
> 2. Can your data identify the actual four players who **started** each NRL game at the winger position specifically?
> 3. Does your lineup data distinguish between: players named in the squad, interchange/bench players, players who came on as a substitute, and players who started the match but were replaced?
> 4. Does your player data include a unique player ID, team ID, position, try-scoring data, and other game-by-game statistics?
>
> **Access & storage**
> 5. Is historical and ongoing data available via an API or data feed (rather than manual export)?
> 6. Would we be permitted to store the licensed historical data in our own database for our application's use?
> 7. Would we be permitted to calculate and store our own derived statistic from your data — specifically, a simple boolean per game ("Perfect Play = at least 2 of the 4 starting wingers scored a try") — and display that derived result publicly within our product?
>
> **Restrictions & scope**
> 8. Are there any restrictions on displaying player names, team names, or statistics; storing historical data; performing derived calculations; or using the data within a commercial SaaS product?
> 9. Could the same agreement also provide AFL data? If so, could you outline what AFL data and lineup/statistical detail is available?
>
> **Access options & commercials**
> 10. What API or data feed options do you offer, and is there a sandbox, trial, or sample feed available?
> 11. Could you provide a sample historical NRL match payload showing lineup, position, and statistical data, so we can confirm it meets our technical requirements?
> 12. What does your pricing structure look like — is there startup/developer pricing, or is pricing usage-based, tiered, or fully custom? Is there a minimum contract term or setup fee?
>
> We're happy to jump on a call to go through the above in more detail. Thank you for your time — we look forward to hearing from you.
>
> Kind regards,
> [Your Name]
> [Your Role / Perfect Play]
> [Your contact email / phone]

---

## Notes on how this maps to the brief's 15 confirmation points

Every numbered question in Stage 4's brief is covered above:

| Brief's question | Covered by enquiry item |
|---|---|
| 1. 2024/2025/2026/future NRL data | Q1 |
| 2. Actual starting 4 wingers | Q2 |
| 3. Starting vs interchange vs subbed vs named-but-didn't-start | Q3 |
| 4. Player ID, team ID, position, tries, game stats | Q4 |
| 5. API/feed for historical data | Q5 |
| 6. Store licensed data in our own Postgres | Q6 |
| 7 & derived-stat definition. Calculate/store our own derived statistic | Q7 (includes the exact Perfect Play definition, as instructed) |
| 8. Display derived results publicly/commercially | Folded into Q7 ("display that derived result publicly") |
| 9. Restrictions on names/teams/stats/storage/derived calcs/commercial SaaS | Q8 |
| 10–11. Same agreement for AFL, what AFL data | Q9 |
| 12. API/feed options | Q10 |
| 13. Pricing structure (startup/dev/monthly/annual/usage/enterprise/minimum term/setup fee) | Q12 |
| 14. Sandbox/trial/sample feed | Q10 |
| 15. Sample historical NRL match payload | Q11 |
