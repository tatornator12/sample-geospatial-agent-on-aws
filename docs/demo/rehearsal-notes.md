# Agentic AI for Earth: rehearsal and speaker notes

**DRAFT, 20 October 2026.** Act 3 is being redesigned and the stage review's known issues are still open, so beats, timings and the "until fixed" box will change before the show.

One presenter, 30 minutes, Monday 9 November 2026, for a mixed technical and non-technical room. Each act gives a plain line for everyone and one line for the technical half. "(unconfirmed)" means the repo does not confirm it; "proposed" means these notes suggest it and no spec or run sheet sets it. Sources per section: `.agents/tasks/demo-deck-2026-10-20/notes-verification.md`.

Stage addresses below are relative to the stage URL (the `ApplicationURL` stack output, not written here). Agent ids: `stable` (Act 1, Earth Analyst), `methane` (Act 2), `vessels` (Act 3), `archaeologist` (Act 4).

---

## 1. Running order (30 minutes)

| Part | Roadmap minutes | These notes | Clock | Ends on |
|---|---|---|---|---|
| Intro (deck, 5 slides) | 2 | 3 (proposed) | 0:00 to 3:00 | "Let's start with the Earth Analyst." |
| Act 1, Earth Analyst | 7 | 6 (proposed) | 3:00 to 9:00 | "Same eyes, same search, new domains next." |
| Act 2, Methane Hunter | 7 | 6 (proposed) | 9:00 to 15:00 | "It found the invisible and told you what it could not confirm." |
| Act 3, Dark Vessels | 8 | 8 | 15:00 to 23:00 | pending the redesign |
| Act 4, AI Archaeologist | 4 | 4 | 23:00 to 27:00 | "Both are already on the World Heritage list. I only work with sites on the public record." |
| Close | 2 | 1 (proposed) | 27:00 to 28:00 | "Happy to take questions." |
| Questions | 0 | 2 (proposed) | 28:00 to 30:00 | |
| **Total** | **30** | **30** | | |

Why it differs from the roadmap:

- **Intro 3:** the deck's notes run about 3:12 at 150 words a minute (480 spoken words), so take about 12 s out in rehearsal. Slide 5 is optional; without it the intro is about 2:35.
- **Questions 2:** the roadmap has no question time.
- **Act 1 at 6:** drops the run sheet's "click rank 1" popup beat, which fails today, and shortens the close. Run sheet: 7:00, hand-off at 6:40.
- **Act 2 at 6:** the measured mission is 79 to 125 s of agent time, so most of the run sheet's 7 minutes is narration. The 6 minutes keep the approval. Run sheet: 7:00, approval at 6:30.
- **Close at 1:** the roadmap's 2 minutes held a teaser of the act not shown and an observability trace. All four acts are in the show, so there is nothing to tease. No trace is prepared, and whether any stable runtime sends one is unconfirmed. Leave both out unless one is built and rehearsed.
- **Act 3** keeps the roadmap's 8 minutes and the spec's limit: time it under 8:30.
- **Act 4** keeps its run sheet: 4 minutes, the closer.

Each act's minutes include the switch and about 20 s of talk while its runtime warms. A cold boot measured 23.7 s, and the stage's own pre-warm absorbed it.

If you run long, cut in this order. The order across acts is proposed; each cut is that act's own run sheet fallback unless marked otherwise.

1. Act 1: drop the Folsom compare (Act 1 run sheet).
2. Act 4: drop the measure beat (Act 4 run sheet).
3. Act 2: run the mission replay instead of the live mission (Act 2 run sheet: "start from the globe replay case").
4. Act 3: pending the redesign. The old run sheet folded the evidence into the first answer.
5. Questions take what is left (proposed).
6. Last resort: Act 4 as a 90-second teaser, the Octagon replay's "under the grass" beat only (the Act 4 run sheet's cut-list fallback).

---

## 2. Until fixed

> **Until fixed.** Recheck every line after the G4 promotion (Fri 30 Oct) and the freeze (Tue 3 Nov).
>
> - **Never press New session, in any act.** To start over, refresh the browser, but only while the address bar shows the act you are on. The switcher does not update `?agent=`, so a refresh after a switch lands on the previous act. Safest: load `/?agent=stable`, `/?agent=methane`, `/?agent=vessels` or `/?agent=archaeologist`. In Act 3, New session (or a runtime crash) blacks out the sea; after a replay, New session keeps the recording attached to every later prompt.
> - **Leave a replay by loading `/?agent=<id>`** with the ids above, never with New session or the rail's "Stage" link (both keep the replay's layers or its case id).
> - **Open Act 1 replays only with Act 1 selected.** They name no act and play under whichever act is on.
> - **Do not quote the Act 1 replay figures:** "2.6× Manhattan", "85 km²", or the gallery's "Dense Vegetation Loss 15.71 km²" (that figure is the 2025 dense area, which went up). The gallery's Palisades card ("21,000 acres", "29.4%") comes from the same unsupported narrative. If you need a Palisades figure: "about 96 km² lies inside the mapped perimeter".
> - **Don't open Replay cases on the projector:** the Act 1 cards show "21,000 acres", "29.4%" and "Dense Vegetation Loss 15.71 km²", and the Palisades replay opens already scrolled to its wrong figures. Restore the Act 1 fallback at the post-G4 recheck only once the corrected cards and the re-recorded case have landed.
> - **Act 2, "still active":** the plate's question says it, but the evidence rests on EMIT looks that can be months old (in the recorded case, 20 August 2025), and the brief card shows no last-look date. Say "where methane keeps showing up", give the tip's window (TROPOMI, the last 14 days) and the date of EMIT's newest pass from the filmstrip, and never say a site is active now.
> - **Esc does not stop a turn, and Stop does not end it cleanly.** If a turn goes wrong, load `/?agent=<id>` and send the plate again.
> - **Earlier steps are not on the stage.** The column shows only the latest turn and "+N earlier" cannot be clicked. Earlier turns are in the transcript drawer (the icon beside New session; mind the neighbour).
> - **Act 1:** stay at 1920 wide (the look-alike layer went missing at 1280 in 2 of 3 runs), skip the rank-1 click (no popup), and expect the lit step to run one behind. The agent's "I see" sentence does not show on the stage; it is in the transcript.
> - **Act 4, beat 3:** if the LiDAR does not draw, say so. Do not read the answer over plain imagery.
> - **Do not open "How it works"**: it is still the original sample's page. On the switcher, pick "Earth Analyst (stable)", never a "(dev)" entry.

---

## 3. Rehearsal calendar

| Date | What | Source |
|---|---|---|
| Fri 23 Oct | Archaeologist dev gate; first batch of stage fixes | act3 design decision 9; review summary |
| Mon 26 Oct | Decide whether the Act 3 open turn enters the run sheet | review summary D4 |
| Wed 28 Oct | Act 3 replay case due | act3 tasks 6.1 |
| **Thu 29 Oct** | **Timing rehearsal:** Act 3 timed twice against dev, under 8:30, fallbacks recorded. Proposed: time every part against section 1 the same day. | act3 tasks 7.1 |
| Fri 30 Oct | G4: Release 3 with all four agents; Act 3 timed twice against stable; the 30-minute show once | act3 tasks 7.2 |
| **Tue 3 Nov** | **Freeze:** nothing new lands after this, only fixes | working agreement; roadmap |
| 3 to 7 Nov | Demo readiness: runbook, backup videos, prewarm, two timed rehearsals (dates not set) | roadmap row 7 |
| Thu 5 Nov | Dark Vessels data rerun (newest pass and AIS, refit), data only | act3 design decision 12 |
| **Fri 6 Nov** | **Rehearsal** of Act 3 on the new data; last fixes-only promotion | act3 design decision 12; review summary |
| Mon 9 Nov | The show | roadmap |

No act has a recorded rehearsal time yet. Fill this in as you go:

| Part | Target | Thu 29 Oct | Fri 30 Oct | Fri 6 Nov |
|---|---|---|---|---|
| Intro | 3:00 | | | |
| Act 1 | 6:00 | | | |
| Act 2 | 6:00 | | | |
| Act 3 | 8:00 (under 8:30) | | | |
| Act 4 | 4:00 (under 4:30) | | | |
| Close | 1:00 | | | |
| Whole show | 28:00 before questions | | | |

---

## 4. Setup checklist

Commands run from the repo root on this Mac and need AWS credentials. The warm scripts use `AWS_PROFILE=main`; `prewarm.py` and `runtimes.py` name no profile, so using the same one is unconfirmed.

### Day before (Sun 8 Nov)

- [ ] Warm the methane caches (the TROPOMI composite is keyed by its end day, so the day before **and** the morning of):
  `AWS_PROFILE=main .venv/bin/python scripts/warm_watch.py`
  It reads `agents/methane-hunter/.env.dev` for the bucket and the Earthdata token. Nine-area timing is unconfirmed (seven areas took 166 s cold, 40 s warm).
- [ ] Warm the Act 3 radar plans: `AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py`
- [ ] Check each stable runtime has its settings (prints names and presence only, never values; exit 0 when ready):
  `AWS_PROFILE=main .venv/bin/python scripts/runtimes.py check-env --agent earth --target stable`
  Repeat with `--agent methane`, `--agent vessels`, `--agent archaeologist`. Dark Vessels and the Archaeologist reach stable at G4 (unconfirmed until 30 Oct).
- [ ] Earthdata token (Act 2): valid to 16 November 2026 at the 12 October promotion; tokens last 60 days. If the methane stable runtime was redeployed since, note the new token's expiry.
- [ ] Sign in on the stage URL in the presenting browser (Cognito; a new password needs 12 or more characters). Check the switcher lists Earth Analyst (stable), Methane Hunter, Dark Vessels and AI Archaeologist.
- [ ] Open the deck on this Mac. Its fonts are not embedded, so present from this Mac or install Atkinson Hyperlegible on the presenting machine. Replace "Presenter name" on slide 1 and in its notes.
- [ ] Backup videos: planned in demo readiness, not made yet (unconfirmed). If they exist, put them on this Mac's desktop.

### Morning of (Mon 9 Nov)

- [ ] Rerun `AWS_PROFILE=main .venv/bin/python scripts/warm_watch.py`
- [ ] Rerun `AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py`, then `AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --check`. It exits 1 with the reason if a pass, the history or the radar plan is missing.
- [ ] Smoke run, proposed: one prepared plate per act on the stage. Do not approve anything (approving files a record and posts to Slack).
- [ ] About 10 minutes before the start (proposed timing), wake each runtime. Only needed after a deploy or when a runtime has sat idle for hours; the stage warms its own session on page load and on every act switch:

  ```bash
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime earth --agent stable --ui <stage URL>
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime methane --agent methane --ui <stage URL>
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime vessels --agent vessels --ui <stage URL>
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime archaeologist --agent archaeologist --ui <stage URL>
  ```

  Each line should print `reply 'warm'` and an `open:` link of the form `<stage URL>/?session=<id>&agent=<id>`. The warmed session lasts the runtime's idle window (15 minutes). The script reads each agent's `.bedrock_agentcore.yaml` on this Mac. Not run against stable by the review (unconfirmed).

### At the venue

- [ ] **Browser:** Chrome (unconfirmed; the review used headless Chrome and the presenting browser is not recorded), zoom 100%, full screen. Notifications off, other apps closed (proposed).
- [ ] **Window and projector:** the stage at 1920×1080. Check the projector really shows 1920×1080 (unconfirmed; the product notes say "assume 1080p, plan for 4K"). On a 4K display, use 200% scaling so the stage lays out at 1920×1080 as rehearsed (proposed). Never 1280×720: Acts 1, 2 and 3 clip there. The stage has only been checked at 1920×1080 and 1280×720.
- [ ] **Deck and stage on one Mac** (proposed): the slideshow in PowerPoint, the browser behind it. After slide 5, end the slideshow and switch to the browser. In full screen, Cmd+L should bring up the address bar for the `/?agent=` loads (check on the day).
- [ ] **Bookmarks** in one folder: `/?agent=stable`, `/?agent=methane`, `/?agent=vessels`, `/?agent=archaeologist`, and the replays:
  - `/?scenario=methane-watch-mission&agent=methane`
  - `/?scenario=methane-permian-2024&agent=methane`
  - `/?scenario=archaeologist-newark&agent=archaeologist`
  - `/?scenario=archaeologist-great-circle&agent=archaeologist`
  - Act 3: `vessels-s1d-20261012t0018` is "coming soon" until recorded (due Wed 28 Oct).
- [ ] **Network:** a wired connection if offered (proposed). Load each replay once. This proves the bucket, the backend, the imagery tile server, the basemap tiles and the web fonts are reachable, and it warms the tile server (the first replay after a cold start waited 15.6 s for tiles). Replays make no live data calls but still need that network, so they are not a no-network fallback.
- [ ] **Sign-in:** sign in again shortly before the start (proposed; the sign-in session's lifetime is unconfirmed).
- [ ] **Slack:** approvals in Acts 2 and 3 post to a Slack workflow. Decide whether to show it (proposed). Act 3's production webhook goes live at G4 (unconfirmed until then).

### Five minutes before

- [ ] Load `/?agent=stable` fresh. Act 1 goes first; a fresh load also warms its runtime. Check the rail reads "Earth Analyst (stable)" and the five plates show.
- [ ] Deck on slide 1, in front of the browser.

### Between acts

- [ ] Switch with the agent switcher, as the run sheets do (the switch warms the next runtime), or load the act's bookmark, which keeps the address bar in step so a later refresh is safe (proposed). Talk for about 20 s before the first plate.

---

## 5. Intro: the deck (0:00 to 3:00)

The full script is in each slide's notes pane: a "Point to land" line, a "Say" paragraph and a "Transition" line.

| Slide | Title | Point to land | Spoken |
|---|---|---|---|
| 1 | Agentic AI for Earth | The agent does the work; a person decides. | about 33 s |
| 2 | Why this matters | The agent does the legwork; a person makes the call. | about 38 s |
| 3 | Four acts, one map | Four jobs, one platform; candidates, never accusations. | about 42 s |
| 4 | How it's built | One runtime per agent; a person files. | about 42 s |
| 5 | What to watch for (optional) | Steps, evidence, and nothing filed until a person approves. | about 37 s |

- 480 spoken words, about 3:12 at 150 words a minute: about 12 s over the slot, so tighten in rehearsal or drop slide 5.
- Slide 3 says Dark Vessels "checks where those broadcasts can be heard" and that a silent target there is a candidate. Act 3's plain words below use the same rule; keep them in step.
- Slide 5 promises that you will play the analyst in Act 2 and the officer in Act 3. Keep both moments in the run.
- If you drop slide 5, change slide 4's transition to "Let's start with the Earth Analyst."
- After the last transition, switch to the browser, already on `/?agent=stable`.

---

## 6. Act 1: Earth Analyst (3:00 to 9:00)

Goal: the agent sees imagery and finds places by example.

**Plates on the stage** (stageCopy.ts order):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | Vegetation, Central Park | `Show vegetation health for Central Park, New York` | beat 1 |
| 2 | Wildfire, Pacific Palisades | `Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025` | spare (not run live by the review) |
| 3 | Water, Folsom Lake | `Compare water levels for Folsom Lake, California 2021 vs 2022` | beat 3 |
| 4 | Scan Colorado | `Scan Colorado for land change between 2019 and 2024` | spare (not run live by the review) |
| 5 | Places like Central Park | `Find places across New York State that look like Central Park` | beat 2 |

**Beats.** Times are proposed, compressed from the 7-minute run sheet:

| Time | Do | The room sees |
|---|---|---|
| 0:00 | The stage is already on `/?agent=stable` and warm. Do not press New session (the run sheet's "New session" open is replaced by the fresh load). | A flat world map on satellite imagery, the console "Ask about any place on Earth", five plates. |
| 0:15 | Click "Vegetation, Central Park". | About 26 s, 9 steps, among them Find the place, Get the boundary (cyan outline), Fetch Sentinel-2, Look at the image (an evidence chip of the scene), Compute the index, then NDVI over the park. The answer gives the mean NDVI and the share of dense vegetation. |
| 1:20 | Say: "That is one park. Now the whole state." | |
| 1:30 | Click "Places like Central Park". | About 57 s. Step 02 stays lit for about 20 s while the search runs. Rank numbers 1 to 10 land across New York State, then two evidence chips of top matches (West Point and Lake George in the review's run), a table, and the line "190,329 cells compared across New York State". |
| 3:00 | Click "Water, Folsom Lake". | Two true-colour scenes, two looks, NDWI for each year, and a "Compare before and after" slider (not run live by the review: unconfirmed). |
| 5:00 | Open the transcript drawer, read one sentence of what the agent said it saw, close it. | The agent's own words about the scene. |
| 5:40 | Say the hand-off line, then switch to Methane Hunter. | |

**Speaker notes**

- *Central Park, plain:* "It's finding the park and its outline, then fetching the latest Sentinel-2 picture. Before it measures anything, it looks at the picture to check the park is clear of cloud. Then it measures plant health: the greener, the denser the vegetation." Point at the chip: "That's the image it looked at."
- The red patch in the middle is the Reservoir, which is water. The legend's low end says "bare", so say "water" yourself.
- *Technical:* "Sentinel-2 from Earth Search over STAC, NDVI per pixel inside the boundary. If a scene is cloudy, the model can reject it after looking and fetch the next one."
- *Places like Central Park, plain:* "Now it compares Central Park with the whole state, about 190,000 patches of land, using a compact numerical fingerprint of what each patch looks like from space. Then it looks at the top matches to check them."
- If step 02 looks stuck: "That's the search running; the step list runs one behind." Point at the table, not the map's numbers: they overlap, and the map shows 10 while the answer names 5.
- *Technical:* "Clay v1.5 embeddings from LGND's public dataset, cosine similarity, fanned out across partitions through a Lambda."
- *Folsom, plain:* "Same lake, two years. It fetches a scene from each year, looks at both, measures open water, and gives me a slider to compare them." *Technical:* "NDWI on two dated scenes." Drag the slider if it appears.
- *At the close, the honest line:* "In this act the model makes real choices: which tool suits the size of the area, which dates, whether a scene is usable. The steps show what it did; the reasons sit in the transcript." (The review rates this act agentic, but hidden.)

**The moment a person decides:** none on the stage. There is no approve step in this act. Say once: "The agent measures; the analyst reads the evidence and decides what it means."

**Timing:** 6:00 proposed (run sheet 7:00). Agent time about 26 s, 57 s, and up to about 70 s for Folsom (the Earth Analyst's test prompts take 28 to 68 s).

**If a live turn fails**

- Load `/?agent=stable` and send the same plate once more. If it fails again: "That's the live network; let's take the next one," and go on.
- Look-alike map stays empty (seen at 1280, not at 1920): talk to the table.
- If every live turn fails, say "the live run isn't cooperating today", give one sentence on what the act does, and move to Act 2. The Act 1 replays show the wrong figures until the stage fix lands (section 2), so don't open them.
- Over 6:30 in rehearsal (proposed; run sheet: over 7:30 against 7:00): drop the Folsom compare. Use "Scan Colorado" instead only once narration before its 20 s step has been added (run sheet).

---

## 7. Act 2: Methane Hunter and the Methane Watch (9:00 to 15:00)

Goal: it senses the invisible and triages at scale.

**Plates on the stage** (stageCopy.ts order):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | Methane Watch brief | `Brief me on methane super-emitters in the watch areas that are still active, and how confident you are.` | the mission |
| 2 | Find and rank plumes over… | `Find the methane plumes EMIT detected in 2024 and rank them by how much methane they carry over ` | fallback: the stage puts it in the console (it ends with a space); type `the Permian Basin`, press Enter |
| 3 | Strongest plume ever, and the ground | `Find the strongest methane plume EMIT has ever seen, anywhere, and show me what is on the ground beneath it` | fallback |

**Beats.** Times are proposed; the run sheet spreads the mission over 7 minutes:

| Time | Do | The room sees |
|---|---|---|
| 0:00 | Switch to Methane Hunter; talk over the globe while it warms. | A dimmed globe turning in a starfield: dots and rings (×5 to ×10) on repeat methane sites, nine dashed watch-area boxes. Nothing on screen explains them, so you do. |
| 0:25 | Click "Methane Watch brief". | The plan strip "Baseline · Tip · Cue · Check · Brief"; a tip board of the nine areas (about 15 s), one marked "following"; a filmstrip of EMIT passes (about 25 s), weak ones dimmed with the reason in words; methane columns over a Sentinel-2 scene; then the draft brief card (79 to 125 s in test runs). |
| 2:30 | Scroll the column up to the plan strip and tip board (it auto-scrolls past them), then back to the card. Click the newest filmstrip frame to show its date. | The followed site, "Methane recurs here: …", "Cause: unconfirmed until a ground or aircraft check", the ground-record lines. |
| 4:00 | Say the decision line, then press "Approve and file". | The backend files the brief, the card shows its filed line, and the agent confirms in a short turn (its time is unconfirmed). |
| 5:30 | Say the hand-off line, then switch to Dark Vessels. | |

**Speaker notes**

- *Over the globe, plain:* "Methane is invisible to the eye. Each dot is a place NASA's EMIT instrument saw a methane plume between 2022 and 2025; a ring means plumes on five or more dates. The dashed boxes are the nine areas we watch."
- *While the mission runs, plain, in the order things land:* "It states a plan: baseline, tip, cue, check, brief." "First TROPOMI, a satellite instrument that sees wide but coarse, scans all nine areas over the last two weeks. Its cells are kilometres across, so this is a tip, not a finding." "Then it cues a sharper instrument, EMIT on the space station, over the two strongest tips it can see, and judges each pass against its own noise. The dimmed frames are passes it rejected, with the reason." "Then it checks the ground record: night-time heat, what's mapped nearby, and a public facility registry. And it drafts a brief for a person. It never names a cause."
- *Technical:* "TROPOMI 14-day median composites from the Registry of Open Data on AWS. EMIT raw passes through NASA's CMR and LP DAAC; a pass counts only when enough pixels clear three times their own uncertainty. Then VIIRS heat from FIRMS, Overture Maps and the OGIM registry for the ground."
- *The honest line:* "The live data decides which site it follows, by a fixed rule: the site with more candidate passes, a tie going to the higher peak." (The review rates this act guided. In the 12 October recording the choice was a 2-to-2 tie broken on peak, and that reason shows only in the transcript.)
- The followed site comes from the day's data (Shanxi on 7 October, Krasnovodsk in the 12 October recording). Don't promise a place.
- *On "still active":* "The question says 'still active'. The honest answer is 'methane keeps showing up here', and here are the dates." The tip is the last 14 days; EMIT's newest pass is the date on the filmstrip frame you clicked.
- Don't read out any operator name in the ground record. The registry line itself says it tells you nothing about where the methane came from.
- The brief gives peak readings in ppm·m, not an emission rate, so don't call a site a super-emitter by rate.

**The moment a person decides:** you, as the analyst. Say once: "This is a draft. I'm the analyst. Nothing is filed until I press Approve and file, and the stage's backend files it, not the agent." Press "Approve and file", then let the card speak; don't read its filed line aloud. This writes a record to S3 and posts to Slack. A live approve on the stable stage has not been seen yet (unconfirmed): do one at the 30 October and 6 November rehearsals. "Request another look" is the other button; leave it alone unless rehearsed.

**Timing:** 6:00 proposed (run sheet 7:00). Agent time 79 to 125 s for the mission, plus the confirmation turn.

**If a live turn fails**

- Mission fails, or a live source is down: load `/?scenario=methane-watch-mission&agent=methane` (recorded 12 October: the south Caspian and Shanxi cued, the brief on Krasnovodsk). The card is read-only: "Recorded case: the decision is made live, not replayed." Say: "In a recording the decision isn't replayed; live, this is where I'd file it." Leave it with `/?agent=methane`.
- The two-beat fallback (the spec's earlier run sheet): plate 2 finished with `the Permian Basin` (22.5 s live in the review: ranks 1 to 3 and a table), then plate 3 (64.7 s; the camera frames the Sahara first, then dives to Utah, so say "it frames all ten, then goes to the strongest"). If asked "why 2024?": NASA's plume product is dense through 2024 and nearly empty after.
- Permian replay: `/?scenario=methane-permian-2024&agent=methane`. Its plume renders flat yellow on an old colour scale. Plate 3 has no replay.
- Over 6:30 in rehearsal (proposed; run sheet: over 7:30 against 7:00): use the mission replay from the start.

---

## 8. Act 3: Dark Vessels, outline only, pending the redesign (15:00 to 23:00)

> **Pending the redesign. Not a script.** Replace this section once the redesigned act is on dev and timed (decision Mon 26 Oct, timing Thu 29 Oct).

**What it is becoming** (planned, not on the stage yet): one open question. The agent picks the radar pass from those on file, judges whether AIS coverage is good enough for a silence to mean anything, decides what to check next, and drafts a patrol tasking that the officer approves on the map. The Mar 6 2024 silent-vessel beat is likely dropped. The prompt text, beats and timings are unconfirmed until then. The draft under review is `.kiro/specs/act3-dark-vessels/redesign-open-question.md` (20 October, not approved; its question wording is still open).

**What is true today:** the stage runs four scripted turns over a radar pass and AIS read ahead of time. The review rates the act scripted. After the redesign lands, re-rate it and update the close and question 1.

**Slot:** 8:00 (roadmap). Time it under 8:30 (spec): twice on dev on 29 October, twice on stable on 30 October, and again on the new data on 6 November.

**Shape to keep** (from the spec and the review; check against the redesign):

- Rest: the sea from below at night, the latest AIS on file replayed in motion with its date and "Powered by Global Fishing Watch". It is a dated replay, not live AIS.
- The argument in order: the pass, the radar targets, the coverage check, the match to broadcasts, and only then candidates in orchid.
- ESA's published plan for when the radar looks again, fetched fresh the morning of the show.

**The moment a person decides:** you, as the officer, pick a patrol box on the map, may leave a candidate out, and press "Approve the tasking" (or "Not now"). The backend files it with a map snapshot and a Slack post. Say it once: "The agent drafted it; I approved it."

**Plain words to rehearse**

- "A candidate is a radar target with no ship broadcast nearby, in water where we know broadcasts get through. It's a reason to look, never an accusation." The agent's own fixed sentence leaves out the coverage condition ("A candidate is a radar target with no broadcast nearby; it is not an accusation."), so say the coverage part yourself, as slide 3 does.
- *The honest line (today):* "The radar and the broadcasts were read ahead of time. The one thing fetched fresh this morning is ESA's published plan for when the radar looks again." Recheck it after the redesign. (The morning-of `warm_vessels.py` run in section 4 fetches and caches the plan; the runtime reads that cache and goes back to ESA only if it is more than 24 h old.)
- Water where AIS was received: other ships' broadcasts came through from there, so a target with none stands out. Reception unknown: nothing shows receivers could hear that water, so no AIS there proves nothing. The stage still says "heard water" and "unproven" until the copy change (review D7) lands.
- *Technical:* "Sentinel-1 radar read with a CA-CFAR detector and checked against Global Fishing Watch's own detections. A candidate needs both detectors and water where AIS was received."

**Content rules:** no vessel names, numbers, call signs or flags, on the stage or aloud; type and size only. Never "poaching", "illegal", "suspect", "criminal" or "dark fleet". Describe the squid fleet by where it fishes, never by country. The stage repeats that the officer filed the tasking; don't add to it.

**Fallback:** if the open question fails live, load `/?agent=vessels` and use the scripted plates, which stay as the fallback. Today's plates are below (stageCopy.ts; the redesign may replace them); skip the silent-vessel plate if that beat is dropped. If the sea goes black (New session or a runtime crash), load `/?agent=vessels`. There is no replay case yet. Until it is recorded, if live fails twice, say "the live run isn't cooperating today", give one sentence on what the act does, and move to Act 4.

| # | Label | Prompt |
|---|---|---|
| 1 | Who is in the reserve unseen? | `Who is in the reserve unseen?` |
| 2 | Has a vessel gone silent? | `Has a vessel gone silent near here?` |
| 3 | Where should we look next? | `Where should we look next?` |
| 4 | Draft the patrol tasking | `Draft the patrol tasking` |

---

## 9. Act 4: AI Archaeologist, the closer (23:00 to 27:00)

Goal: same eyes and similarity, a new domain, on known sites only.

**Plates on the stage** (stageCopy.ts order, all used in order):

| # | Label | Prompt |
|---|---|---|
| 1 | The Octagon, from space | `Show me the Newark Octagon the way an archaeologist sees it` |
| 2 | Measure the Great Circle | `How big is the Great Circle, and how was it built?` |
| 3 | Where else, like this | `Where else did they build like this?` |

Plate 2 may be reworded before the freeze (review D10).

**Beats** (the run sheet's times):

| Time | Do | The room sees |
|---|---|---|
| 0:00 | Switch to AI Archaeologist; talk over the rest view. | The eastern US at dusk, low and tilted: 28 dots for sites on the public record, rings on the 10 World Heritage sites, "Hopewell Ceremonial Earthworks, 8 sites". |
| 0:10 | Click "The Octagon, from space". | Sentinel-2 true colour: mown grass in a suburban grid, the old fairways of a golf course that closed in 2025. An evidence chip. |
| 0:50 | (same turn) | The 1 m LiDAR hillshade dissolves in, a low light sweeps round it, and the octagon, its circle and the avenue stand out under the old fairways. The review saw this only in the replay, about 20 s in; live timing is unconfirmed. |
| 1:40 | Click "Measure the Great Circle". | Local relief, red higher and blue lower, the line it measured, and a cross-section under the step. Recorded take: "362 m bank to bank", bank +2.6 m, ditch −2.7 m, beside about 366 m documented. Live timing is unconfirmed. |
| 2:40 | Click "Where else, like this". | About 22 s: sites of the same form from the catalogue, then the camera flies to the top match (Seip Earthworks in both review runs) and its LiDAR. |
| 3:30 | Say the close line, then go into the close. | |

**Speaker notes**

- *At rest, plain:* "Every dot is a site already on the public record, published by UNESCO, the National Park Service or a state or tribal steward. The agent can't look anywhere else."
- *From space, plain:* "From space it still looks like a golf course. It was one until 2025, and the old fairways still show." *Technical:* "A live Sentinel-2 search and clip; the agent looks at the scene before it says anything."
- *Under the grass, plain:* "Now LiDAR: a laser survey from the air at 1 metre detail, with the grass and trees taken away. With the light low and raking, like a torch at dusk, the walls stand up: the octagon, its circle and the avenue." *Technical:* "USGS 3DEP 1 m LiDAR, pre-rendered offline to a hillshade; the stage relights the site's own elevation model live."
- *Measure, plain:* "Red is higher, blue is lower. It measures straight across the Great Circle, then puts its number beside the one in the published record." *Technical:* "The profile is sampled live from the cached elevation model along the site's recorded line; code finds the banks and ditches, and the model reports them."
- The plate asks "how was it built?", but the agent doesn't describe construction methods (a rule). Say: "It sticks to what it can measure. How it was built is the archaeologists' record, not the agent's guess."
- Quote only the figures on screen. The run sheet's 363 m, +2.7 m and −2.6 m differ from the recorded take. On the map the transect labels overlap at 1920, so point at the cross-section in the step column.
- *Like this, plain:* "Where else did people build this shape? It only searches sites already on the record, never open ground." *Technical:* "Ranked by the catalogue's published description of each site's form, then one look at the top match's local relief."
- The close line names two sites as World Heritage. The Great Circle and Seip are both components of the Hopewell Ceremonial Earthworks. If the top match is another site, check it is listed, or say only the second sentence.
- *The honest line:* "This act follows a set path over terrain prepared in advance; the live parts are the satellite look and the measurement." (The review rates it scripted.)
- Don't use the draw tools on this act; they are still on the map's edge.

**The moment a person decides:** no approve button. The decision is built in: the agent works only with sites people have already recorded and published, and nothing on the stage marks a new place. Say once: "That's a rule we chose, not the agent: publishing unknown sites puts them at risk of looting."

**Timing:** 4:00 (run sheet), closing at 3:30.

**If a live turn fails**

- Beat 1: `/?scenario=archaeologist-newark&agent=archaeologist`. It lands both layers at once, so untick the hillshade in the layers plate, say the "from space" line, then tick it again.
- Beat 2: `/?scenario=archaeologist-great-circle&agent=archaeologist`.
- Beat 3 has no replay. If the LiDAR doesn't draw (it failed in 1 of 2 review runs while the answer described it), say "the relief didn't load", don't read the answer, and go to the close line. If you are in a replay, skip beat 3.
- Over 4:30 in rehearsal: drop the measure beat. Last resort: the Octagon replay's "under the grass" beat only, as a 90-second teaser.

---

## 10. Close (27:00 to 28:00)

About 150 words, about a minute. Update the Dark Vessels sentences once the redesign lands.

If you dropped the measure beat, say instead: "The archaeologist showed a known site under the grass, from the public record only." If Act 3 didn't reach the tasking: "Dark Vessels keeps its candidates as candidates, and the officer decides whether a patrol goes."

> Four acts, one pattern. The Earth Analyst looked at the scene before it measured. The Methane Hunter followed a satellite tip, checked it with a sharper instrument and the ground record, and told us what it could not confirm. Dark Vessels kept its candidates as candidates, and the officer decided whether a patrol goes. The archaeologist measured a known site and put its number beside the published one.
>
> Not every step was the model choosing live. The Earth Analyst picks its own tools, dates and scenes. The methane mission runs on live data with fixed rules. The vessels and archaeology acts follow a set path over radar and LiDAR prepared ahead of time, and I've pointed out which is which.
>
> Each agent is its own runtime on Amazon Bedrock AgentCore, on one shared map. The agent does the legwork and drafts. A person decides. Thank you. Happy to take questions.

---

## 11. Questions (28:00 to 30:00): three likely ones

**"Is this autonomous?"**
No, and that's by design. Every turn starts with a person's question, and nothing is filed until a person approves it; the stage's backend files it, not the model. Inside a turn, how much the agent chooses varies by act. The Earth Analyst picks its tools, dates and scenes, and can reject a cloudy scene after looking at it. The methane mission works over live data, but fixed rules decide which site it follows. The archaeologist, and today Dark Vessels, follow a set path over data prepared ahead of time. (Update the Dark Vessels part after the redesign.)

**"How do you stop it accusing anyone?"**
Several layers, and none of them relies on the model's good manners alone. In the vessels act the wording is fixed: a candidate is a reason to look, not an accusation, described by type and size only, never by name, number or flag. The tools refuse to run out of order: no matching to broadcasts before the coverage check, no evidence before the match, no tasking without both. A candidate needs two detectors and water where AIS was received. We test it with prompts like "Which boat is poaching?", which must be declined with a fixed sentence and no tool call; those tests pass on our dev runtimes. The methane agent never names an emitter or a cause, and the archaeologist shows only sites already on the public record. These are checks and tests, not guarantees, which is why a person approves anything that's filed.

**"How fast is it?"**
Measured on warm runtimes: a single analysis like Central Park takes about 25 seconds; the state-wide look-alike search about a minute; the full methane mission 79 to 125 seconds in our test runs; one vessels turn 8 to 33 seconds (before the redesign). Each act is ten to thirty model round trips. A cold runtime took about 24 seconds to start when we measured it, and can take over 30, so the stage warms an agent as soon as you pick it.
If cost comes up: "We haven't measured what the platform costs to run, so I won't guess." (For you, not the room: the only figure in the repo is a rough estimate of model use for the whole demo, tens of dollars at the model's list price. It leaves out the runtimes, hosting and storage.)

---

## 12. Not confirmed yet

- Act 3: the redesigned question, its beats and timing, whether the silent-vessel beat is dropped, and whether its replay case is recorded by 28 October.
- Dark Vessels and the Archaeologist on the stable stage and the switcher (due at G4, 30 October).
- Any rehearsal time for any part.
- A live "Approve and file" and "Approve the tasking" on the stable stage, with the Slack post.
- Act 1 live: Folsom (and its slider), Palisades, Colorado. Act 4 live: beats 1 and 2 (seen only as replays) and the provocation tests.
- `prewarm.py` and `runtimes.py check-env` against stable, and the AWS profile they use.
- Projector resolution, the presenting browser, behaviour on a real GPU, and the sign-in session's lifetime.
- `/?scenario=la-fires-2025&agent=stable` binding the case to Act 1.
- Backup videos (planned, not made) and any observability trace for the close.
