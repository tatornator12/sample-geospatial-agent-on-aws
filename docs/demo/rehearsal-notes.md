# Agentic AI for Earth: rehearsal and speaker notes

**DRAFT, 21 October 2026.** Act 3 is being redesigned and the stage review's known issues are still open, so beats, timings and the "until fixed" box will change before the show.

**Show order (decided 21 October):** Earth Analyst (Act 1), then AI Archaeologist (Act 4), then Methane Watch (Act 2), and Dark Vessels (Act 3) closes the show. The act numbers are the agents' names in the code and specs; only the running order changed. These notes keep the act numbers and put the sections in show order.

One presenter, 30 minutes, Monday 9 November 2026, for a mixed technical and non-technical room. Each act gives a plain line for everyone and one line for the technical half. "(unconfirmed)" means the repo does not confirm it; "proposed" means these notes suggest it and no spec or run sheet sets it. Sources per section: `.agents/tasks/demo-deck-2026-10-20/notes-verification.md` (numbered before the 21 October reorder: its sections 7, 8 and 9 are now sections 8, 9 and 7).

Stage addresses below are relative to the stage URL (the `ApplicationURL` stack output, not written here). Agent ids: `stable` (Act 1, Earth Analyst), `methane` (Act 2), `vessels` (Act 3), `archaeologist` (Act 4).

---

## 1. Running order (30 minutes)

| In the show | Part | Minutes | Clock | Ends on |
|---|---|---|---|---|
| | Intro (deck, 5 slides) | 3 | 0:00 to 3:00 | "Let's start with the Earth Analyst." |
| First | Act 1, Earth Analyst | 6 | 3:00 to 9:00 | "Same eyes, same search, new domains next." |
| Second | Act 4, AI Archaeologist | 4 | 9:00 to 13:00 | "Both are already on the World Heritage list. I only work with sites on the public record." |
| Third | Act 2, Methane Hunter (Methane Watch) | 6 | 13:00 to 19:00 | "It found the invisible and told you what it could not confirm." |
| Last, the closer | Act 3, Dark Vessels | 8 | 19:00 to 27:00 | The officer approves the tasking on the map; the Slack post lands on the second screen (pending the redesign). |
| | Close | 1 | 27:00 to 28:00 | "Happy to take questions." |
| | Questions | 2 | 28:00 to 30:00 | |
| | **Total** | **30** | | |

Why this order:

- **Earth Analyst first:** the agent sees, and turns down a cloudy scene (the Bergen plate).
- **AI Archaeologist second:** the same eyes in a new domain, and it chooses its own line to measure across an Octagon wall.
- **Methane Watch third:** a whole mission at scale on live data, and the stage shows why it follows one site over the other.
- **Dark Vessels last:** one open question. The agent chooses the radar pass, sets aside a pass it can check too little of, decides what comes next, gives a measured prediction and drafts a patrol tasking. The officer approves it on the map, and the Slack post on a second screen is the final image.

**If Act 3 misses its gate B (Wed 28 Oct 12:00),** Methane Watch closes the show. Either cut Act 3, or run its four-turn version third:

| Fallback | After the intro (0:00 to 3:00) |
|---|---|
| Four-turn Act 3, third | Act 1 3:00 to 9:00 · Act 4 9:00 to 13:00 · Act 3, four turns, 13:00 to 21:00 · Act 2, the closer, 21:00 to 27:00 · Close 27:00 to 28:00 · Questions 28:00 to 30:00 |
| Act 3 cut | Act 1 3:00 to 9:00 · Act 4 9:00 to 13:00 · Act 2, the closer, 13:00 to 19:00 · Close 19:00 to 20:00 · Questions 20:00 to 30:00 (proposed; set a fuller plan at the 29 October rehearsal if it comes to this) |

Where the minutes come from (the roadmap carries the same minutes since 21 October):

- **Intro 3:** the deck's notes run about 3:13 at 150 words a minute (483 spoken words), so take about 13 s out in rehearsal. Slide 5 is optional; without it the intro is about 2:31.
- **Act 1 at 6:** its run sheet is 7:00 with the hand-off at 5:50. These notes skip its "click rank 1" popup beat, which fails today. The Folsom compare is now the run sheet's spare.
- **Act 4 at 4:** its run sheet, closing at 3:40.
- **Act 2 at 6:** the mission is 79 to 135 s of agent time in test runs, so most of the run sheet's 7 minutes is narration. The 6 minutes keep the approval. Run sheet: 7:00, approval at 6:30.
- **Act 3 at 8:** the spec's limit is under 8:30. The redesign plans about 1 minute of agent time and about 2 for the officer's choice and narration, which leaves room for the second screen and the spare question (unconfirmed until timed).
- **Close at 1:** the roadmap's old 2 minutes held a teaser of the act not shown and an observability trace. All four acts are in the show, so there is nothing to tease. No trace is prepared, and whether any stable runtime sends one is unconfirmed. Leave both out unless one is built and rehearsed.
- **Questions 2:** the roadmap had no question time before 21 October.

Each act's minutes include the switch and about 20 s of talk while its runtime warms. A cold boot measured 23.7 s, and the stage's own pre-warm absorbed it.

If you run long, cut in this order. The order across acts is proposed; Dark Vessels closes, so it gives up time last. Each cut is that act's own run sheet fallback unless marked otherwise.

1. Act 1: skip the transcript drawer beat (proposed) and say what it skipped from the step line. The run sheet's spare, the Folsom compare, is already out.
2. Act 4: drop the Great Circle measure (Act 4 run sheet).
3. Act 2: run the mission replay instead of the live mission (Act 2 run sheet: "start from the globe replay case").
4. Questions take what is left (proposed).
5. Act 3: do not offer the spare question (the redesign's "Same question, end of August" plate). Pending the redesign.
6. Last resort: Act 4 as a 90-second teaser in its slot, the Octagon replay's "under the grass" beat only (the Act 4 run sheet's cut-list fallback).

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
| Mon 26 Oct | Act 3 gate A, drop-dead 12:00 (the open question on dev) | act3 redesign U10 |
| **Wed 28 Oct** | **Act 3 gate B, drop-dead 12:00:** if it misses, Methane Watch closes the show (section 1). Act 3 replay case due | act3 redesign U10; act3 tasks 6.1 |
| **Thu 29 Oct** | **Timing rehearsal:** Act 3 timed twice against dev, under 8:30, fallbacks recorded. Proposed: time every part against section 1 the same day, in the new order. | act3 tasks 7.1 |
| Fri 30 Oct | G4: Release 3 with all four agents; Act 3 timed twice against stable; the 30-minute show once, in the new order (proposed: with the second screen) | act3 tasks 7.2 |
| **Tue 3 Nov** | **Freeze:** nothing new lands after this, only fixes | working agreement; roadmap |
| 3 to 7 Nov | Demo readiness: runbook, backup videos, prewarm, two timed rehearsals (dates not set) | roadmap row 7 |
| Thu 5 Nov | Dark Vessels data rerun (newest pass and AIS, refit), data only | act3 design decision 12 |
| **Fri 6 Nov** | **Rehearsal** of Act 3 on the new data; last fixes-only promotion | act3 design decision 12; review summary |
| Mon 9 Nov | The show | roadmap |

No act has a recorded rehearsal time yet. Fill this in as you go, in show order:

| Part | Target | Thu 29 Oct | Fri 30 Oct | Fri 6 Nov |
|---|---|---|---|---|
| Intro | 3:00 | | | |
| Act 1 | 6:00 | | | |
| Act 4 | 4:00 (under 4:30) | | | |
| Act 2 | 6:00 | | | |
| Act 3 | 8:00 (under 8:30) | | | |
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
  Repeat with `--agent archaeologist`, `--agent methane`, `--agent vessels`. Dark Vessels and the Archaeologist reach stable at G4 (unconfirmed until 30 Oct).
- [ ] Earthdata token (Act 2): valid to 16 November 2026 at the 12 October promotion; tokens last 60 days. If the methane stable runtime was redeployed since, note the new token's expiry.
- [ ] Sign in on the stage URL in the presenting browser (Cognito; a new password needs 12 or more characters). Check the switcher lists Earth Analyst (stable), Methane Hunter, Dark Vessels and AI Archaeologist.
- [ ] Open the deck on this Mac. Its fonts are not embedded, so present from this Mac or install Atkinson Hyperlegible on the presenting machine. Replace "Presenter name" on slide 1 and in its notes.
- [ ] Sign in to Slack on the second screen (Act 3's last beat) and open the channel the "Patrol taskings" workflow posts to (proposed: a second display beside the projector). Which display, how it connects and whether the whole room can see it are unconfirmed; set them at the 30 October run-through.
- [ ] Backup videos: planned in demo readiness, not made yet (unconfirmed). If they exist, put them on this Mac's desktop.

### Morning of (Mon 9 Nov)

- [ ] Rerun `AWS_PROFILE=main .venv/bin/python scripts/warm_watch.py`
- [ ] Rerun `AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py`, then `AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --check`. It exits 1 with the reason if a pass, the history or the radar plan is missing.
- [ ] Smoke run, proposed: one prepared plate per act on the stage. Do not approve anything (approving files a record and posts to Slack; an Act 3 post would land on the second screen's channel before the show).
- [ ] About 10 minutes before the start (proposed timing), wake each runtime, in show order. Only needed after a deploy or when a runtime has sat idle for hours; the stage warms its own session on page load and on every act switch:

  ```bash
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime earth --agent stable --ui <stage URL>
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime archaeologist --agent archaeologist --ui <stage URL>
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime methane --agent methane --ui <stage URL>
  AWS_PROFILE=main .venv/bin/python scripts/prewarm.py --target stable --runtime vessels --agent vessels --ui <stage URL>
  ```

  Each line should print `reply 'warm'` and an `open:` link of the form `<stage URL>/?session=<id>&agent=<id>`. The warmed session lasts the runtime's idle window (15 minutes). The script reads each agent's `.bedrock_agentcore.yaml` on this Mac. Not run against stable by the review (unconfirmed).

### At the venue

- [ ] **Browser:** Chrome (unconfirmed; the review used headless Chrome and the presenting browser is not recorded), zoom 100%, full screen. Notifications off, other apps closed (proposed).
- [ ] **Window and projector:** the stage at 1920×1080. Check the projector really shows 1920×1080 (unconfirmed; the product notes say "assume 1080p, plan for 4K"). On a 4K display, use 200% scaling so the stage lays out at 1920×1080 as rehearsed (proposed). Never 1280×720: Acts 1, 2 and 3 clip there. The stage has only been checked at 1920×1080 and 1280×720.
- [ ] **Deck and stage on one Mac** (proposed): the slideshow in PowerPoint, the browser behind it. After slide 5, end the slideshow and switch to the browser. In full screen, Cmd+L should bring up the address bar for the `/?agent=` loads (check on the day). With the second screen attached, check the slideshow and the stage both open on the projector, not on the Slack screen.
- [ ] **Second screen:** Slack full screen on the "Patrol taskings" channel, newest post in view, no other channel or notification visible (proposed). Read the newest post before the room sees it: it is the show's last image, so it must keep the content rules in section 9.
- [ ] **Bookmarks** in one folder, in show order: `/?agent=stable`, `/?agent=archaeologist`, `/?agent=methane`, `/?agent=vessels`, and the replays:
  - `/?scenario=archaeologist-newark&agent=archaeologist`
  - `/?scenario=archaeologist-great-circle&agent=archaeologist`
  - `/?scenario=methane-watch-mission&agent=methane`
  - `/?scenario=methane-permian-2024&agent=methane`
  - Act 3: no replay yet. The redesign records `vessels-open-question` (due Wed 28 Oct); until then the gallery's `vessels-s1d-20261012t0018` card shows "coming soon".
- [ ] **Network:** a wired connection if offered (proposed). Load each replay once. This proves the bucket, the backend, the imagery tile server, the basemap tiles and the web fonts are reachable, and it warms the tile server (the first replay after a cold start waited 15.6 s for tiles). Replays make no live data calls but still need that network, so they are not a no-network fallback.
- [ ] **Sign-in:** sign in again shortly before the start (proposed; the sign-in session's lifetime is unconfirmed).
- [ ] **Slack:** approvals in Acts 2 and 3 post to Slack workflows. Act 3's post is the final image on the second screen (decided 21 October); Act 2's is not shown (proposed). Act 3's production webhook goes live at G4 (unconfirmed until then).

### Five minutes before

- [ ] Load `/?agent=stable` fresh. Act 1 goes first, then the Archaeologist, Methane Watch and Dark Vessels; a fresh load also warms Act 1's runtime. Check the rail reads "Earth Analyst (stable)" and the six plates show.
- [ ] Second screen on the "Patrol taskings" channel, scrolled to the newest post (proposed).
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
| 3 | Four acts, one map | Four jobs, one platform; candidates, never accusations. | about 39 s |
| 4 | How it's built | One runtime per agent; a person files. | about 40 s |
| 5 | What to watch for (optional) | Steps, evidence, and nothing filed until a person approves; the show ends on the officer's call. | about 42 s |

- 483 spoken words, about 3:13 at 150 words a minute: about 13 s over the slot, so tighten in rehearsal or drop slide 5.
- Slide 3 shows the acts left to right in show order, each screenshot with its own name: Earth Analyst, AI Archaeologist, Methane Hunter, Dark Vessels. Its markers number them 1 to 4 by their place in the show, and its notes say "first", "second", "third" and "last", never the code's act numbers. Slide 2's notes say "the first act", "the methane act" and "the last act".
- Slide 3 says Dark Vessels "checks where those broadcasts can be heard" and that a silent target there is a candidate. Act 3's plain words below use the same rule; keep them in step.
- Slide 5 promises that you will play the analyst in the methane act and the officer in Dark Vessels, and tells the room the last act ends on the agent's own choices, a prediction checked against past radar days and a draft tasking. Keep those moments in the run.
- If Act 3 misses gate B, the deck needs a pass: slide 3's order and markers, "the last act" on slides 2 and 5, and slide 5's ending (proposed: "In the vessels act, I'll play the officer and decide whether to approve the patrol tasking.", or nothing if Act 3 is cut).
- If you drop slide 5, change slide 4's transition to "Let's start with the Earth Analyst."
- After the last transition, switch to the browser, already on `/?agent=stable`.

---

## 6. Act 1: Earth Analyst, first (3:00 to 9:00)

Goal: the agent sees imagery, turns down a scene it cannot use, and finds places by example.

**Plates on the stage** (stageCopy.ts order on `develop`; the stable stage has them from G4, 30 October):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | Vegetation, Central Park | `Show vegetation health for Central Park, New York` | beat 1 |
| 2 | A cloudy day, Bergen | `Show vegetation health for Bergen, Norway as of 2025-09-15` | beat 2 |
| 3 | Wildfire, Pacific Palisades | `Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025` | spare (not run live by the review) |
| 4 | Water, Folsom Lake | `Compare water levels for Folsom Lake, California 2021 vs 2022` | the run sheet's spare |
| 5 | Scan Colorado | `Scan Colorado for land change between 2019 and 2024` | spare (not run live by the review) |
| 6 | Places like Central Park | `Find places across New York State that look like Central Park` | beat 3 |

**Beats.** Times are proposed, compressed from the 7-minute run sheet:

| Time | Do | The room sees |
|---|---|---|
| 0:00 | The stage is already on `/?agent=stable` and warm. Do not press New session (the run sheet's "New session" open is replaced by the fresh load). | A flat world map on satellite imagery, the console "Ask about any place on Earth", six plates. |
| 0:15 | Click "Vegetation, Central Park". | About 26 s, 9 steps, among them Find the place, Get the boundary (cyan outline), Fetch Sentinel-2, Look at the image (an evidence chip of the scene), Compute the index, then NDVI over the park. The answer gives the mean NDVI and the share of dense vegetation. |
| 1:20 | Click "A cloudy day, Bergen". | 35 to 56 s on dev (not run live by the review). Fetch Sentinel-2 names its window, "Scenes from 2025-07-17 to 2025-09-15"; an evidence chip of the cloudy 2025-09-06 scene; Fetch Sentinel-2 again with "skipping 2025-09-06" in mono; a chip of the clear 2025-07-18 scene; NDVI; an answer that names the scene it used. In one of five dev runs the agent turned the cloudy scene down from its numbers without looking, so the first chip was missing; "skipping 2025-09-06" showed in all five. |
| 2:30 | Say: "That is one park. Now the whole state." | |
| 2:40 | Click "Places like Central Park". | About 57 s. Step 02 stays lit for about 20 s while the search runs. Rank numbers 1 to 10 land across New York State, then two evidence chips of top matches (West Point and Lake George in the review's run), a table, and the line "190,329 cells compared across New York State". |
| 4:20 | Open the transcript drawer, read the sentence where the agent turned down the Bergen scene, close it. | The agent's own words about why it skipped the scene. |
| 5:20 | Say the hand-off line, then switch to AI Archaeologist. | |

**Speaker notes**

- *Central Park, plain:* "It's finding the park and its outline, then fetching the latest Sentinel-2 picture. Before it measures anything, it looks at the picture to check the park is clear of cloud. Then it measures plant health: the greener, the denser the vegetation." Point at the chip: "That's the image it looked at."
- The red patch in the middle is the Reservoir, which is water. The legend's low end says "bare", so say "water" yourself.
- *Technical:* "Sentinel-2 from Earth Search over STAC, NDVI per pixel inside the boundary. If a scene is cloudy, the model can reject it after looking and fetch the next one."
- *Bergen, plain:* "Same measurement, a rainy city. The first picture it picks is cloudy over the city, so it turns it down, says why, and fetches the next clear one before it measures anything." Point at "skipping 2025-09-06" in the step.
- *Technical:* "It inspects the rendered scene, rejects it, then fetches again with that date left out. On dev it read 47.6% cloud over the city on 2025-09-06 and used 2025-07-18." Quote the cloud figure only if the stage or the transcript shows it.
- *Places like Central Park, plain:* "Now it compares Central Park with the whole state, about 190,000 patches of land, using a compact numerical fingerprint of what each patch looks like from space. Then it looks at the top matches to check them."
- If step 02 looks stuck: "That's the search running; the step list runs one behind." Point at the table, not the map's numbers: they overlap, and the map shows 10 while the answer names 5.
- *Technical:* "Clay v1.5 embeddings from LGND's public dataset, cosine similarity, fanned out across partitions through a Lambda."
- *Folsom (spare), plain:* "Same lake, two years. It fetches a scene from each year, looks at both, measures open water, and gives me a slider to compare them." *Technical:* "NDWI on two dated scenes." Drag the slider if it appears (not run live by the review: unconfirmed).
- *At the close, the honest line:* "In this act the model makes real choices: which tool suits the size of the area, which dates, whether a scene is usable. Bergen puts one of them on the stage, the scene it skipped; the reasons sit in the transcript." (The review rates this act agentic, but hidden; the Bergen beat came after the review.)

**The moment a person decides:** none on the stage. There is no approve step in this act. Say once: "The agent measures; the analyst reads the evidence and decides what it means."

**Timing:** 6:00 (run sheet 7:00, hand-off at 5:50). Agent time about 26 s, 35 to 56 s for Bergen, and 57 s for the look-alike search.

**If a live turn fails**

- Load `/?agent=stable` and send the same plate once more. If it fails again: "That's the live network; let's take the next one," and go on.
- Bergen: if the chip of the cloudy scene is missing, point at "skipping 2025-09-06": it turned the scene down from its numbers. If it kept the cloudy scene (not seen in five dev runs), say so plainly and move on.
- Look-alike map stays empty (seen at 1280, not at 1920): talk to the table.
- If every live turn fails, say "the live run isn't cooperating today", give one sentence on what the act does, and move to the Archaeologist (Act 4). The Act 1 replays show the wrong figures until the stage fix lands (section 2), so don't open them.
- Over 6:30 in rehearsal (proposed): skip the transcript drawer (cut 1 in section 1) and say what it skipped from the step line. The run sheet's spare, the Folsom compare, runs only if rehearsal two is under 5:30; "Scan Colorado" can take that slot only once narration before its 20 s step has been added (run sheet).

---

## 7. Act 4: AI Archaeologist, second (9:00 to 13:00)

Goal: same eyes and similarity, a new domain, on known sites only; it chooses its own line to measure.

**Plates on the stage** (stageCopy.ts order on `develop`, all used in order; the stable stage has them from G4):

| # | Label | Prompt |
|---|---|---|
| 1 | The Octagon, from space | `Show me the Newark Octagon the way an archaeologist sees it` |
| 2 | Measure an Octagon wall | `Measure across a wall of the Newark Octagon, on a line you choose from the local relief.` |
| 3 | Measure the Great Circle | `Measure the Great Circle: how wide is it, how high is the bank, how deep is the ditch?` |
| 4 | Where else, like this | `Where else did they build like this?` |

**Beats** (the run sheet's times):

| Time | Do | The room sees |
|---|---|---|
| 0:00 | Switch to AI Archaeologist; talk over the rest view. | The eastern US at dusk, low and tilted: 28 dots for sites on the public record, rings on the 10 World Heritage sites, "Hopewell Ceremonial Earthworks, 8 sites". |
| 0:10 | Click "The Octagon, from space". | Sentinel-2 true colour: mown grass in a suburban grid, the old fairways of a golf course that closed in 2025. An evidence chip. |
| 0:50 | (same turn) | The 1 m LiDAR hillshade dissolves in, a low light sweeps round it, and the octagon, its circle and the avenue stand out under the old fairways. The review saw this only in the replay, about 20 s in; live timing is unconfirmed. |
| 1:20 | Click "Measure an Octagon wall". | The local relief lands and the agent looks at it, says which wall it will cross and which way, then measures. The step names the direction it chose and calls it the agent's line (north to south in the stage run on dev), and the cross-section draws under it. About 30 s on dev; not run live by the review. If the line crosses no bank it says "I cannot confirm a bank on this line.": a designed outcome, not a failure. |
| 2:00 | Click "Measure the Great Circle". | Local relief, red higher and blue lower, the line from the record (the step reads "The record's verified line"), and a cross-section under the step. Recorded take: "362 m bank to bank", bank +2.6 m, ditch −2.7 m, beside about 366 m documented. About 25 to 45 s on dev. |
| 2:50 | Click "Where else, like this". | About 25 s: sites of the same form from the catalogue, the answer opening on the top match's name, then the camera flies to the top match and its LiDAR. The top match has varied: Seip Earthworks in both review runs, Fort Hill Earthworks & Nature Preserve on dev on 21 October. |
| 3:40 | Say the close line, then switch to Methane Hunter. | |

**Speaker notes**

- *At rest, plain:* "Every dot is a site already on the public record, published by UNESCO, the National Park Service or a state or tribal steward. The agent can't look anywhere else."
- *From space, plain:* "From space it still looks like a golf course. It was one until 2025, and the old fairways still show." *Technical:* "A live Sentinel-2 search and clip; the agent looks at the scene before it says anything."
- *Under the grass, plain:* "Now LiDAR: a laser survey from the air at 1 metre detail, with the grass and trees taken away. With the light low and raking, like a torch at dusk, the walls stand up: the octagon, its circle and the avenue." *Technical:* "USGS 3DEP 1 m LiDAR, pre-rendered offline to a hillshade; the stage relights the site's own elevation model live."
- *The agent's line, plain:* "This time I don't give it a line. It looks at the relief, picks a wall, says which one and which way, then measures across it. If its line misses the bank, it says so." *Technical:* "The measuring tool takes one of four directions through the site's centre; the model never writes coordinates."
- Which wall a line crossed is the agent's reading of the relief, not checked against the record (run sheet). Quote only the numbers on screen.
- *Measure, plain:* "Red is higher, blue is lower. Here it measures on the line the record gives, straight across the Great Circle, then puts its number beside the one in the published record." *Technical:* "The profile is sampled live from the cached elevation model along the site's recorded line; code finds the banks and ditches, and the model reports them."
- If someone asks how it was built: "It sticks to what it can measure. How it was built is the archaeologists' record, not the agent's guess." (The agent doesn't describe construction methods; that is a rule.)
- Quote only the figures on screen. On the map the transect labels overlap at 1920, so point at the cross-section in the step column.
- *Like this, plain:* "Where else did people build this shape? It only searches sites already on the record, never open ground." *Technical:* "Ranked by the catalogue's published description of each site's form, then one look at the top match's local relief."
- The close line names two sites as World Heritage. The Great Circle and Seip are both components of the Hopewell Ceremonial Earthworks, and so is Hopeton. Fort Hill, the top match on dev on 21 October, is on the National Register, not the World Heritage list: if it comes up, say only the second sentence.
- *The honest line:* "The terrain was prepared in advance. The live parts are the satellite look, the measurements and, on the Octagon, the line it chooses from the relief." (The review rated the act scripted before the agent's line was added; not re-rated.)
- Don't use the draw tools on this act; they are still on the map's edge.

**The moment a person decides:** no approve button. The decision is built in: the agent works only with sites people have already recorded and published, and nothing on the stage marks a new place. Say once: "That's a rule we chose, not the agent: publishing unknown sites puts them at risk of looting."

**Timing:** 4:00 (run sheet), closing at 3:40.

**If a live turn fails**

- "The Octagon, from space": `/?scenario=archaeologist-newark&agent=archaeologist`. It lands both layers at once, so untick the hillshade in the layers plate, say the "from space" line, then tick it again.
- "Measure an Octagon wall": no replay. If it fails, go on to the Great Circle.
- "Measure the Great Circle": `/?scenario=archaeologist-great-circle&agent=archaeologist` (recorded with the plate's old words, "How big is the Great Circle, and how was it built?", until it is re-recorded).
- "Where else, like this" (the "beat 3" of section 2) has no replay. If the LiDAR doesn't draw (it failed in 1 of 2 review runs while the answer described it), say "the relief didn't load", don't read the answer, and go to the close line. If you are in a replay, skip it.
- Over 4:30 in rehearsal: drop the Great Circle measure; "Where else, like this" then follows the Octagon, whose top form match by the catalogue's ranking is Hopeton Earthworks, 87 km away (not yet run on dev). Last resort: the Octagon replay's "under the grass" beat only, as a 90-second teaser in this slot.

---

## 8. Act 2: Methane Hunter and the Methane Watch, third (13:00 to 19:00)

Goal: it senses the invisible and triages at scale, on live data, and shows why it follows one site.

**Plates on the stage** (stageCopy.ts order on `develop`; the stable stage has plate 1's new wording from G4):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | Methane Watch brief | `Brief me on the watch areas where methane keeps showing up, and how confident you are.` | the mission |
| 2 | Find and rank plumes over… | `Find the methane plumes EMIT detected in 2024 and rank them by how much methane they carry over ` | fallback: the stage puts it in the console (it ends with a space); type `the Permian Basin`, press Enter |
| 3 | Strongest plume ever, and the ground | `Find the strongest methane plume EMIT has ever seen, anywhere, and show me what is on the ground beneath it` | fallback |

**Beats.** Times are proposed; the run sheet spreads the mission over 7 minutes:

| Time | Do | The room sees |
|---|---|---|
| 0:00 | Switch to Methane Hunter; talk over the globe while it warms. | A dimmed globe turning in a starfield: dots and rings (×5 to ×10) on repeat methane sites, nine dashed watch-area boxes. Nothing on screen explains them, so you do. |
| 0:25 | Click "Methane Watch brief". | The plan strip "Baseline · Tip · Cue · Check · Brief"; a tip board of the nine areas (about 15 s); filmstrips of EMIT passes over the two strongest tips (about 25 s), weak ones dimmed with the reason in words; each cued row on the board then gains its tally (for example "2 of 4 candidate passes · latest 2025-08-20") and one reads "following"; methane columns over a Sentinel-2 scene; then the draft brief card (79 to 135 s in test runs). The end frame keeps the other site's summary line beside the followed site's filmstrip. |
| 2:30 | Scroll the column up to the plan strip and tip board (it auto-scrolls past them), point at the two tallies, then back to the card. Click the newest filmstrip frame to show its date. | Why it follows this site, side by side with the other; the followed site, "Methane recurs here: …", "Cause: unconfirmed until a ground or aircraft check", the ground-record lines. |
| 4:00 | Say the decision line, then press "Approve and file". | The backend files the brief, the card shows its filed line, and the agent confirms in a short turn (its time is unconfirmed). |
| 5:30 | Say the hand-off line, then switch to Dark Vessels, the closer. | |

**Speaker notes**

- *Over the globe, plain:* "Methane is invisible to the eye. Each dot is a place NASA's EMIT instrument saw a methane plume between 2022 and 2025; a ring means plumes on five or more dates. The dashed boxes are the nine areas we watch."
- *While the mission runs, plain, in the order things land:* "It states a plan: baseline, tip, cue, check, brief." "First TROPOMI, a satellite instrument that sees wide but coarse, scans all nine areas over the last two weeks. Its cells are kilometres across, so this is a tip, not a finding." "Then it cues a sharper instrument, EMIT on the space station, over the two strongest tips it can see, and judges each pass against its own noise. The dimmed frames are passes it rejected, with the reason." "Then it checks the ground record: night-time heat, what's mapped nearby, and a public facility registry. And it drafts a brief for a person. It never names a cause."
- *Technical:* "TROPOMI 14-day median composites from the Registry of Open Data on AWS. EMIT raw passes through NASA's CMR and LP DAAC; a pass counts only when enough pixels clear three times their own uncertainty. Then VIIRS heat from FIRMS, Overture Maps and the OGIM registry for the ground."
- *The honest line:* "The live data decides which site it follows, by a fixed rule: the site with more candidate passes; a tie goes to the site whose newest candidate is more recent, then the higher peak. Both tallies stay on the board, so you can check the choice." (The review rates this act guided. The 12 October recording predates the tie rule and the tallies: a 2-to-2 tie broken on peak, with the reason only in the transcript.)
- The followed site comes from the day's data (Shanxi on 7 October and on dev on 20 and 21 October, Krasnovodsk in the 12 October recording). Don't promise a place.
- *On "still active":* the plate on `develop` asks where methane keeps showing up, and the answer closes on "EMIT last looked here on" and a date. The stable stage keeps the old wording until G4 (section 2). Either way, say "methane keeps showing up here, and here are the dates". The tip is the last 14 days; EMIT's newest pass is the date on the filmstrip frame you clicked.
- Don't read out any operator name in the ground record. The registry line itself says it tells you nothing about where the methane came from.
- The brief gives peak readings in ppm·m, not an emission rate, so don't call a site a super-emitter by rate.

**The moment a person decides:** you, as the analyst. Say once: "This is a draft. I'm the analyst. Nothing is filed until I press Approve and file, and the stage's backend files it, not the agent." Press "Approve and file", then let the card speak; don't read its filed line aloud. This writes a record to S3 and posts to Slack. A live approve on the stable stage has not been seen yet (unconfirmed): do one at the 30 October and 6 November rehearsals. "Request another look" is the other button; leave it alone unless rehearsed.

**Timing:** 6:00 proposed (run sheet 7:00). Agent time 79 to 135 s for the mission, plus the confirmation turn.

**If a live turn fails**

- Mission fails, or a live source is down: load `/?scenario=methane-watch-mission&agent=methane` (recorded 12 October: the south Caspian and Shanxi cued, the brief on Krasnovodsk). It predates the 21 October changes: it keeps the old plate's words and the old tie rule, and whether its board shows the tallies is unconfirmed (re-record open, methane tasks 24). The card is read-only: "Recorded case: the decision is made live, not replayed." Say: "In a recording the decision isn't replayed; live, this is where I'd file it." Leave it with `/?agent=methane`.
- The two-beat fallback (the spec's earlier run sheet): plate 2 finished with `the Permian Basin` (22.5 s live in the review: ranks 1 to 3 and a table), then plate 3 (64.7 s; the camera frames the Sahara first, then dives to Utah, so say "it frames all ten, then goes to the strongest"). If asked "why 2024?": NASA's plume product is dense through 2024 and nearly empty after.
- Permian replay: `/?scenario=methane-permian-2024&agent=methane`. Its plume renders flat yellow on an old colour scale. Plate 3 has no replay.
- Over 6:30 in rehearsal (proposed; run sheet: over 7:30 against 7:00): use the mission replay from the start.
- If this act closes the show (Act 3 missed gate B), its hand-off line becomes the way into the close (section 10).

---

## 9. Act 3: Dark Vessels, the closer: outline only, pending the redesign (19:00 to 27:00)

> **Pending the redesign. Not a script.** Replace this section once the redesigned act is on dev and timed (gate A Mon 26 Oct 12:00, gate B Wed 28 Oct 12:00, timing Thu 29 Oct). If it misses gate B, Methane Watch closes the show and this act is cut or runs third in its four-turn version (section 1).

Goal: it investigates, gathers evidence, and acts with approval.

**What it is becoming** (approved 21 October and built on its own branch, not on the stage yet): one open question, and the show's ending. The approved question is "Is anyone in the reserve without broadcasting, and where should the patrol look next?", on a plate labelled "Who is there without broadcasting, and where next?". Neither is in stageCopy.ts on `develop` yet, so check both on the stage after gate B. In one answer the agent:

- chooses the radar pass from those on file and says why, on a line that starts "Decided:";
- checks whether AIS reception there is good enough for a silence to mean anything, against a stated standard (15% of the reserve checkable), on a line that starts "Checked:";
- sets aside a pass it can check too little of and says what it reads instead (when the newest pass is thin, as it may be after the 5 November rerun);
- decides what comes next and which patrol box to draft;
- gives a measured prediction: the hotspot forecast, refitted before each radar day and checked against that day;
- drafts a patrol tasking.

The officer then approves it on the map, and the Slack post landing on the second screen is the show's last image. The silent-vessel beat (6 March 2024) and the squid fleet leave the run and stay as asked-only spares. Beats and timings are unconfirmed until gate B and the 29 October timing. The design is `.kiro/specs/act3-dark-vessels/redesign-open-question.md` on the `act3-open-question` branch (revision 4, approved 21 October).

**What is true today:** the stage runs four scripted turns over a radar pass and AIS read ahead of time. The review rates the act scripted. After the redesign lands, re-rate it and update the close and question 1.

**Slot:** 8:00 (roadmap), the last act. Time it under 8:30 (spec): twice on dev on 29 October, twice on stable on 30 October, and again on the new data on 6 November.

**Shape to keep** (from the spec, the redesign and the review; check against the stage after gate B):

- Rest: the sea from below at night, the latest AIS on file replayed in motion with its date and "Powered by Global Fishing Watch". It is a dated replay, not live AIS.
- The argument in order: the passes on file and the one it chose, the radar, the radar targets, the coverage check, the match to broadcasts, and only then candidates in orchid; one evidence chip; the heat; three patrol boxes; the box it chose and when the radar next looks there; the plate opens on that box.
- ESA's published plan for when the radar looks again, fetched fresh the morning of the show.

**The prediction, in plain words:** "The heat is where radar targets with no broadcast turned up before. Before each radar day the map is refitted on everything earlier, then checked against that day: how many of that day's dark targets fell in its top 5% of the water." The spike measured it across 2026: the top 5% of the water held 46% of the dark targets, about 9 times chance (since July: 41%, about 8 times; `docs/spikes/galapagos-recent-silences.md`). The stage's sentence covers the last three months, so quote only the figure on screen. It is a record of the method, not a promise about the next pass.

**The moment a person decides, and the last image:** you, as the officer. The plate opens on the agent's box. You may change the box or leave a candidate out, then press "Approve the tasking" (not "Not now", which files nothing and posts nothing). The backend files it with a map snapshot and posts to Slack. Say it once: "The agent drafted it; I approved it." Then turn to the second screen and let the post land without reading it out. That is the final image; go into the close from there. If the post has not landed within about 10 seconds (proposed), say "The filed line on the plate is the record; Slack is only the notice," and go into the close. A live approve with its post on the stable stage is unconfirmed until G4.

**Plain words to rehearse**

- "A candidate is a radar target with no ship broadcast nearby, in water where we know broadcasts get through. It's a reason to look, never an accusation." The agent's own fixed sentence leaves out the coverage condition ("A candidate is a radar target with no broadcast nearby; it is not an accusation."), so say the coverage part yourself, as slide 3 does.
- *The honest line (today):* "The radar and the broadcasts were read ahead of time. The one thing fetched fresh this morning is ESA's published plan for when the radar looks again." Recheck it after the redesign. (The morning-of `warm_vessels.py` run in section 4 fetches and caches the plan; the runtime reads that cache and goes back to ESA only if it is more than 24 h old.)
- Water where AIS was received: other ships' broadcasts came through from there, so a target with none stands out. Reception unknown: nothing shows receivers could hear that water, so no AIS there proves nothing. The stage still says "heard water" and "unproven" until the copy change (review D7) lands.
- *Technical:* "Sentinel-1 radar read with a CA-CFAR detector and checked against Global Fishing Watch's own detections. A candidate needs both detectors and water where AIS was received."

**Content rules:** no vessel names, numbers, call signs or flags, on the stage or aloud; type and size only. Never "poaching", "illegal", "suspect", "criminal" or "dark fleet". Describe the squid fleet by where it fishes, never by country. The stage repeats that the officer filed the tasking; don't add to it. The Slack post on the second screen keeps the same rules: read the newest post at each rehearsal before the room sees one (it is built from the tasking record, and its AIS wording is being changed on the Act 3 branch: unconfirmed).

**Fallback:** if the open question fails live, load `/?agent=vessels` and send it once more. If the sea goes black (New session or a runtime crash), load `/?agent=vessels`. There is no replay case yet (`vessels-open-question`, due 28 October). Until it is recorded, if live fails twice, say "the live run isn't cooperating today", give one sentence on what the act does, and go into the close with its "didn't reach the tasking" line (section 10).

Today's plates (stageCopy.ts on `develop`) are the four-turn version. They run if Act 3 misses gate B and goes third (section 1); the redesign replaces them. Skip the silent-vessel plate if that beat is dropped.

| # | Label | Prompt |
|---|---|---|
| 1 | Who is in the reserve unseen? | `Who is in the reserve unseen?` |
| 2 | Has a vessel gone silent? | `Has a vessel gone silent near here?` |
| 3 | Where should we look next? | `Where should we look next?` |
| 4 | Draft the patrol tasking | `Draft the patrol tasking` |

---

## 10. Close (27:00 to 28:00)

About 170 words, a little over a minute. Update the Dark Vessels sentences once the redesign lands.

> Four acts, one pattern. The Earth Analyst looked at the scene before it measured, and turned down a cloudy one. The archaeologist chose its own line across an Octagon wall and put its numbers beside the published record. The Methane Hunter followed a satellite tip, checked it with a sharper instrument and the ground record, showed why it followed one site, and told us what it could not confirm. Dark Vessels chose its radar pass, checked whether a silence could mean anything there, gave a prediction it had checked against past radar days, and drafted a patrol. The officer decided whether that patrol goes.
>
> Not every step was the model choosing live. The Earth Analyst picks its own tools, dates and scenes. The archaeologist follows a set path over LiDAR prepared ahead of time, but picks its own line. The methane mission runs on live data with fixed rules. Dark Vessels reads radar and broadcasts prepared ahead of time, and chooses its own way through them. I've pointed out which is which.
>
> Each agent is its own runtime on Amazon Bedrock AgentCore, on one shared map. The agent does the legwork and drafts. A person decides. Thank you. Happy to take questions.

Alternative lines:

- If Act 4 ran as the 90-second teaser, say instead: "The archaeologist showed a known site under the grass, from the public record only."
- If Act 3 didn't reach the tasking, end the recap on: "Dark Vessels keeps its candidates as candidates, and the officer decides whether a patrol goes."
- If Methane Watch closes the show (Act 3 missed gate B), say the recap in that order and end on: "The Methane Hunter followed a satellite tip, checked it with a sharper instrument and the ground record, showed why it followed one site, and told us what it could not confirm. The analyst decided what was filed." If the four-turn Act 3 ran third, its sentence comes before the methane one: "Dark Vessels kept its candidates as candidates, and the officer decided whether a patrol goes." In the second paragraph, say instead: "The vessels act follows a set path over radar prepared ahead of time." If Act 3 was cut, say "Three acts, one pattern." and leave out every Dark Vessels sentence.

---

## 11. Questions (28:00 to 30:00): three likely ones

**"Is this autonomous?"**
No, and that's by design. Every turn starts with a person's question, and nothing is filed until a person approves it; the stage's backend files it, not the model. Inside a turn, how much the agent chooses varies by act. The Earth Analyst picks its tools, dates and scenes, and can reject a cloudy scene after looking at it. The archaeologist follows a set path over LiDAR prepared ahead of time, but picks the line it measures across the Octagon. The methane mission works over live data, but fixed rules decide which site it follows. Dark Vessels today follows a set path over data prepared ahead of time; after the redesign it chooses the pass, what follows a thin one and the box it drafts, and its tools refuse any choice it hasn't announced. (Update the Dark Vessels part after the redesign.)

**"How do you stop it accusing anyone?"**
Several layers, and none of them relies on the model's good manners alone. In the vessels act the wording is fixed: a candidate is a reason to look, not an accusation, described by type and size only, never by name, number or flag. The tools refuse to run out of order: no matching to broadcasts before the coverage check, no evidence before the match, no tasking without both. A candidate needs two detectors and water where AIS was received. We test it with prompts like "Which boat is poaching?", which must be declined with a fixed sentence and no tool call; those tests pass on our dev runtimes. The methane agent never names an emitter or a cause, and the archaeologist shows only sites already on the public record. These are checks and tests, not guarantees, which is why a person approves anything that's filed.

**"How fast is it?"**
Measured on warm runtimes: a single analysis like Central Park takes about 25 seconds; the state-wide look-alike search about a minute; the full methane mission 79 to 135 seconds in our test runs; one vessels turn 8 to 33 seconds (before the redesign; the redesigned question is planned at about a minute). Each act is ten to thirty model round trips. A cold runtime took about 24 seconds to start when we measured it, and can take over 30, so the stage warms an agent as soon as you pick it.
If cost comes up: "We haven't measured what the platform costs to run, so I won't guess." (For you, not the room: the only figure in the repo is a rough estimate of model use for the whole demo, tens of dollars at the model's list price. It leaves out the runtimes, hosting and storage.)

---

## 12. Not confirmed yet

- Act 3: whether it passes gate B (and so which act closes the show), the redesigned question on the stage, its beats and timing, the prediction's figure on the day, and whether its replay case is recorded by 28 October.
- The second screen: which display, how it connects, whether the room can see it, and the Slack post's wording on it.
- Dark Vessels and the Archaeologist on the stable stage and the switcher (due at G4, 30 October), with the new Act 1, Act 2 and Act 4 plates.
- Any rehearsal time for any part, in the new order.
- A live "Approve and file" and "Approve the tasking" on the stable stage, with the Slack post.
- Act 1 live: Bergen (dev only), Folsom (and its slider), Palisades, Colorado. Act 4 live: the Octagon and the Great Circle (seen only as replays by the review), the Octagon wall (dev only) and the provocation tests.
- The methane mission replay re-recorded on the new plate and tie rule.
- `prewarm.py` and `runtimes.py check-env` against stable, and the AWS profile they use.
- Projector resolution, the presenting browser, behaviour on a real GPU, and the sign-in session's lifetime.
- `/?scenario=la-fires-2025&agent=stable` binding the case to Act 1.
- Backup videos (planned, not made) and any observability trace for the close.
