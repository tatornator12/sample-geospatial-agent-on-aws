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

*About 6 minutes. The mission takes 69 to 80 seconds of agent time (two live runs on 26 October; up to 151 s on a cold fortnight). The script runs about 4 minutes from the switch to the hand-off with a warm mission, about 5 with a cold one, so the rest is margin. Have ready: the methane caches warmed that morning (`scripts/warm_watch.py`). Switch with the agent switcher, top right, to "Methane Watch". If the column still shows an earlier mission, press New session (the circular arrow at the right end of the console) first.*

**Point to land:** From one question the agent runs a whole mission on live satellite data, judges its own evidence, chooses which spot to follow and says why, and leaves the filing to a person.

*Times are seconds after the click, lowest to highest over two live runs on 26 October (fortnight 11 to 24 October). Quoted lines are as the screen showed them that day; the live fortnight changes the place, the dates and the numbers, so read figures off the screen. Never say "now", "still", "active" or "leaking"; any rate is Carbon Mapper's estimate.*

**1. Over the globe, before the click**
- **Do:** switch to "Methane Watch" and wait for the globe: white dots, rings marked "×5" to "×10", nine dashed boxes. Talk over it while the runtime warms.
- **Point at:** a ring, then a dashed box.
- **Say:** "Methane traps about 80 times as much heat as carbon dioxide over its first 20 years, and you can't see it. Each dot is a place NASA's EMIT instrument saw a methane plume between 2022 and 2025; a ring means plumes on five or more dates. The dashed boxes are nine areas we watch. I'll ask the agent for a brief on them."

**2. The plan (about 2 s)**
- **Do:** click "Methane Watch brief". Wait for the plan strip at the top of the column: "Baseline · Tip · Cue · Check · Brief".
- **Say:** "It starts with a plan: baseline, tip, cue, check, brief."

**3. The wide scan (6 to 13 s)**
- **Do:** wait for "Tip" to light and "Scan 9 watch areas" (it counts up from 2). The board's rows fill at 11 to 13 s, and the strongest tips show on the globe with their numbers.
- **Point at:** the board's top row ("Shanxi and Ordos coal basins, China" and "+112.8 ppb" on 26 October).
- **Say:** "First the wide view: a satellite instrument, TROPOMI, scans all nine areas over two weeks. A tip, not a finding."

**4. The sharp look (about 15 s)**
- **Do:** wait for "Cue" and "Cue EMIT on 2 sites".
- **Say:** "Next, the sharp view: EMIT, on the Space Station."

**5. It judges every pass (19 to 21 s)**
- **Do:** wait for the filmstrips under "Cue EMIT on 2 sites", one per site ("Newest 8 of 20 EMIT passes"), each with a verdict line under it ("6 candidates · 2 too weak · 9 within noise · 3 cloud or gap" for Shanxi on 26 October). "Check Carbon Mapper on 2 sites" lights at 21 to 24 s, and the board adds a "Carbon Mapper:" line under each cued row.
- **Point at:** a frame with an orange edge, then the verdict line.
- **Say:** "It judges every pass against its own noise. Orange edge: methane. The rest it set aside, with a reason."

**6. It chooses which spot to follow (27 to 28 s)**
- **Do:** wait for "Follow one site" and its line; the board's top row gains "following". On 26 October the line read: "Methane was last seen up close at the top spot in Shanxi 78 days before this fortnight, within 90 days, so the agent stays with it and checks no more spots."
- **Point at:** the line under "Follow one site".
- **Say:** "Its choice, and why: seen up close here 78 days before this fortnight, inside its 90-day rule, so it stays." Say the days the line gives. The tip bars follow about 3 s after the line, so keep to this one sentence.
- If the line says it "is following the second spot" or "the third spot" (two steps come first, "Check N more spots with EMIT" and "Check Carbon Mapper on N more spots"): "The top spot's close look is too old for its 90-day rule, so it switched to a fresher spot."
- If it says "and at none of the N next spots within 90 days, so the agent stays with it": "Its close look is old, and none of the next spots is fresher, so it stays, and says so."
- If it says "so the agent follows the stronger tip": "Neither spot, nor the next ones, was seen up close within 90 days, so it follows the stronger tip, and says so."
- If it says "during this fortnight": "It was seen up close during this very fortnight, so it stays."

**7. The tip in 3D (30 to 34 s)**
- **Do:** wait for "Show the tip in 3D". The camera leaves the globe and dives to the spot, tilted (31 to 34 s); the legend reads "TROPOMI, 11 to 24 Oct 2026". Three ground checks light within a second or two ("Check for heat", "Check what is mapped nearby", "Check the public registry"), then "Look at the image": let them pass, cue 9 covers them.
- **Point at:** the bars.
- **Say:** "The wide view, in 3D, around that spot." If the thin columns of cue 8 are already rising, skip this line.

**8. The latest close look (38 to 43 s)**
- **Do:** wait for "Show the latest close look in 3D" and its line ("EMIT saw methane here on 25 July 2026." on 26 October). The bars give way to thin columns and the camera moves closer (settled at 42 to 45 s); the legend reads "EMIT, 25 Jul 2026", and in the layers list "TROPOMI around the site, in 3D" is unticked.
- **Point at:** the tallest column, then the legend.
- **Say:** "And its latest close look: EMIT, on 25 July. The record, older than the tip; the screen dates both."
- If the line reads "Carbon Mapper's image of this plume," and a date: "And its latest close look: Carbon Mapper's image of this plume, from [26 August]. The record, older than the tip."
- If no "Show the latest close look in 3D" step comes and the tip bars stay: "There's no close look on record here, so these bars stay the wide view's. The brief will say so."

**9. The ground (40 to 51 s)**
- **Do:** wait for "Fetch Sentinel-2", then "Look at the image" with a "Sentinel-2 true colour" picture (47 to 51 s).
- **Say:** "Meanwhile it checked the ground record, and it looks at an ordinary photo of the ground."

**10. While it drafts (52 to 54 s; the card comes at 69 to 80 s)**
- **Do:** wait for "Brief" on the plan strip and "Draft the brief". For the next 15 to 26 s only the agent's own quoted lines change; don't read those out.
- **Say:** "Next it drafts the brief. It lists what's on the ground but names no cause: these sources can't prove one. And it makes one call: does this spot need a new close look?"
- If the card is slow (a cold fortnight can take over two minutes): "Everything on this map is evidence it used, and each layer can be switched off and checked."

**11. The draft brief (69 to 80 s)**
- **Do:** wait for the card at the top of the column: "Draft brief", its title ("Recurring methane near Pingding County, Yangquan City, Shanxi Province, China" on 26 October), and above it the chain "Tip … → Cue 6 of 20 passes → Check 3 records → Brief".
- **Point at:** the chain line, then the end of the paragraph under the title.
- **Say:** "Here's the draft. The top line is the whole mission: tip, cue, check, brief. EMIT looked here 30 times since January 2025; it could read 20 of those passes, and 6 passed its test for methane. And here is its one call:" Then read the call as the card has it, on 26 October "Methane was last seen up close here 78 days before this fortnight. No new close look is needed yet.", and add: "Inside 90 days, so the record is recent enough to stand on."
- If it ends "The agent recommends a new close look.": "That record is too old to stand on, so it asks for a fresh look instead of guessing."
- If it reads "No close look has confirmed methane here, so the bars are TROPOMI's only.": "Only the wide view has seen methane here, so it asks for a close look first."
- If it adds "EMIT's last look, on" a date, "was clouded out.": "Its last look was cloud, which tells us nothing either way."

**12. What it claims, and what it doesn't**
- **Point at:** "Methane recurs here" ("Moderate" on 26 October), "Cause", the line under "INDEPENDENT DETECTIONS", then "GROUND RECORD".
- **Say:** "It rates how often methane recurs here, and it leaves the cause open until someone checks on the ground or from an aircraft. Below that, the second opinion: Carbon Mapper lists no plume within 7 kilometres since January 2025. Then the ground record: night-time heat, what's mapped nearby, and a public registry. The scans and pass checks were warmed into our cache this morning; the choice of spot, the call and this brief were made live."
- If the line lists plumes: "Carbon Mapper lists [16] plumes within 7 kilometres; that rate is Carbon Mapper's estimate, not ours."

**13. Why this spot, on its record (about 30 s)**
- **Do:** scroll the column up until "Follow one site" sits near the bottom and the record above the frames is in view: rows for "TROPOMI", "Carbon Mapper" and "EMIT", the years along the bottom, the latest close look's date ("25 Jul 2026") and a bracket to this fortnight ("78 days to 11 Oct" on 26 October).
- **Point at:** the bracket.
- **Say:** "This is the spot's record: one row per instrument, dates along the bottom. The bracket is the gap from the latest close look to this fortnight. That's the number its rule checked, and the one its call rests on."
- **Do:** scroll back down to the card's buttons.

**14. The decision (you, as the analyst)**
- **Say:** "A daily scan only says 'somewhere around here'. This turns it into a named site, its record and a brief. It's a draft. I'm the analyst, and nothing is filed until I approve it."
- **Do:** click "Approve and file". Wait for "Filed by the analyst at … UTC. The agent did not file it." on the card; the agent then confirms in a short turn (the console stays greyed until it ends; not timed yet). Let the line speak.
- **Point at:** the filed line.

**Transition:** "That was a gas you can't see. The last act looks for ships the usual tracking can't see, at sea and at night, and asks where a patrol should look next." Then switch to "Dark Vessels".

*If asked*
- *Why is the close look older than the tip?* "EMIT rides on the Space Station and can't be pointed, so it sees any one place only from time to time, and Carbon Mapper publishes about a month after it sees a plume. The tip is this fortnight; the close look is the record, and the screen dates both."
- *Is this autonomous?* "No. I asked the question and I file the brief. In between, the agent chose its steps, read every pass, and chose which spot to follow by a rule it states on screen. The tool refuses a follow the record contradicts, and the screen's lines are written from the tools' records, not from the model's words."
- *What was prepared ahead?* "The satellite scans and pass checks are warmed into our cache the day before and on the morning, and anything missing is fetched live. The choice of spot, the call and the brief run live."
- *How does it judge a pass?* "A pass counts only when enough pixels clear three times their own uncertainty, and the strong pixels above the background outnumber those as far below it three to one. Noise goes both ways; a plume doesn't."

*If it fails*
- No card about 2:30 after the click, an error, or no EMIT tallies on the board (NASA's archive didn't answer): press Esc and load `/?scenario=methane-watch-bars&agent=methane`; it plays in about 10 s. Say: "This is a recording of the same mission, for the fortnight of 5 to 18 October. That time it switched: the top spot's close look was 117 days old, so it followed the third spot in the south Caspian, seen up close 40 days before. A recording doesn't replay the decision; live, this is where I'd file it." Its card reads "Recorded case: the decision is made live, not replayed." Leave it with `/?agent=methane` or New session.

*Data sources*
- Wide, coarse methane every day: TROPOMI on the European Space Agency's Sentinel-5P, from AWS Open Data.
- Sharp views, a few times a year at any one place: NASA's EMIT on the International Space Station, from NASA's data archive (V002 to 31 August 2026, V003 after).
- Second opinion: Carbon Mapper's public plume catalogue (the Tanager-1 satellite and EMIT), data.carbonmapper.org, about a month behind; the stage shows its source wherever its numbers or its image are.
- The ground: night-time heat from NASA FIRMS, mapped buildings and pipelines from Overture Maps, public facility registries (OGIM and Global Energy Monitor), and a Sentinel-2 photo.
- Prepared ahead: the scans and pass checks, warmed the day before and that morning; anything missing is fetched live.

---

## 4. Dark Vessels, the closer (about 8 minutes)

*About 8 minutes. The question takes 61 to 66 seconds of agent time (two live runs on 26 October, stable runtime). The script reaches the Slack post about 4 minutes after the switch, which leaves about 4 minutes for a retry (about 1:30), the replay, or questions. Have ready: the second screen with Slack open on the "Patrol taskings" channel, newest post in view; the radar plans warmed that morning (`scripts/warm_vessels.py`). Switch with the agent switcher to "Dark Vessels". Press New session only if this tab ran "Same question, end of August".*

**Point to land:** The agent picks its own radar pass, checks that a missing broadcast can mean anything before it reads one, predicts where to look with a measured record, and drafts a patrol that only the officer can send.

*Times are seconds after the click, lowest to highest over two live runs on 26 October. Quoted lines are as the screen showed them that day; after the 5 November data refresh the passes, the counts and the figures can change, so read them off the screen.*

**1. The reserve at night, before the click (about 45 s)**
- **Do:** switch to "Dark Vessels" and wait for the top-centre clock "AIS replay" with a date and time, and moving lights inside a dashed outline.
- **Point at:** a moving light, then the dashed line.
- **Say:** "This is the Galápagos Marine Reserve at night; the dashed line is its edge. Each moving light is a ship's own position broadcast, called AIS, replayed from the 36 hours before a radar pass. It's a replay, not live: Global Fishing Watch runs a few days behind. A ship that switches its broadcast off drops out of this picture, but radar still sees it, through cloud and in the dark. Patrol boats are few and the reserve is large, so the officer's question is: is anyone in the reserve without broadcasting, and where should the patrol look next?"

**2. The question (0 to 2 s)**
- **Do:** click "Who is there without broadcasting, and where next?". The question shows at the top of the column, and the clock's second line becomes "while the agent chooses a radar pass".
- **Say:** "First it has to choose which radar pass to read."

**3. It chooses the pass, and says why (4 to 8 s)**
- **Do:** wait for "Weigh the passes on file" and its board, "share of the reserve each pass imaged", newest first ("Oct 12 S1D 53%" on top); then "Find the radar pass" and its line (7 to 8 s): "Decided: Reading Oct 12: the newest pass on file. It saw 53% of the reserve."
- **Point at:** the board, then the "Decided:" line.
- **Say:** "These are the radar passes on file, with how much of the reserve each one saw. It chose Oct 12, the newest, and that line says why."
- If the line reads "the newest pass that saw over half the reserve": "The newest pass saw only [31%] of the reserve, so it chose the newest one that saw over half, and that line says why."
- If it reads "Set" a date "aside: it can check only": "It set that pass aside: too little of the reserve could be checked. It reads another instead."
- If it reads "of the passes on file, it saw the most of the reserve": "It chose the pass that saw the most of the reserve."
- "Look at the radar" lights next (10 to 11 s), with the radar picture as a chip: it looks before it uses it.

**4. The radar (15 to 20 s)**
- **Do:** wait for the radar swath on the map and the clock "Sentinel-1D radar 2026-10-12 00:18 UTC", "142 ships broadcasting at the radar minute"; the moving lights stop. At 19 to 20 s the clock changes to "22 radar targets", "4 accounted for by a broadcast · 3 at port · 15 not yet explained", with rings on the water.
- **Point at:** a ring.
- **Say:** "That's the radar. Each ring is something on the water."

**5. Can a silence mean anything here? (21 to 27 s)**
- **Do:** wait for "Check where AIS was received" and its line "Checked: This pass can check 19% of the reserve, over the 15% standard."; the clock "This pass can check 19% of the reserve"; the plain wash labelled "AIS received" and the hatched water labelled "reception unknown" (23 to 27 s).
- **Point at:** the hatched water, then the "Checked:" line.
- **Say:** "Before a silence counts, it checks where broadcasts were received. This pass can check 19%, over its 15% standard."
- If the line reads "This pass can check only" and "under the 15% standard.": "Only [10]%, under its standard, so it won't read anything into a silence on this pass." A "Decided: Set … aside" line or "No tasking can be drafted." follows; read it as it stands.

**6. The candidates (29 to 34 s)**
- **Do:** wait for the clock "4 candidates", "no AIS where AIS was being received, seen by both detectors", and under "Match targets to broadcasts" the line "Checked: 4 candidates where AIS was received, seen by both detectors."; those rings turn pink, then get labels "T01 no AIS" to "T04 no AIS".
- **Point at:** a pink ring.
- **Say:** "Four candidates: radar targets with no broadcast, in water where broadcasts were received, seen by both detectors. Each one is a reason to look."
- If it reads "No candidates where AIS was received.": "No candidates on this pass: nothing unexplained where broadcasts were received."

**7. A closer look (31 to 38 s)**
- **Do:** "Gather the evidence" lights while you finish cue 6, with its chip, a close radar picture of one candidate ("Candidate T01, Oct 12" in one run, T04 in the other: the agent picks). Say this cue only if the glow of cue 8 hasn't appeared when cue 6 ends (it came 1 s after cue 6 in one run, 8 s after in the other).
- If the glow hasn't appeared: "It takes a closer look at one of them. Next, the patrol's question: where to look."

**8. Where to look next, with a record (42 to 52 s)**
- **Do:** wait for "Predict where to look" and the clock "Where to look on the next pass", "refitted before each radar day since July, its top 5% of water held 45% of the dark targets"; a pink glow spreads over the water. The clock holds this for only about 5 s before the boxes, so say the figure first.
- **Point at:** the clock's "45%", then the glow.
- **Say:** "Its forecast: the hottest 5% of water held 45% of the dark targets."

**9. Three boxes, and the draft (45 to 62 s)**
- **Do:** wait for three white squares, "Box 1" to "Box 3", each with its next radar look ("Box 2 Oct 29 00:25 UTC" on 26 October) or "no look planned yet", and the clock "Three patrol boxes"; then, under "When the radar looks again" (48 to 58 s): "Decided: Drafting box 1: it held the most past dark targets, 9%."
- **Point at:** the boxes, then the "Decided:" line.
- **Say:** "Three patrol boxes, each with its next radar look. It drafts box 1: the most dark targets before."
- If the step turns into "When the radar looks again ×2", the clock shows "Next radar look" with "from ESA's published plan", and "Draft the tasking" adds "Decided: Drafting box 2: its radar look comes first," and a time (one of the two runs on 26 October, at 54 to 58 s): "Then it read the radar plan and switched to box 2: the radar looks there first."
- If the first line already says "its radar look comes first": "It drafts box [2], because the radar looks there first."
- If it says the candidates "lie in or near it": "It drafts box [3], because today's candidates lie in or near it."
- If it says "the only box with a radar look planned": "It drafts box [2], the only one the radar will look at again."

**10. The draft lands (61 to 66 s)**
- **Do:** wait for the answer at the foot of the column ("4 candidates on the Oct 12 pass; I drafted box 1 for the next look.") and the tasking plate on the right, under the key. The layers list folds and the clock reads "Patrol tasking draft", "choose a box and the candidates, then approve".
- **Point at:** the plate's title, "Patrol tasking draft".
- **Say:** "And it stops at a draft. It can't send a patrol. Before I decide, three things stand behind it."

**11. Why the draft holds up (after the turn, about 60 s)**
- **Point at:** the hatched water and, in the key, "reception unknown: no AIS here proves nothing"; then a white dot beside a white ring; then a pink ring; then the answer's line "Refitted before each radar day since July, …".
- **Say:** "First, coverage. A missing broadcast only counts where other ships' broadcasts were coming through around the pass: the plain water. The 15% bar is our policy, set from the passes on file, and this pass cleared it. Second, the match. Each dot sits where its ship was at the minute of the radar pass, give or take a few kilometres, so where Global Fishing Watch's radar also saw a target, its own match decides. A candidate needs both detectors to agree, and it could still be a small boat, a missed broadcast, or not a vessel at all. Third, the forecast. The glow is where unexplained targets turned up before, and it's tested: before each radar day since July it was rebuilt from earlier data and checked against that day. Its hottest 5% of the water held 45% of the dark targets, about 9 times chance. The radar and the broadcasts were read ahead of time; the choices you saw were made live."

**12. The officer's choice**
- **Point at:** the box rows ("Box 1 9% of past dark targets", "no look planned yet"), the candidates ("T01 31 km from Baltra" and the rest), then the line above the buttons ("Patrol box 1 · check 4 of 4 candidates on the way").
- **Say:** "I'm the officer. Each box shows its share of past dark targets and when the radar looks next. Below are the four candidates, by distance from port, to check on the way. The line at the bottom is the whole tasking."
- **Do:** leave the agent's box selected and every candidate ticked. To show the choice is yours, click another box first (the line above the buttons changes with it, and a box not chosen steps back), or untick a candidate (its ring is then labelled "left out").
- **Say:** "Box 1 held the most dark targets before, so I'll take the agent's draft and check all four on the way."
- If the plate has box 2 selected because its look comes first: "The radar looks at box 2 first, so we can check what the patrol finds. I'll take the agent's draft and check all four on the way."

**13. The decision (you, as the officer)**
- **Say:** "The agent drafted it. I'm approving it."
- **Do:** click "Approve the tasking" (not "Not now"). The plate shows "Filed by the officer at … UTC. The agent did not file it.", and the clock "Patrol tasking filed", "box 1 · 4 of 4 candidates · next radar look not planned yet" (with a planned look, "next radar look in" and a countdown). No follow-up turn. Don't read the filed line out.

**14. The Slack post (second screen)**
- **Do:** turn to the second screen; the new post lands in "Patrol taskings" (works on the live site, seen 26 October; allow about 10 s).
- **Point at:** the post. Let it sit; don't read it out.
- **Say:** "And there's the tasking, in the channel the patrol team reads."
- If nothing has landed after about 10 s: "The filed line on the plate is the record; Slack is only the notice."

**Transition:** "That's the last act. Let me pull together what you just saw." Then back to the slideshow on slide 4, "What you just saw".

*If asked*
- *How do the broadcasts line up with the radar?* "The radar is one snapshot, 00:18 UTC on 12 October. Global Fishing Watch gives one position per ship per hour, so each dot is placed where that ship would have been at the minute of the pass. A dot can be a few kilometres out: at ten knots a ship covers about 18 kilometres an hour. So where Global Fishing Watch's own radar also saw a target, its match against the full broadcast record decides; for targets only our detector saw, a dot within a kilometre decides. 'Can check' counts water where at least two ships were picked up within 30 kilometres in one hour, in the three hours either side of the pass."
- *Is this autonomous?* "No. I asked, and I approved. In between, it chose the pass and the box and said why each time; its tools refuse a pass or a box it hasn't announced, and the stage's backend files the tasking, not the agent."
- *What was prepared ahead?* "The radar and the broadcasts were read into our cache before the show, and ESA's plan for the next look was fetched this morning. The checks, the choices and the draft ran live."
- *Would it choose differently?* Press New session, then click "Same question, end of August". It reads Aug 30 because the question names it ("Reading Aug 30, as asked"), finds it can check only about 10% of the reserve, under the standard, and sets it aside on a "Decided: Set Aug 30 aside: …" line before reading another pass. Don't approve that draft: it would file and post a second tasking.

*If it fails*
- The question stalls or errors: press Esc, reload `/?agent=vessels` and click the plate once more. Say: "Let me ask it once more."
- It fails again: load `/?scenario=vessels-open-question&agent=vessels`. It plays in about 12 s and ends on a read-only plate ("Recorded case: the decision is made live, not replayed."), with no approval and no Slack post. Its board has "Oct 17 S1D 31%" first and the line "Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%)."; its forecast reads 47%, and boxes 1 and 3 read "Oct 24 00:17 UTC, under way or passed". Say: "This is a recording of the same question, from a rehearsal. There the newest pass saw only 31% of the reserve, so it chose Oct 12. A recording doesn't replay the decision; live, I'd approve it here." Then the close, with its replay line (rehearsal notes, section 10).
- The replay won't load either: "The live run isn't cooperating today." One sentence on what the act does, then the close with its "didn't reach the tasking" line.

*Data sources*
- Radar that sees ships through cloud and at night: Sentinel-1, from the European Space Agency, read through Microsoft's Planetary Computer.
- Ships' own position broadcasts (AIS) and vessel detections: Global Fishing Watch.
- When the radar looks next: the European Space Agency's published plans, fetched that morning.
- The reserve's boundary: the World Database on Protected Areas.
- Prepared ahead: the radar and the broadcasts. Live: the agent's checks, choices and draft.
