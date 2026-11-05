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

*About 6 minutes, run then walk back. The mission takes 70 to 90 seconds of agent time (72 s live on 3 November, 69 to 80 s on 26 October; up to 151 s on a cold fortnight), with a new beat every few seconds. So don't narrate it as it goes: say what to watch before the click, say three short lines while it runs, then walk the room back through the finished stage, where every step stays on screen. About 5 minutes 30 from the switch to the hand-off with a warm mission. Have ready: the methane caches warmed that morning (`scripts/warm_watch.py`). Switch with the agent switcher, top right, to "Methane Watch". If the column still shows an earlier mission, press New session (the circular arrow at the right end of the console) first.*

**Point to land:** From one question the agent runs a whole mission on live satellite data, judges its own evidence, chooses which spot to follow and says why, and leaves the filing to a person.

*Quoted lines are from a live run on the stable runtime on 3 November (fortnight 18 to 31 October). The live fortnight changes the place, the dates and the numbers, and the place name can change between runs for the same spot ("near Qinyang, Henan" and "Changzhi City, Shanxi" both came up on 3 November for one spot), so read figures off the screen. Never say "now", "still", "active" or "leaking"; any rate is Carbon Mapper's estimate.*

*During the walk-back, keep off "Clear" at the top of the layers list and the × at the end of a layer row (both remove layers for good), the two buttons at the bottom left (they draw on the map), and New session.*

**1. Over the globe, before the click (about 40 s)**
- **Do:** switch to "Methane Watch" and wait for the globe: white dots, rings marked "×5" to "×10", nine dashed boxes. Talk over it while the runtime warms.
- **Point at:** a ring, then a dashed box.
- **Say:** "Methane traps about 80 times as much heat as carbon dioxide over its first 20 years, and you can't see it. Each dot is a place NASA's EMIT instrument saw a methane plume between 2022 and 2025; a ring means plumes on five or more dates. The dashed boxes are nine areas we watch. I'll ask the agent for a brief on them. It takes about a minute and a quarter and a lot happens fast, so I'll let it run, then walk you back through every step. Watch the strip at the top of the left column: tip, cue, check, brief."

**2. The click, and the run (about 75 s; up to 2.5 minutes on a cold fortnight)**
- **Do:** click "Methane Watch brief". The plan strip "Baseline · Tip · Cue · Check · Brief" lights in turn (3 November: Tip at 8 s, Cue at 20 s, Check at 34 s, Brief at 54 s, the card at 72 s).
- **Say** only these three lines, each when its beat is on screen, and let the rest run:
  - When the board's rows fill under "Scan 9 watch areas" (about 10 to 20 s): "First, a wide scan of all nine areas."
  - When the camera leaves the globe and dives, tilted, to a block of bars (about 30 s): "It has chosen one spot to follow."
  - When those bars give way to the close look's columns (about 40 s): "And that's its close look on record. Now it writes the brief."
- If the card hasn't come after about 90 s: "A new fortnight means more live data to fetch, so this one takes longer. Everything on the map is evidence it used."
- **Do:** wait for the card at the top of the column ("Draft brief" and its title). Don't read it yet.

**3. Back to the start: the tip (about 30 s)**
- **Do:** in the layers list on the right, click the name "NASA EMIT plume sites, 2022 to 2025" (the words, not the tick box). The camera flies out to the globe, and the watch areas' tips show with their numbers ("Zagros +48 ppb"). Then scroll the left column to the top: the question, the plan strip, and under "Scan 9 watch areas" the board, strongest tip first, with the area it followed marked "following".
- **Point at:** the board's top row, then the row marked "following".
- **Say:** "Let me take you back through it. First the wide view: TROPOMI, on a European satellite, scanned all nine areas over the last two weeks, and these are the strongest tips. A tip only says 'somewhere around here'."
- If the "following" row is not the top row (3 November: "South Caspian, Turkmenistan +115.1 ppb" on top, "Shanxi and Ordos coal basins, China following +73.6 ppb" second): "Notice it didn't follow the strongest tip. I'll come back to why."
- With "Show all N steps" pressed, the full board lists every area. West Siberia reads "no clear view" in November: "Up there the satellite has neither sunlight nor a clear view this time of year." "No hotspot" means it could see and nothing stood out.
- 4 November (live and dev): it followed the south Caspian, the strongest tip, by its newest confirmation (Carbon Mapper, 5 October, on the dev run's board), so it stayed on the top row. The followed area can change from day to day; read the "following" row.

**4. The sharp look: it judges every pass (about 40 s)**
- **Do:** scroll down to "Cue EMIT on 2 sites". Each site has a verdict line ("2 candidates · 1 within noise · 1 cloud or gap" for the south Caspian on 3 November); the site it followed has its record and a row of dated frames under it ("The 8 EMIT passes read").
- **Point at:** a verdict line, then a frame with an orange edge.
- **Do:** click that frame. It opens large, titled with its date and verdict ("EMIT pass, 17 Apr 2026: methane seen"), with its numbers under it ("511 pixels ≥ 1000 ppm·m, 221 above 3× uncertainty against 6 below zero, peak 6,210.6 ppm·m"). Press Esc to close it.
- **Say:** "For the two strongest tips it read every pass of NASA's EMIT, the sharp instrument on the Space Station, and judged each one against its own noise. Orange edge: methane. The dim ones it set aside, and the line under them says why."
- *Technical:* "A pass counts when enough pixels clear three times their own uncertainty, and the strong pixels above the background outnumber those as far below it three to one. Noise goes both ways; a plume doesn't."

**5. Its choice, and why (about 30 s)**
- **Point at:** above the frames, the site's record: the rows "TROPOMI", "Carbon Mapper" and "EMIT", the years along the bottom, the latest close look's date ("4 Oct 2026") and the bracket to the fortnight ("14 days to 18 Oct"). Then the line under "Follow one site". On 3 November: "Methane was last seen up close at the top spot in Shanxi 14 days before this fortnight, within 90 days, so the agent stays with it and checks no more spots."
- **Say:** "This is that site's record, one row per instrument. The bracket is the gap from the latest close look to this fortnight: 14 days. Its rule is to follow the spot where methane was seen up close most recently, within 90 days. That line is its choice and its reason, and the tool refuses a follow the record contradicts."
- If it followed a tip other than the top one (3 November): add "That's why Shanxi, not the stronger tip: Shanxi's close look is the fresher one."
- If the line says it "is following the second spot" or "the third spot": "The top spot's close look was too old for its 90-day rule, so it checked the next spots and switched to a fresher one."
- If it says "and at none of the N next spots within 90 days, so the agent stays with it": "Its close look is old, and none of the next spots is fresher, so it stays, and says so."
- If it says "so the agent follows the stronger tip": "Neither spot, nor the next ones, was seen up close within 90 days, so it follows the stronger tip, and says so."
- If it says "during this fortnight": "It was seen up close during this very fortnight, so it stays."

**6. The tip, in 3D (about 15 s)**
- **Do:** in the layers list, tick the box beside "TROPOMI around the site, in 3D". The camera flies to the spot and tilts; the close look's bars step back (one set of bars at a time); the legend reads "TROPOMI, 18 to 31 Oct 2026".
- **Say:** "The wide view around that spot, in 3D. A taller bar means more methane in the air than usual."

**7. The close look, in 3D (about 20 s)**
- **Do:** tick the box beside the top row of the list ("Carbon Mapper plume, in 3D" on 3 November; "EMIT pass, in 3D" when EMIT's look is the newer one). The camera moves in; the legend dates it ("Carbon Mapper plume, 4 Oct 2026", with "Source: Carbon Mapper (data.carbonmapper.org)").
- **Point at:** the tallest column, then the legend's date.
- **Say:** "And its latest close look: Carbon Mapper's image of the plume, from 4 October. The record, older than the tip; the screen dates both."
- If the row is "EMIT pass, in 3D": "And its latest close look: NASA's EMIT, on [the legend's date]."
- If there is no second bars row in the list: "There's no close look on record here, so these bars are the wide view's only. The brief says so."

**8. The brief (about 45 s)**
- **Do:** scroll the left column down to the card.
- **Point at:** the line at its top ("Tip Shanxi and Ordos coal basins, China +73.6 ppb → Cue 3 of 8 passes → Check 3 records → Brief"), then the paragraph under the title.
- **Say:** "Here's the draft. The top line is the whole mission you just saw: tip, cue, check, brief. EMIT has looked here 21 times since 2023; the agent read the 8 passes since January 2025 itself, and 3 passed its test. And its one call:" Then read the call as the card has it (3 November: "Methane was last seen up close here 14 days before this fortnight. No new close look is needed yet.") and add: "Inside 90 days, so the record is recent enough to stand on."
  - If it ends "The agent recommends a new close look.": "That record is too old to stand on, so it asks for a fresh look instead of guessing."
  - If it reads "No close look has confirmed methane here, so the bars are TROPOMI's only.": "Only the wide view has seen methane here, so it asks for a close look first."
  - If it adds "EMIT's last look, on" a date, "was clouded out.": "Its last look was cloud, which tells us nothing either way."
- **Point at:** "Methane recurs here" ("Moderate" on 3 November), "Cause", the line under "INDEPENDENT DETECTIONS", then "GROUND RECORD".
- **Say:** "It rates how often methane recurs here, and leaves the cause open until someone checks on the ground or from an aircraft. Then a second opinion: Carbon Mapper lists [18] plumes within 7 kilometres since January 2025, and that rate is Carbon Mapper's estimate, not ours. Then the ground record: night-time heat, what's mapped nearby, and the public registries. The scans were warmed into our cache this morning; the choice of spot, the call and this brief were made live."
  - If the line reads "no methane plume within 7 km": "Carbon Mapper lists no plume within 7 kilometres since January 2025."
- *If there's time:* click "Gaps and next look" at the foot of the card; it lists what the record can't see and ends on the next look it asks for ("Next: EMIT's next routine pass over this site, to extend the record."). Or press "Show all 18 steps" at the top of the column: under "Look at the image" the Sentinel-2 photo opens large with "Saw:", the agent's own words about it. "Show the summary" folds the list again.

**9. The decision (you, as the analyst)**
- **Say:** "A daily scan only says 'somewhere around here'. This turns it into a named site, its record and a brief. It's a draft. I'm the analyst, and nothing is filed until I approve it."
- **Do:** scroll back to the card's buttons and click "Approve and file". The card shows "Filed by the analyst at … UTC. The agent did not file it.", and the agent confirms in a short turn; while it runs the console is greyed and the card steps away, then comes back filed. Let the line speak.
- **Point at:** the filed line.

**Transition:** "That was a gas you can't see. The last act looks for ships the usual tracking can't see, at sea and at night, and asks where a patrol should look next." Then switch to "Dark Vessels".

*If asked*
- *Why is the close look older than the tip?* "EMIT rides on the Space Station and can't be pointed, so it sees any one place only from time to time, and Carbon Mapper publishes about a month after it sees a plume. The tip is this fortnight; the close look is the record, and the screen dates both."
- *Why not the strongest tip?* "A tip is two weeks of a coarse view; a close look is a plume actually seen. The rule follows the spot with the freshest close look, within 90 days, because that's the one a brief can stand on. If no spot has one, it follows the stronger tip, and says so."
- *Is this autonomous?* "No. I asked the question and I file the brief. In between, the agent chose its steps, read every pass, and chose which spot to follow by a rule it states on screen. The tool refuses a follow the record contradicts, and the screen's lines are written from the tools' records, not from the model's words."
- *What was prepared ahead?* "The satellite scans and pass checks are warmed into our cache the day before and on the morning, and anything missing is fetched live. The choice of spot, the call and the brief run live."
- *How does it judge a pass?* "A pass counts only when enough pixels clear three times their own uncertainty, and the strong pixels above the background outnumber those as far below it three to one. Noise goes both ways; a plume doesn't."
- *Why so few bars on some passes?* "Only pixels that clear three times their own noise are drawn. Here only a handful did, so it is a weak detection, and the agent treats it as one."

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

*About 8 minutes, run then walk back. The question takes about a minute of agent time (58 s live on 3 November, 61 to 66 s on 26 October), with a new beat every few seconds. So don't narrate it as it goes: say what to watch before the click, say three short lines while it runs, then walk the room back through the finished stage. The script reaches the Slack post about 6 minutes 30 after the switch, which leaves about a minute and a half: enough for the replay, not for a second live try and the whole walk-back (after a retry, walk back through cues 3, 6 and 9 only). Have ready: the second screen with Slack open on the "Patrol taskings" channel, newest post in view; the radar plans warmed that morning (`scripts/warm_vessels.py`). Switch with the agent switcher to "Dark Vessels". Press New session only if this tab ran "Same question, end of August".*

**Point to land:** The agent picks its own radar pass, checks that a missing broadcast can mean anything before it reads one, predicts where to look with a measured record, and drafts a patrol that only the officer can send.

*Quoted lines are from a live run on the stable runtime on 3 November, on the data the show uses: Oct 12 is the newest pass on file (the 5 November refresh could not run, so the data stays as tested). Only the next looks change, with ESA's plan, so read those off the screen.*

*What stays on screen once it stops: every step, with its "Decided:", "Checked:" and "Set aside:" lines, in the left column; the two pictures it looked at, which open large when clicked; and every layer on the map. The clock at the top centre keeps only its last line ("Patrol tasking draft"), so its earlier figures (the 142 ships, the 22 radar targets) are said while the run shows them, or not at all. During the walk-back, keep off the layers list (at 1920×1080 opening it moves the tasking plate over the left column and hides the steps; folding it again brings them back), "Not now" (the plate can't be brought back), "Clear" and New session.*

**1. The reserve at night, before the click (about 45 s)**
- **Do:** switch to "Dark Vessels" and wait for the top-centre clock "AIS replay" with a date and time, and moving lights inside a dashed outline.
- **Point at:** a moving light, then the dashed line.
- **Say:** "This is the Galápagos Marine Reserve at night; the dashed line is its edge. Each moving light is a ship's own position broadcast, called AIS, replayed from the 36 hours before the 12 October radar pass. It's a replay from our prepared data, not live. A ship that switches its broadcast off drops out of this picture, but radar still sees it, through cloud and in the dark. Patrol boats are few and the reserve is large, so the officer's question is: is anyone in the reserve without broadcasting, and where should the patrol look next? It takes the agent about a minute and a lot happens fast, so I'll let it run, then walk you back through every step. Watch the left column: each step lights as the agent takes it."

**2. The click, and the run (about 60 s)**
- **Do:** click "Who is there without broadcasting, and where next?". The steps light one after another down the left column and the clock names each beat (3 November: the pass chosen at 8 s, the radar at 14 s, the coverage at 22 s, the candidates at 30 s, the forecast at 42 s, the boxes at 48 s, the plate at 58 s).
- **Say** only these three lines, each when its beat is on screen, and let the rest run:
  - When the radar sweeps in and the moving lights stop (about 14 s; the clock "Sentinel-1D radar … 142 ships broadcasting at the radar minute"): "That's the radar. The ships' lights stop at the minute it looked."
  - When rings turn pink (about 30 s; the clock "2 candidates" holds for about 12 s): "Pink: the candidates."
  - When three white squares appear (about 48 s; the clock "Three patrol boxes"): "And three places a patrol could go."
- **Do:** wait for the answer at the foot of the column and the plate on the right, "Patrol tasking draft".
- **Say:** "And it stops at a draft. It can't send a patrol. Let me walk you back through how it got here."

**3. It chose the pass, and said why (about 30 s)**
- **Do:** scroll the left column to the top.
- **Point at:** the board under "Weigh the passes on file" ("share of the reserve each pass imaged", newest first, "Oct 12 S1D 53% reading" on top), then the line under "Find the radar pass": "Decided: Reading Oct 12: the newest pass on file. It saw 53% of the reserve."
- **Say:** "These are the radar passes on file, with how much of the reserve each one saw. It chose Oct 12, the newest, and that line is its reason. It has to write the choice down before its tools will read the pass."
- If the line reads "the newest pass that saw over half the reserve": "The newest pass saw only [31%] of the reserve, so it chose the newest one that saw over half, and that line says why."
- If it reads "Set" a date "aside: it can check only": "It set that pass aside: too little of the reserve could be checked. It read another instead."
- If it reads "of the passes on file, it saw the most of the reserve": "It chose the pass that saw the most of the reserve."

**4. It looked before it used the radar (about 20 s)**
- **Do:** under "Look at the radar", click the picture "Radar, Oct 12". It opens large, with the question the agent asked itself: "What does the radar swath show over the reserve?". Press Esc to close it.
- **Say:** "Before using the radar, it looked at it. Islands are black, open water is grey, and the bright specks are things on the water. Radar sees them through cloud and at night, broadcasting or not."

**5. Can a silence mean anything here? (about 40 s)**
- **Point at:** the line under "Check where AIS was received", "Checked: This pass can check 19% of the reserve, over the 15% standard."; then on the map the hatched water labelled "reception unknown", and in the key on the right "reception unknown: no AIS here proves nothing".
- **Say:** "Before a missing broadcast can mean anything, it checks where other ships' broadcasts were coming through around the pass: the plain water. In the hatched water reception is unknown, so no broadcast there proves nothing. Our standard is 15% of the reserve checkable, a policy we set from the passes on file. This pass can check 19%, so it went on."
- If the line reads "This pass can check only" and "under the 15% standard.": "Only [10]%, under its standard, so it won't read anything into a silence on this pass." Read the "Decided: Set … aside" or "No tasking can be drafted." line that follows as it stands.

**6. The candidates, and two it set aside (about 50 s)**
- **Point at:** under "Match targets to broadcasts", "Checked: 2 candidates where AIS was received, seen by both detectors." and "Set aside: 2 where a broadcasting ship passed within 1 km, 30 minutes or less from the pass."; then on the map a white ring beside a white dot, and the pink rings "T01 no AIS" and "T02 no AIS".
- **Say:** "A white ring is a radar target with a ship's broadcast to account for it. A pink ring is a candidate: a target with no broadcast, in water where broadcasts get through, and both detectors saw it. It could be a small boat, a missed broadcast, or not a vessel at all. It's a reason to look, not an accusation."
- **Do:** drag the map to the left, starting on open sea (not on a box or a ring), until San Cristóbal comes out from under the plate on the right: two grey rings, each with a short level line under it, labelled "T03 ship passed close" and "T04 ship passed close".
- **Say:** "And these two it set aside: a broadcasting ship's path passed within a kilometre of each, just before the radar looked, so the radar may have seen that very ship."
- **Do:** drag the map back to the right until the three boxes are clear of the left column.
- If it reads "No candidates where AIS was received.": "No candidates on this pass: nothing unexplained where broadcasts were received." If a "Set aside:" line follows it, add: "The ones it found, a broadcasting ship passed close by."
- *Technical:* "Each dot is our estimate of where its ship was at the minute of the pass, from one position an hour, so a fast ship's dot can be kilometres out. Where Global Fishing Watch's radar also saw the target, its own match against the full broadcast record decides."

**7. A closer look (about 15 s)**
- **Do:** under "Gather the evidence", click the picture "Candidate T01, Oct 12" (the agent picks which one); it opens large with "What does the chip show?". Press Esc.
- **Say:** "And it took a closer look at one candidate, a small patch of radar around it, before drafting anything."

**8. Where to look next, with a record (about 30 s)**
- **Do:** scroll the left column down to the answer at its foot.
- **Point at:** the pink glow on the water, then the answer's line "Refitted before each radar day since July, the map's top 5% of water held 45% of the dark targets, 9 times chance."
- **Say:** "The glow is where unexplained targets turned up before, and it's tested: before each radar day since July it was rebuilt from earlier data and checked against that day. Its hottest 5% of the water held 45% of the dark targets, about 9 times chance. It's a record of the method, not a promise about the next pass."

**9. The boxes, and the draft (about 30 s)**
- **Point at:** the three white squares, "Box 1" to "Box 3"; the swath's label on the map ("next look S1-D Nov 5 00:17 UTC" on 3 November; on 9 November, by ESA's plan of 5 November, boxes 1 and 3 next "Nov 17 00:17 UTC" and box 2 "Nov 10 00:25 UTC"); then the line under "When the radar looks again": "Decided: Drafting box 1: 1 of the candidates lies in or near it."
- **Say:** "From that map come three patrol boxes, each with the radar's next planned look, from ESA's published plan. It drafted box 1, because one of today's candidates lies in or near it, and that line says so."
- If it says "it held the most past dark targets": "It drafted box 1: the most dark targets before."
- If the step reads "When the radar looks again ×2" and "Draft the tasking" adds "Decided: Drafting box 2: its radar look comes first,": "Then it read the radar plan and switched to box 2: the radar looks there first."
- If the first line already says "its radar look comes first": "It drafts box [2], because the radar looks there first."
- If it says "the only box with a radar look planned": "It drafts box [2], the only one the radar will look at again."
- **Point at:** the answer's first line ("2 candidates on the Oct 12 pass; I drafted box 1 for the next look.").
- **Say:** "That's its answer in one line. The radar and the broadcasts were read ahead of time; every choice you've just seen was made live."

**10. The officer's choice**
- **Point at:** the box rows on the plate ("Box 1  9% of past dark targets" and its next look, "Nov 5 00:17 UTC, in 1 d 2 h" on 3 November, "Nov 17 00:17 UTC" on 9 November), the candidates ("T01 31 km from Baltra", "T02 31 km from Baltra"), then the line above the buttons ("Patrol box 1 · check 2 of 2 candidates on the way"). T03 and T04 are not on the plate: they were set aside.
- **Say:** "I'm the officer. Each box shows its share of past dark targets and when the radar looks next. Below are the two candidates, by distance from port, to check on the way. The line at the bottom is the whole tasking."
- **Do:** leave the agent's box selected and every candidate ticked. To show the choice is yours, click another box first (the line above the buttons changes with it, and a box not chosen steps back), or untick a candidate (its ring is then labelled "left out").
- **Say:** "Box 1 held the most dark targets before, so I'll take the agent's draft and check both on the way."
- If the plate has box 2 selected because its look comes first: "The radar looks at box 2 first, so we can check what the patrol finds. I'll take the agent's draft and check both on the way."
- On 9 November box 2's look (Nov 10 00:25 UTC) comes before boxes 1 and 3's (Nov 17 00:17 UTC), by ESA's plan fetched on 5 November. So the agent may draft box 1 (a candidate lies in or near it) or switch to box 2 ("its radar look comes first"); both lines are in cue 9. If a box ever reads "no look planned yet": "ESA hasn't planned a radar look there yet."

**11. The decision (you, as the officer)**
- **Say:** "The agent drafted it. I'm approving it."
- **Do:** click "Approve the tasking" (not "Not now"). The plate shows "Filed by the officer at … UTC. The agent did not file it.", and the clock "Patrol tasking filed", "box 1 · 2 of 2 candidates · next radar look in" and a countdown (with no look planned, "next radar look not planned yet"). No follow-up turn. Don't read the filed line out.

**12. The Slack post (second screen)**
- **Do:** turn to the second screen; the new post lands in "Patrol taskings" (works on the live site, seen 26 October; allow about 10 s).
- **Point at:** the post. Let it sit; don't read it out.
- **Say:** "And there's the tasking, in the channel the patrol team reads."
- If nothing has landed after about 10 s: "The filed line on the plate is the record; Slack is only the notice."

**Transition:** "That's the last act. Let me pull together what you just saw." Then back to the slideshow on slide 4, "What you just saw".

*If asked*
- *How do the broadcasts line up with the radar?* "The radar is one snapshot, 00:18 UTC on 12 October. Global Fishing Watch gives us one position per ship per hour, and not the minute within that hour, so each dot is an estimate of where the ship was at the minute of the pass. For a slow or anchored boat that is close; for a passenger boat at 15 knots, which covers about 28 kilometres an hour, it can be well over ten kilometres out. So where Global Fishing Watch's own radar also saw a target, its match against the full broadcast record decides; for targets only our detector saw, a dot within a kilometre decides. And a target that would be a candidate is set aside when a broadcasting ship's straight path between two hourly positions came within a kilometre of it within 30 minutes of the pass. 'Can check' counts water where at least two ships were picked up within 30 kilometres in one hour, in the three hours either side of the pass."
- *Could T03 and T04 be those broadcasting boats?* "They could, and that's why they're set aside, not candidates. A passenger boat's straight path between its hourly positions passed about 0.2 kilometres from T03, 13 minutes before the radar looked, and about 0.6 kilometres from T04, 14 minutes before, at about 15 knots. The rule is a kilometre and 30 minutes, and we chose those limits after seeing this pass, so they're a judgement, not a measured rate. T01 and T02 had a ship pass about as close, but about 40 minutes earlier; by the radar minute it was kilometres away, so they stay candidates."
- *Is this autonomous?* "No. I asked, and I approved. In between, it chose the pass and the box and said why each time; its tools refuse a pass or a box it hasn't announced, and the stage's backend files the tasking, not the agent."
- *What was prepared ahead?* "The radar and the broadcasts were read into our cache before the show, and ESA's plan for the next look was fetched this morning. The checks, the choices and the draft ran live."
- *Would it choose differently?* Press New session, then click "Same question, end of August". It reads Aug 30 because the question names it ("Reading Aug 30, as asked"), finds it can check only about 10% of the reserve, under the standard, and sets it aside on a "Decided: Set Aug 30 aside: …" line before reading another pass. Don't approve that draft: it would file and post a second tasking.

*If it fails*
- The question stalls or errors: press Esc, reload `/?agent=vessels` and click the plate once more. Say: "Let me ask it once more."
- It fails again: load `/?scenario=vessels-open-question-v2&agent=vessels` (recorded on dev on 27 October with the passing rule; the gallery card plays it since 3 November). It plays in about 12 s and ends on a read-only plate ("Recorded case: the decision is made live, not replayed."), with no approval and no Slack post. Its board has "Oct 17 S1D 31%" first and the line "Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%)."; it shows 2 candidates and "T03 ship passed close", "T04 ship passed close"; its forecast reads 47%, and the plate reads "Patrol box 1 · check 2 of 2 candidates on the way". Say: "This is a recording of the same question, from a rehearsal. There the newest pass saw only 31% of the reserve, so it chose Oct 12. A recording doesn't replay the decision; live, I'd approve it here." Then the close, with its replay line (rehearsal notes, section 10).
- The replay won't load either: "The live run isn't cooperating today." One sentence on what the act does, then the close with its "didn't reach the tasking" line.

*Data sources*
- Radar that sees ships through cloud and at night: Sentinel-1, from the European Space Agency, read through Microsoft's Planetary Computer.
- Ships' own position broadcasts (AIS) and vessel detections: Global Fishing Watch.
- When the radar looks next: the European Space Agency's published plans, fetched that morning.
- The reserve's boundary: the World Database on Protected Areas.
- Prepared ahead: the radar and the broadcasts. Live: the agent's checks, choices and draft.
