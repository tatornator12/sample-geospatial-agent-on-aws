# Agentic AI for Earth: short speaker notes

One page per act, for the room. The full script, timings and fallbacks are in `rehearsal-notes.md`. Plain words first; the *Technical* lines are for the engineers in the room, so use them only if the room leans that way.

Before the first click, in Act 1, point at the screen: "On the left, the agent's steps light up one at a time, with the images it looked at. On the map, every layer is evidence you can check. And watch for the moment a person decides."

---

## 1. Earth Analyst (about 6 minutes)

**What it shows:** the agent looks at satellite pictures before it measures, and finds places by example.

**The data, and where it comes from**
- Satellite pictures: Sentinel-2, from the European Space Agency's Copernicus programme, read from AWS Open Data.
- "Fingerprints" of what every patch of land looks like: Clay embeddings from LGND, made with the open Clay AI model, published on AWS Open Data.
- Place names from Esri, through its ArcGIS server for agents; outlines of places from OpenStreetMap.

**Beats**
1. **Click "A cloudy day, Bergen".** "It's measuring plant health in Bergen. It looks first: this picture is cloudy, so it turns it down and fetches a clear one." Point at "skipping 2025-09-06".
2. **Click "Places like Central Park".** While the search runs: "It compares Central Park with about 190,000 patches of New York State, by what each looks like from space. Then it checks the top matches itself." Point at the dots, then the table.
3. **Hand off:** "Same eyes, a different question."

*Technical:* Sentinel-2 via Earth Search STAC; Clay v1.5 embeddings, cosine similarity, fanned out through AWS Lambda.

**The decision:** no approve step here. "The agent measures; a person decides what it means."

---

## 2. AI Archaeologist (about 4 minutes)

**What it shows:** the same eyes on a new problem, ancient earthworks, and only sites already on the public record. The agent looks at each similar site and says whether its walls still show in the ground.

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

**The decision:** built in. "It never marks a new site: publishing unknown sites puts them at risk of looting."

---

## 3. Methane Watch (about 6 minutes)

**What it shows:** the agent runs a whole mission on live satellite data, and drafts a brief for a person to file.

**The data, and where it comes from**
- A wide, coarse view of methane every day: TROPOMI on the European Space Agency's Sentinel-5P, read from AWS Open Data.
- A sharp view, a few times a year at any one place: NASA's EMIT instrument on the International Space Station, from NASA's data archive.
- A second opinion: Carbon Mapper's public catalogue of methane plumes, seen by the Tanager-1 satellite and by EMIT, from data.carbonmapper.org (about a month behind; the stage shows its source wherever its numbers are).
- The ground record: fires from NASA FIRMS, mapped buildings and pipelines from Overture Maps, and public facility registries (OGIM and Global Energy Monitor).

**Beats**
1. **Click "Methane Watch brief".** "It states a plan. First a wide satellite scans nine areas over the last two weeks: that's a tip, not a finding."
2. "Then it checks EMIT's record over the two strongest tips, pass by pass, and rejects the weak ones." Point at the dimmed frames.
3. "Then a second opinion: Carbon Mapper's plumes near both sites." Point at the "Carbon Mapper:" line under each tally.
4. "It follows the site with the newest confirmed detection, an EMIT candidate pass or a Carbon Mapper plume, and says both dates." Point at "following", then the 3D columns.
5. "Then the ground record, and a draft brief. It never names a cause."

*Say it honestly:* the tip is the last two weeks; EMIT's confirmations and Carbon Mapper's plumes are records since 2025, with dates on the board and the card, and the newest date decides which site it follows. Any rate is Carbon Mapper's estimate, not EMIT's. Say "methane keeps showing up here", never "it's leaking now".

*Technical:* TROPOMI 14-day composites; EMIT raw passes judged against their own noise; Carbon Mapper plumes within 5 km since 2025; VIIRS, Overture, OGIM.

**The decision:** you, as the analyst. "It's a draft. Nothing is filed until I approve it." Press "Approve and file".

---

## 4. Dark Vessels, the closer (about 8 minutes)

**What it shows:** one open question. The agent chooses its data, checks whether it can trust it, predicts where to look, and drafts a patrol for the officer.

**The data, and where it comes from**
- Radar that sees ships through cloud and at night: Sentinel-1, from the European Space Agency, read through Microsoft's Planetary Computer.
- Ships' own position broadcasts (AIS) and vessel detections: Global Fishing Watch.
- When the radar looks next: the European Space Agency's published plans, read live.
- The reserve's boundary: the World Database on Protected Areas.
- The radar and broadcasts are prepared ahead; the agent's analysis and choices run live.

**Beats**
1. **Click "Who is there without broadcasting, and where next?".** Point at the board: "It chose the radar pass, and told us why."
2. "First it checks where broadcasts can be received at all. Silence only means something there." Point at "can check 19%".
3. "These four are radar targets with no broadcast. A reason to look, not an accusation."
4. "Where to look next: its forecast has a measured record, and the satellite's next pass over each box." Point at the boxes.
5. **As the officer:** "The agent drafts; it never files." Choose the box, press "Approve the tasking", and point at the Slack post on the second screen.

*Technical:* CFAR detector on Sentinel-1 at 20 m; AIS coverage per hour; the forecast refitted before each radar day; the agent's choices go to the stage as fixed options, never free text.

**The decision:** you, as the officer. Then go back to the deck for the close.
