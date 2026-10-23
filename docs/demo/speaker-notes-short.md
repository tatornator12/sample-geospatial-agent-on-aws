# Agentic AI for Earth: short speaker notes

One section per act, in show order. The full script, timings and fallbacks are in `rehearsal-notes.md`. Plain words first; the *Technical* lines are for the engineers in the room, so use them only if the room leans that way.

## The thread: what "agentic" means here

Say a version of this once, early in Act 1, then point back to it in each act.

A fixed pipeline runs the same steps whatever the data says. These agents get a goal, some rules and a set of tools, and they decide the steps themselves: which data to fetch, whether it is good enough, what to check next and when to stop. Four things to point at in every act:

1. **It looks before it trusts.** The model looks at the actual picture, radar or terrain, not just the numbers, and turns down evidence that isn't good enough.
2. **It chooses, and says why.** Each choice shows on the left with its reason, often beside the options it didn't take.
3. **It shows its working.** Every layer on the map is evidence it used, and you can check it.
4. **It stops at the decision.** It drafts; a person files or approves. Rules in the tools, not just the prompt, keep it there: a tool refuses a step taken out of order.

Be candid: some data is prepared ahead of time (each act says which), and on today's data some choices land the same way every run. What makes it agentic is that the choice and its reason are real and on screen, not that the answer is a surprise.

## Why this is new (for the close, or when someone asks)

A few years ago each of these acts was a project: find the right archive, download it, write the processing, then have a specialist look. Three things changed.

- **The data is open and cloud-ready.** Sentinel-1, -2 and -5P, the Clay embeddings and the USGS terrain sit in open archives as files a program can read one piece of at a time. The agent fetches only the pixels it needs, in seconds.
- **Models can look and use tools.** A model can now look at a satellite picture and say "that's cloud" or "that wall is ploughed nearly flat", then call the right tool next. That is what lets it change course in the middle of a task.
- **Geospatial foundation models.** Clay turns every patch of land into a fingerprint, so "find places like this" becomes a search instead of a research project.

The guardrails are ordinary engineering: each agent is its own service on Amazon Bedrock AgentCore, the stage shows only checked values, and a person approves.

*Technical:* Strands agents on four AgentCore runtimes; Claude Sonnet 4.6 on Amazon Bedrock looks at rendered previews; cloud-optimised GeoTIFFs via STAC, GeoParquet via DuckDB; the model's choices reach the stage as fixed options, never free text.

Before the first click, in Act 1, point at the screen: "On the left, the agent's steps light up one at a time, with the images it looked at. On the map, every layer is evidence you can check. And watch for the moment a person decides."

---

## 1. Earth Analyst (about 6 minutes)

**What it shows:** the agent looks at the satellite picture before it measures, and finds places by example.

**What's agentic here:** in Bergen, the first picture it finds is cloudy over the city. A script would measure it anyway and hand you a wrong number without noticing. The agent looks, turns it down, says why and fetches a clear one. In the Central Park search it compares fingerprints across the state, then checks the top matches itself before it shows them.

**Why it matters:** a measurement is only as good as the picture under it. And "find more places like this" is how people actually search a landscape: for parks, for mines, for damage.

**The data, and where it comes from**
- Satellite pictures: Sentinel-2, from the European Space Agency's Copernicus programme, read from AWS Open Data.
- "Fingerprints" of what every patch of land looks like: Clay embeddings from LGND, made with the open Clay AI model, published on AWS Open Data.
- Place names from Esri, through its ArcGIS server for agents; outlines of places from OpenStreetMap.

**Beats**
1. **Click "A cloudy day, Bergen".** "It's measuring plant health in Bergen. It looks first: this picture is cloudy, so it turns it down and fetches a clear one." Point at "skipping 2025-09-06". Then: "That's the pattern for the whole talk. It looked, it judged, and it told us why."
2. **Click "Places like Central Park".** While the search runs: "It compares Central Park with about 190,000 patches of New York State, by what each looks like from space. Then it checks the top matches itself." Point at the dots, then the table.
3. **Hand off:** "Same eyes, a different question."

*Technical:* Sentinel-2 via Earth Search STAC; Clay v1.5 embeddings, cosine similarity, fanned out through AWS Lambda.

**The decision:** no approve step here. "The agent measures; a person decides what it means."

---

## 2. AI Archaeologist (about 4 minutes)

**What it shows:** the same eyes on a new problem, ancient earthworks, and only sites already on the public record. The agent looks at each similar site and says whether its walls still show in the ground.

**What's agentic here:** the matches come from the public record; the judgement is the agent's. For each similar site it cuts out the terrain around it, looks, and picks one verdict with a reason: still shows, faint, or cannot confirm. The tool won't accept a verdict before the look. At Seip the strongest thing in the frame is a rebuilt mound, so a careless reading would say "still shows". The agent judges the walls, not the mound, and says faint.

**Why it matters:** earthworks like these are being ploughed and built over. Knowing which ones still show tells the people who look after them where to go first, without someone opening and reading every terrain map by hand.

**The data, and where it comes from**
- Satellite pictures: Sentinel-2 (as before).
- Laser maps of the ground, with the trees and grass taken away: 1 m LiDAR from the US Geological Survey's 3D Elevation Program, prepared ahead.
- The sites: public listings from UNESCO, the National Park Service and state and tribal stewards.

**Beats**
1. **Click "The Octagon, from space".** "From space it still looks like a golf course. Now LiDAR: the walls stand up under the grass."
2. **Click "Where else, like this".** "Where else did people build this shape? It finds the sites whose published descriptions match, then looks at each one's LiDAR and says whether the shape still shows in the ground today." Point at a row: the site, its verdict, the reason, and the picture it judged.
3. "A measuring tool gives you a number. It can't tell you whether a wall ploughed nearly flat is still there to see. That's the agent's call, with its reason, and when it can't trace the walls it says so."

*Say it honestly:* the matches come from the record's descriptions, not from the LiDAR; the LiDAR is how it checks them.

*Technical:* USGS 3DEP 1 m terrain, pre-rendered; the agent cuts the 1.2 km around each match, looks at it, and records one verdict from a fixed set; the tool refuses a verdict made before the look.

*Spare, asked only:* "Measure the Great Circle". "It measures across the bank and ditch and puts its number next to the published one."

**The decision:** built in. "It only works with sites already on the record: publishing unknown sites puts them at risk of looting."

---

## 3. Methane Watch (about 6 minutes)

**What it shows:** one question, a whole mission on live satellite data: a wide daily scan, a sharper check, a second opinion, the ground record, and a draft brief for a person to file.

**What's agentic here:** it plans the mission and says the plan out loud. It judges each EMIT pass against that pass's own noise and rejects the weak ones; they dim on screen. It picks which site to follow by a stated rule, the newest confirmed detection (the stronger tip when neither site has one), and keeps both sites' tallies on the board so the room can see the choice. Then it makes one call for the analyst: does this site need a new fine-scale look, and why. It picks from fixed answers, and the tool turns down a call the record contradicts. When a check can't see, because of cloud or no coverage, it says "cannot assess" rather than guessing.

**Why it matters:** methane traps about 80 times as much heat as carbon dioxide over its first 20 years, so finding the big sources and fixing them pays off quickly. A daily global scan only says "somewhere around here"; this turns it into a named site, its record, and a brief someone can act on.

**The data, and where it comes from**
- A wide, coarse view of methane every day: TROPOMI on the European Space Agency's Sentinel-5P, read from AWS Open Data.
- A sharp view, a few times a year at any one place: NASA's EMIT instrument on the International Space Station, from NASA's data archive.
- A second opinion: Carbon Mapper's public catalogue of methane plumes, seen by the Tanager-1 satellite and by EMIT, from data.carbonmapper.org (about a month behind; the stage shows its source wherever its numbers are).
- The ground record: fires from NASA FIRMS, mapped buildings and pipelines from Overture Maps, and public facility registries (OGIM and Global Energy Monitor).
- Prepared ahead: the scans and pass checks are warmed the day before and on the morning; anything missing is fetched live.

**Beats**
1. **Click "Methane Watch brief".** "It states a plan. First a wide satellite scans nine areas over the last two weeks: that's a tip, not a finding."
2. "Then it checks EMIT's record over the two strongest tips, pass by pass, and rejects the weak ones." Point at the dimmed frames.
3. "Then a second opinion: Carbon Mapper's plumes near both sites." Point at the "Carbon Mapper:" line under each tally.
4. "It follows the site with the newest confirmed detection, an EMIT candidate pass or a Carbon Mapper plume, and says both dates. If neither site has one, it follows the stronger tip." Point at "following". Under that site's filmstrip, a timeline lines up its record since January 2025: the tip, every EMIT look, Carbon Mapper's plumes within 7 km. "On the EMIT row, a filled dot is methane seen, a ring is a pass too faint or within noise, a grey tick is cloud." Then the 3D columns, when there is a candidate pass.
5. "Then the ground record, and a draft brief. It lists what's on the ground without naming a cause. And it makes one call: does this site need a new fine-scale look." Point at the card's line, for example "No fine-scale confirmation is on record here. The agent recommends a new fine-scale look."

*Say it honestly:* the tip is the last two weeks; EMIT's confirmations and Carbon Mapper's plumes are records since 2025, with dates on the timeline and the card, and the newest date decides which site it follows. Any rate is Carbon Mapper's estimate, not EMIT's. Use the card's words: "methane keeps showing up here" only when it says so (confirmed on three or more dates), "methane has shown up here before" with fewer, and "no fine-scale confirmation is on record" with none. Never "now", "still", "active" or "leaking".

*When the site has a confirmation:* the timeline draws one bracket from the latest one to the tip, with the gap in words ("30 Nov 2025 to the tip: about 10 months"), and the card says the same gap. Over 90 days, the agent recommends a new fine-scale look. If someone asks why the gap: "EMIT rides on the Space Station and can't be pointed, so it sees any one place only now and then. Carbon Mapper publishes about a month after it sees a plume. The tip is fresh; the confirmation is the record, and the bracket shows how old it is."

*Technical:* TROPOMI 14-day composites; EMIT V002 passes to 31 August 2026 and NASA's V003 after; each pass judged against its own noise and its mirror (methane counts only if pixels well above the background outnumber those as far below it three to one); Carbon Mapper plumes within 7 km since 2025; VIIRS, Overture, OGIM. The call is one of two fixed answers with one of four reasons, checked against the records by the tool, which writes the card's line itself.

**The decision:** you, as the analyst. "It's a draft. Nothing is filed until I approve it." Press "Approve and file".

---

## 4. Dark Vessels, the closer (about 8 minutes)

**What it shows:** one open question. The agent chooses its data, checks whether it can trust it, predicts where to look, and drafts a patrol for the officer.

**What's agentic here:** it chooses which radar pass to read, and the pass board shows why. Before it reads anything into a silence, it checks where broadcasts were being received at all, and holds itself to a standard: a pass that can check less than 15% of the reserve gets set aside. It flags a ship only where both radar detectors agree and broadcasts were being received. Then it forecasts where to look, shows how well that forecast has done before, and drafts the tasking. The officer decides. (To show it setting a thin pass aside on demand, use "Same question, end of August", after pressing New session.)

**Why it matters:** a ship that switches off its broadcasts disappears from the usual tracking, but radar sees it through cloud and at night. Patrol boats are few and the reserve is large, so where to send them next is the real decision.

**The data, and where it comes from**
- Radar that sees ships through cloud and at night: Sentinel-1, from the European Space Agency, read through Microsoft's Planetary Computer.
- Ships' own position broadcasts (AIS) and vessel detections: Global Fishing Watch.
- When the radar looks next: the European Space Agency's published plans, read live.
- The reserve's boundary: the World Database on Protected Areas.
- The radar and broadcasts are prepared ahead; the agent's analysis and choices run live.

**Beats**
1. **Click "Who is there without broadcasting, and where next?".** Point at the board: "It chose the radar pass, and told us why."
2. When the route lines fade and the dots stop moving: "These dots are the ships' broadcasts, each placed where that ship was at the minute the radar passed. Those are what it compares with the radar." The dots stay on the map to the end, fainter once the forecast is up, and the key on the right names each mark.
3. "First it checks where broadcasts could be received at all. Silence only means something there." Point at "can check 19%".
4. "These four are radar targets in water where broadcasts were being received, but with no broadcast of their own: a reason to look."
5. "Where to look next: its forecast has a measured record, and the satellite's next pass over each box." Point at the boxes.
6. **As the officer:** "The agent drafts; it never files." The plate opens under the key, so the room can still read what each ring is. Choose the box, press "Approve the tasking", and point at the Slack post on the second screen.

*If someone asks how the broadcasts line up with the radar:* "The radar is one snapshot, 00:18 UTC on 12 October. Broadcasts come from Global Fishing Watch as one position per ship per hour. For each ship the agent takes the position before and after, and places it where it would have been at 00:18. Where Global Fishing Watch's own radar also saw the ship, its match against the full broadcast record decides whether that ship was broadcasting; for targets only our detector saw, a dot within a kilometre decides. The 'can check' figure counts water where at least two ships were picked up within 30 kilometres in an hour, in the three hours either side of the pass. The limit is speed: at ten knots a ship covers about 18 kilometres an hour, so a dot can be a few kilometres out." Short version for the room: "lined up to the minute of the radar pass; a dot can be a few kilometres out, so it leans on Global Fishing Watch's own match."

*Technical:* CFAR detector on Sentinel-1 at 20 m, paired with Global Fishing Watch's detections within 1 km; AIS hourly, interpolated to the pass minute; coverage from hourly AIS within ±3 h; the forecast is refitted before each radar day from past unmatched detections; the agent's choices go to the stage as fixed options, never free text.

**The decision:** you, as the officer. Then go back to the deck for the close.
