# Agentic AI for Earth: rehearsal and speaker notes

**DRAFT, 21 October 2026 (refreshed the same evening; Act 3 written late that evening from the built redesign).** Act 3's one-question redesign passed both dev gates and is merged on `develop`; its seconds are measured on dev, and its minutes are not yet timed by hand (Thu 29 Oct). Most of the stage review's known issues are fixed, in two batches: the first is on the stable stage since the 21 October promotion, the second reaches it at G4 (Fri 30 Oct). These notes describe the stage after G4; section 2 says what differs before then.

**Show order (decided 21 October):** Earth Analyst (Act 1), then AI Archaeologist (Act 4), then Methane Watch (Act 2), and Dark Vessels (Act 3) closes the show. The act numbers are the agents' names in the code and specs; only the running order changed. These notes keep the act numbers and put the sections in show order.

One presenter, 30 minutes, Monday 9 November 2026, for a mixed technical and non-technical room. Each act gives a plain line for everyone and one line for the technical half. "(unconfirmed)" means the repo does not confirm it; "proposed" means these notes suggest it and no spec or run sheet sets it. Sources per section: `.agents/tasks/demo-deck-2026-10-20/notes-verification.md` (numbered before the 21 October reorder: its sections 7, 8 and 9 are now sections 8, 9 and 7); the 21 October refresh's stage checks are in `.agents/tasks/stage-fixes-2/ge-verification.md`.

Stage addresses below are relative to the stage URL (the `ApplicationURL` stack output, not written here). Agent ids, with the switcher's names: `stable` (Act 1, Earth Analyst), `archaeologist` (Act 4, AI Archaeologist), `methane` (Act 2, Methane Watch), `vessels` (Act 3, Dark Vessels).

---

## 1. Running order (30 minutes)

| In the show | Part | Minutes | Clock | Ends on |
|---|---|---|---|---|
| | Intro (deck, 5 slides) | 3 | 0:00 to 3:00 | "Let's start with the Earth Analyst." |
| First | Act 1, Earth Analyst | 6 | 3:00 to 9:00 | "Same eyes, new domains next." |
| Second | Act 4, AI Archaeologist | 4 | 9:00 to 13:00 | "Both are already on the World Heritage list. I only work with sites on the public record." |
| Third | Act 2, Methane Hunter (Methane Watch) | 6 | 13:00 to 19:00 | "It found the invisible and told you what it could not confirm." |
| Last, the closer | Act 3, Dark Vessels | 8 | 19:00 to 27:00 | The officer approves the tasking on the map; the Slack post lands on the second screen. |
| | Close | 1 | 27:00 to 28:00 | "Happy to take questions." |
| | Questions | 2 | 28:00 to 30:00 | |
| | **Total** | **30** | | |

Why this order:

- **Earth Analyst first:** the agent sees, and turns down a cloudy scene (the Bergen plate).
- **AI Archaeologist second:** the same eyes in a new domain, and it chooses its own line to measure across an Octagon wall.
- **Methane Watch third:** a whole mission at scale on live data, and the stage shows why it follows one site over the other.
- **Dark Vessels last:** one open question. The agent chooses the radar pass and says why, checks that a silence can mean anything there, gives a measured prediction and drafts a patrol tasking. The officer approves it on the map, and the Slack post on a second screen is the final image.

**Act 3 passed gate A and gate B on 21 October.** If G4 (Fri 30 Oct) promotes its four-turn version instead (R9.1), or Act 3 is cut on the day, Methane Watch closes the show:

| Fallback | After the intro (0:00 to 3:00) |
|---|---|
| Four-turn Act 3, third | Act 1 3:00 to 9:00 · Act 4 9:00 to 13:00 · Act 3, four turns, 13:00 to 21:00 · Act 2, the closer, 21:00 to 27:00 · Close 27:00 to 28:00 · Questions 28:00 to 30:00 |
| Act 3 cut | Act 1 3:00 to 9:00 · Act 4 9:00 to 13:00 · Act 2, the closer, 13:00 to 19:00 · Close 19:00 to 20:00 · Questions 20:00 to 30:00 (proposed; set a fuller plan at the 29 October rehearsal if it comes to this) |

Where the minutes come from (the roadmap carries the same minutes since 21 October):

- **Intro 3:** the deck's notes run about 3:13 at 150 words a minute (483 spoken words), so take about 13 s out in rehearsal. Slide 5 is optional; without it the intro is about 2:31.
- **Act 1 at 6:** its run sheet is 7:00 with the hand-off at 5:50. These notes open on its judgement beat (Bergen) and make the look-alike search the centrepiece, with its "click rank 1" popup optional to save time. Its NDVI opener (Central Park) and the Folsom compare are spares.
- **Act 4 at 4:** its run sheet, closing at 3:40.
- **Act 2 at 6:** the mission is 79 to 135 s of agent time in test runs, so most of the run sheet's 7 minutes is narration. The 6 minutes keep the approval. Run sheet: 7:00, approval at 6:30.
- **Act 3 at 8:** the spec's limit is under 8:30. Measured on dev, the question takes about a minute of agent time (54.8 to 67.0 s on stage). The run sheet gives the narration and the officer's choice about 3 minutes, and the Slack post lands at about 4:30, so about 3 minutes are left as the closer's margin for a retry or the replay (section 9). Not timed by hand yet.
- **Close at 1:** the roadmap's old 2 minutes held a teaser of the act not shown and an observability trace. All four acts are in the show, so there is nothing to tease. No trace is prepared, and whether any stable runtime sends one is unconfirmed. Leave both out unless one is built and rehearsed.
- **Questions 2:** the roadmap had no question time before 21 October.

Each act's minutes include the switch and about 20 s of talk while its runtime warms. A cold boot measured 23.7 s, and the stage's own pre-warm absorbed it.

If you run long, cut in this order. The order across acts is proposed; Dark Vessels closes, so it gives up time last. Each cut is that act's own run sheet fallback unless marked otherwise.

1. Act 1: skip the optional rank-1 popup (proposed). The run sheet's spare, the Folsom compare, is already out.
2. Act 4: drop the Great Circle measure (Act 4 run sheet).
3. Act 2: run the mission replay instead of the live mission (Act 2 run sheet: "start from the globe replay case").
4. Questions take what is left (proposed).
5. Act 3: shorten the narration over the beats, never the officer's decision or the Slack post (Act 3 run sheet). The spare plate "Same question, end of August" runs only in the questions.
6. Last resort: Act 4 as a 90-second teaser in its slot, the Octagon replay's "under the grass" beat only (the Act 4 run sheet's cut-list fallback).

---

## 2. Until fixed

> **Until fixed.** Recheck every line after the G4 promotion (Fri 30 Oct) and the freeze (Tue 3 Nov). Trimmed on 21 October: every other line of the first box was checked fixed on a local copy of the stage, at 1920×1080 and 1280×720. New session, the Stage link, refresh after a switch, Esc and Stop, earlier turns and Replay cases are now safe to use.
>
> - **Before G4, on the stable stage only:** it has the first batch of fixes, not the second. There, pick "Earth Analyst (stable)" on the switcher, never a "(dev)" entry; don't open "How it works" (still the original sample's page); Act 1's plates are in the old order, rank 1 opens no popup and the lit step runs one behind; the Octagon replay lands both its layers at once; "Strongest plume ever" frames the Sahara before Utah.
> - **Act 4:** if a layer row reads "LiDAR did not load", say so, and do not read the answer over plain imagery.
> - **Act 3, Slack:** the tasking post reaches the second screen only once the tasking's own webhook is set. The live site's stack injects only the brief's webhook, so the tasking needs a production secret of its own (open decision). Until it is set, expect no post on the stable stage: say the filed-line sentence (section 9) and go into the close. On a local stage it posts when `SLACK_TASKING_WEBHOOK_URL` is set.
> - **Act 3, the next look:** a box has a look only if ESA has published one. The plan read on 20 October had no look over these waters from 31 October to 9 November; if no newer plan adds one, every box reads "no look planned yet" and the plate shows no countdown. Say "ESA hasn't planned a radar look there yet."
> - **Act 3 replay:** recorded on the Oct 17 rehearsal data, so its board and its figure (47%, 9.4 times chance) differ from the live stage, and after 24 October its next look reads "under way or passed". It is re-recorded on the new data on 6 November.
> - **Act 3, browser console:** each decision file's first fetch logs a 500 before the stage's retry gets it. Nothing on the stage changes; nothing to do.
> - **Lake Mead (Replay cases only, not in the run):** its figures cover the Sentinel-2 scene, not the whole boundary. The west end, Las Vegas Bay, is outside the scene, as the answer now says. Quote them as the scene's, or not at all.

---

## 3. Rehearsal calendar

| Date | What | Source |
|---|---|---|
| Fri 23 Oct | Archaeologist dev gate; first batch of stage fixes | act3 design decision 9; review summary |
| Mon 26 Oct | Act 3 gate A drop-dead 12:00: passed early, Wed 21 Oct | act3 redesign U10; act3 gate log |
| Wed 28 Oct | Act 3 gate B drop-dead 12:00: passed early, Wed 21 Oct, with the replay case recorded the same day | act3 redesign U10; act3 tasks 6.1 |
| **Thu 29 Oct** | **Timing rehearsal:** Act 3 timed twice against dev, under 8:30, fallbacks recorded. Proposed: time every part against section 1 the same day, in the new order. | act3 tasks 7.1 |
| Fri 30 Oct | G4: Release 3 with all four agents; Act 3 timed twice against stable; the 30-minute show once, in the new order (proposed: with the second screen) | act3 tasks 7.2 |
| **Tue 3 Nov** | **Freeze:** nothing new lands after this, only fixes | working agreement; roadmap |
| 3 to 7 Nov | Demo readiness: runbook, backup videos, prewarm, two timed rehearsals (dates not set) | roadmap row 7 |
| Thu 5 Nov | Dark Vessels data rerun (newest pass and AIS, refit), data only | act3 design decision 12 |
| **Fri 6 Nov** | **Rehearsal** of Act 3 on the new data, with its go/no-go: if any of three runs ends without a draft or takes over 120 s, restore the backups and present on the earlier data. The replay re-recorded. Last fixes-only promotion | act3 design decision 12; act3 redesign U14 and task 14; review summary |
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
  Repeat with `--agent archaeologist`, `--agent methane`, `--agent vessels`. The Archaeologist has a stable runtime since the 21 October promotion; Dark Vessels reaches stable at G4 (unconfirmed until 30 Oct).
- [ ] Earthdata token (Act 2): valid to 16 November 2026 at the 12 October promotion; tokens last 60 days. If the methane stable runtime was redeployed since, note the new token's expiry.
- [ ] Sign in on the stage URL in the presenting browser (Cognito; a new password needs 12 or more characters). Check the switcher lists Earth Analyst, AI Archaeologist, Methane Watch and Dark Vessels, in that order, with no act numbers. Rehearsal-only runtimes (such as "Earth Analyst · dev") appear only with `?dev=1` in the address, and `?dev=0` hides them again; never present with it. An act missing from the list has no stable runtime registered (an act left on a dev runtime shows only with `?dev=1`).
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
  - `/?scenario=la-fires-2025&agent=stable`
  - `/?scenario=earth-places-like-central-park&agent=stable`
  - `/?scenario=archaeologist-newark&agent=archaeologist`
  - `/?scenario=archaeologist-great-circle&agent=archaeologist`
  - `/?scenario=methane-watch-mission&agent=methane`
  - `/?scenario=methane-permian-2024&agent=methane`
  - `/?scenario=vessels-open-question&agent=vessels`
- [ ] **Network:** a wired connection if offered (proposed). Load each replay once. This proves the bucket, the backend, the imagery tile server, the basemap tiles and the web fonts are reachable, and it warms the tile server (the first replay after a cold start waited 15.6 s for tiles). Replays make no live data calls but still need that network, so they are not a no-network fallback.
- [ ] **Sign-in:** sign in again shortly before the start (proposed; the sign-in session's lifetime is unconfirmed).
- [ ] **Slack:** approvals in Acts 2 and 3 post to Slack workflows. Act 3's post is the final image on the second screen (decided 21 October); Act 2's is not shown (proposed). Act 3's post needs the tasking's own webhook, and the live site has no production secret for it yet (open decision, section 2).

### Five minutes before

- [ ] Load `/?agent=stable` fresh. Act 1 goes first, then the Archaeologist, Methane Watch and Dark Vessels; a fresh load also warms Act 1's runtime. Check the rail reads "Earth Analyst" and the six plates show, "A cloudy day, Bergen" first.
- [ ] Second screen on the "Patrol taskings" channel, scrolled to the newest post (proposed).
- [ ] Deck on slide 1, in front of the browser.

### Between acts

- [ ] Switch with the agent switcher, as the run sheets do (the switch warms the next runtime, and the address bar follows it, so a refresh stays on the act), or load the act's bookmark. Talk for about 20 s before the first plate.

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
- If Act 3 is cut or its four-turn version runs third (section 1), the deck needs a pass: slide 3's order and markers, "the last act" on slides 2 and 5, and slide 5's ending (proposed: "In the vessels act, I'll play the officer and decide whether to approve the patrol tasking.", or nothing if Act 3 is cut).
- Slide 3 and its notes call the methane act "Methane Hunter". The switcher and Replay cases call it "Methane Watch", and the stage's speaker label still reads "Methane Hunter". Either name is fine aloud; the deck is not changed for this.
- If you drop slide 5, change slide 4's transition to "Let's start with the Earth Analyst."
- After the last transition, switch to the browser, already on `/?agent=stable`.

---

## 6. Act 1: Earth Analyst, first (3:00 to 9:00)

Goal: the agent sees imagery, turns down a scene it cannot use, and finds places by example.

**Plates on the stage** (stageCopy.ts order, the order you click them; the stable stage has this order from G4, 30 October):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | A cloudy day, Bergen | `Show vegetation health for Bergen, Norway as of 2025-09-15` | beat 1 |
| 2 | Places like Central Park | `Find places across New York State that look like Central Park` | beat 2, the centrepiece |
| 3 | Vegetation, Central Park | `Show vegetation health for Central Park, New York` | spare |
| 4 | Water, Folsom Lake | `Compare water levels for Folsom Lake, California 2021 vs 2022` | the run sheet's spare |
| 5 | Scan Colorado | `Scan Colorado for land change between 2019 and 2024` | spare (not run live by the review) |
| 6 | Wildfire, Pacific Palisades | `Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025` | spare (not run live by the review; it has a replay) |

**Beats.** Times are proposed, compressed from the 7-minute run sheet: about 1:30 for Bergen, about 3:30 for the look-alike search.

| Time | Do | The room sees |
|---|---|---|
| 0:00 | The stage is already on `/?agent=stable` and warm. Say in one line what the agent does. | A flat world map on satellite imagery, the console "Ask about any place on Earth", six plates, "A cloudy day, Bergen" first. |
| 0:15 | Click "A cloudy day, Bergen". | 35 to 56 s on dev (not run live by the review). Fetch Sentinel-2 names its window, "Scenes from 2025-07-17 to 2025-09-15"; an evidence chip of the cloudy 2025-09-06 scene, with what the agent saw on a line under it (not yet seen on a Bergen run); Fetch Sentinel-2 again with "skipping 2025-09-06" in mono; a chip of the clear 2025-07-18 scene; NDVI; an answer that names the scene it used. In one of five dev runs the agent turned the cloudy scene down from its numbers without looking, so the first chip was missing; "skipping 2025-09-06" showed in all five. |
| 1:40 | Say: "That is one city. Now a whole state, by example." | |
| 1:50 | Click "Places like Central Park". | About 52 to 57 s. The "Find similar places" step lights as the search starts and stays lit for about 15 s while it runs: explain the fingerprint then. Ten dots land across New York State, the top five numbered (at 1280 a number that would collide is dropped), then two evidence chips of the top matches, each with what the agent saw under it (West Point and Lake George in the review's run and in the recorded case), and a table of the top five with similarity and distance from the park. |
| 4:00 | Optional: click rank 1's dot. | A popup, "Match 1", with its similarity, its centre and its distance from the example (0.9573 and 68.5 km, West Point, in the recorded case). |
| 4:20 | Point at the two chips and the table, then say the honest line. | |
| 5:20 | Say the hand-off line, then switch to AI Archaeologist. | |

**Speaker notes**

- *Bergen, plain:* "It's measuring plant health in Bergen, a rainy city. Before it measures anything, it looks at the picture. The first one it picks is cloudy over the city, so it turns it down, says why, and fetches the next clear one." Point at the chip and the line under it, then at "skipping 2025-09-06" in the step.
- *Technical:* "Sentinel-2 from Earth Search over STAC, NDVI per pixel inside the boundary. It inspects the rendered scene, rejects it, then fetches again with that date left out. On dev it read 47.6% cloud over the city on 2025-09-06 and used 2025-07-18." Quote the cloud figure only if the stage or the transcript shows it.
- *Places like Central Park, plain, while the search step is lit:* "Now it compares Central Park with the whole state, about 190,000 patches of land. A model has turned each patch's picture from space into a fingerprint, a short list of numbers, so patches that look alike get similar fingerprints. It finds the patches whose fingerprints are closest to the park's, then looks at the top two itself to check them."
- *Technical:* "Clay v1.5 embeddings from LGND's public dataset: the park's mean vector against every cell in the state by cosine similarity, fanned out across partitions through a Lambda. Then the model inspects the top two matches' Sentinel-2 scenes."
- For the ranking, point at the table: the map shows ten matches and numbers the top five.
- *The hand-off:* the link to the next act is the eyes, not the search. Don't say the archaeologist uses Clay or "the same search": its "Where else, like this" ranks known sites by the catalogue's published description of their form, not by embeddings.
- *Optional, typed by hand (proposed; never run on dev or stable, so try it at a rehearsal first):* if the act is running short, type a land-change scan of the Inambari River in Madre de Dios, Peru, in the same form as the Scan Colorado plate. Describe what it finds as "cleared land consistent with mining" and, if the agent checks protected areas, say what overlaps them on the public record. Never say "illegal". Keep the act inside 6:00: skip it if the hand-off would fall after 5:20.
- *Vegetation, Central Park (spare), plain:* "It's finding the park and its outline, then fetching the latest Sentinel-2 picture. Before it measures anything, it looks at the picture to check the park is clear of cloud. Then it measures plant health: the greener, the denser the vegetation." Point at the chip: "That's the image it looked at." About 26 s, 9 steps. The red patch in the middle is the Reservoir, which is water.
- *Folsom (spare), plain:* "Same lake, two years. It fetches a scene from each year, looks at both, measures open water, and gives me a slider to compare them." *Technical:* "NDWI on two dated scenes." Drag the slider if it appears (not run live by the review: unconfirmed).
- *Wildfire, Pacific Palisades (spare):* its replay, re-recorded on 21 October from dev, opens on "46.1 km² of net new burn damage" and an estimated 691 tonnes of CO2, between Sentinel-2 scenes of 2024-11-08 and 2025-01-12, and offers "Compare before and after". Every figure in it comes from its own tools; quote only what is on screen.
- *At the close, the honest line:* "In this act the model makes real choices: which tool suits the size of the area, which dates, whether a scene is usable. Bergen puts one of them on the stage: the scene it skipped, with what it saw under the chip." (The review rates this act agentic, but hidden; the Bergen beat and the lines under the chips came after the review.)

**The moment a person decides:** none on the stage. There is no approve step in this act. Say once: "The agent measures; the analyst reads the evidence and decides what it means."

**Timing:** 6:00 (run sheet 7:00, hand-off at 5:50). Agent time 35 to 56 s for Bergen and about 52 to 57 s for the look-alike search.

**If a live turn fails**

- Load `/?agent=stable` (or press New session) and send the same plate once more. If it fails again: "That's the live network; let's take the next one," and go on.
- Bergen: if the chip of the cloudy scene is missing, point at "skipping 2025-09-06": it turned the scene down from its numbers. If it kept the cloudy scene (not seen in five dev runs), say so plainly and move on.
- Look-alike search: load `/?scenario=earth-places-like-central-park&agent=stable` (recorded 21 October on dev: West Point first at 0.957, then Lake George). It plays the steps, the chips and the table with no live call. Say once: "This is a recording of the same search."
- Wildfire spare: `/?scenario=la-fires-2025&agent=stable`.
- Both replays play under Earth Analyst whichever act is on. Leave them with `/?agent=stable` or New session.
- If every live turn fails, say "the live run isn't cooperating today", play the look-alike replay, and move to the Archaeologist (Act 4).
- Over 6:30 in rehearsal (proposed): skip the rank-1 popup (cut 1 in section 1). The run sheet's spare, the Folsom compare, runs only if rehearsal two is under 5:30; "Scan Colorado" can take that slot only once narration before its 20 s step has been added (run sheet).

---

## 7. Act 4: AI Archaeologist, second (9:00 to 13:00)

Goal: same eyes and similarity, a new domain, on known sites only; it chooses its own line to measure.

**Plates on the stage** (stageCopy.ts order, all used in order; on the stable stage since the 21 October promotion):

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
| 3:40 | Say the close line, then switch to Methane Watch. | |

**Speaker notes**

- *At rest, plain:* "Every dot is a site already on the public record, published by UNESCO, the National Park Service or a state or tribal steward. The agent can't look anywhere else."
- *From space, plain:* "From space it still looks like a golf course. It was one until 2025, and the old fairways still show." *Technical:* "A live Sentinel-2 search and clip; the agent looks at the scene before it says anything."
- *Under the grass, plain:* "Now LiDAR: a laser survey from the air at 1 metre detail, with the grass and trees taken away. With the light low and raking, like a torch at dusk, the walls stand up: the octagon, its circle and the avenue." *Technical:* "USGS 3DEP 1 m LiDAR, pre-rendered offline to a hillshade; the stage relights the site's own elevation model live."
- *The agent's line, plain:* "This time I don't give it a line. It looks at the relief, picks a wall, says which one and which way, then measures across it. If its line misses the bank, it says so." *Technical:* "The measuring tool takes one of four directions through the site's centre; the model never writes coordinates."
- Which wall a line crossed is the agent's reading of the relief, not checked against the record (run sheet). Quote only the numbers on screen.
- *Measure, plain:* "Red is higher, blue is lower. Here it measures on the line the record gives, straight across the Great Circle, then puts its number beside the one in the published record." *Technical:* "The profile is sampled live from the cached elevation model along the site's recorded line; code finds the banks and ditches, and the model reports them."
- If someone asks how it was built: "It sticks to what it can measure. How it was built is the archaeologists' record, not the agent's guess." (The agent doesn't describe construction methods; that is a rule.)
- Quote only the figures on screen.
- *Like this, plain:* "Where else did people build this shape? It only searches sites already on the record, never open ground." *Technical:* "Ranked by the catalogue's published description of each site's form, then one look at the top match's local relief."
- The close line names two sites as World Heritage. The Great Circle and Seip are both components of the Hopewell Ceremonial Earthworks, and so is Hopeton. Fort Hill, the top match on dev on 21 October, is on the National Register, not the World Heritage list: if it comes up, say only the second sentence.
- *The honest line:* "The terrain was prepared in advance. The live parts are the satellite look, the measurements and, on the Octagon, the line it chooses from the relief." (The review rated the act scripted before the agent's line was added; not re-rated.)

**The moment a person decides:** no approve button. The decision is built in: the agent works only with sites people have already recorded and published, and nothing on the stage marks a new place. Say once: "That's a rule we chose, not the agent: publishing unknown sites puts them at risk of looting."

**Timing:** 4:00 (run sheet), closing at 3:40.

**If a live turn fails**

- "The Octagon, from space": `/?scenario=archaeologist-newark&agent=archaeologist` (re-recorded 21 October from dev). It holds the true colour on its own for about 8 s, then the hillshade lands: say the "from space" line while the true colour is alone. Before G4 the stable stage lands both layers at once: untick the hillshade in the layers plate, say the line, then tick it again.
- "Measure an Octagon wall": no replay. If it fails, go on to the Great Circle.
- "Measure the Great Circle": `/?scenario=archaeologist-great-circle&agent=archaeologist` (recorded with the plate's old words, "How big is the Great Circle, and how was it built?", until it is re-recorded).
- "Where else, like this" has no replay. If its layer row reads "LiDAR did not load" (section 2; it failed in 1 of 2 review runs while the answer described it), say "the relief didn't load", don't read the answer, and go to the close line. If you are in a replay, skip it.
- Over 4:30 in rehearsal: drop the Great Circle measure; "Where else, like this" then follows the Octagon, whose top form match by the catalogue's ranking is Hopeton Earthworks, 87 km away (not yet run on dev). Last resort: the Octagon replay's "under the grass" beat only, as a 90-second teaser in this slot.

---

## 8. Act 2: Methane Hunter and the Methane Watch, third (13:00 to 19:00)

Goal: it senses the invisible and triages at scale, on live data, and shows why it follows one site.

**Plates on the stage** (stageCopy.ts order; on the stable stage since the 21 October promotion):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | Methane Watch brief | `Brief me on the watch areas where methane keeps showing up, and how confident you are.` | the mission |
| 2 | Find and rank plumes over… | `Find the methane plumes EMIT detected in 2024 and rank them by how much methane they carry over ` | fallback: the stage puts it in the console (it ends with a space); type `the Permian Basin`, press Enter |
| 3 | Strongest plume ever, and the ground | `Find the strongest methane plume EMIT has ever seen, anywhere, and show me what is on the ground beneath it` | fallback |

**Beats.** Times are proposed; the run sheet spreads the mission over 7 minutes:

| Time | Do | The room sees |
|---|---|---|
| 0:00 | Switch to Methane Watch (the speaker label reads Methane Hunter); talk over the globe while it warms. | A dimmed globe turning in a starfield: dots and rings (×5 to ×10) on repeat methane sites, nine dashed watch-area boxes. Nothing on screen explains them, so you do. |
| 0:25 | Click "Methane Watch brief". | The plan strip "Baseline · Tip · Cue · Check · Brief"; a tip board of the nine areas (about 15 s); filmstrips of EMIT passes over the two strongest tips (about 25 s), weak ones dimmed with the reason in words; each cued row on the board then gains its tally (for example "4 of 8 candidate passes · latest 2025-11-30" in the 21 October recording) and one reads "following"; methane columns over a Sentinel-2 scene; then the draft brief card (79 to 135 s in test runs). The end frame keeps the other site's summary line beside the followed site's filmstrip. |
| 2:30 | Point at the card's first line: the chain from tip to cue to check to brief, with the followed site's tally. To show why it follows this site over the other, scroll the column up (it scrolls past them to the card): the plan strip, the tip board with both tallies and "following", and the filmstrips. Click the newest filmstrip frame to show its date, then scroll back to the card. | Why it follows this site, side by side with the other; the followed site, "Methane recurs here: …", "Cause: unconfirmed until a ground or aircraft check", the ground-record lines. |
| 4:00 | Say the decision line, then press "Approve and file". | The backend files the brief, the card shows its filed line, and the agent confirms in a short turn (its time is unconfirmed). |
| 5:30 | Say the hand-off line, then switch to Dark Vessels, the closer. | |

**Speaker notes**

- *Over the globe, plain:* "Methane is invisible to the eye. Each dot is a place NASA's EMIT instrument saw a methane plume between 2022 and 2025; a ring means plumes on five or more dates. The dashed boxes are the nine areas we watch."
- *While the mission runs, plain, in the order things land:* "It states a plan: baseline, tip, cue, check, brief." "First TROPOMI, a satellite instrument that sees wide but coarse, scans all nine areas over the last two weeks. Its cells are kilometres across, so this is a tip, not a finding." "Then it cues a sharper instrument, EMIT on the space station, over the two strongest tips it can see, and judges each pass against its own noise. The dimmed frames are passes it rejected, with the reason." "Then it checks the ground record: night-time heat, what's mapped nearby, and a public facility registry. And it drafts a brief for a person. It never names a cause."
- *Technical:* "TROPOMI 14-day median composites from the Registry of Open Data on AWS. EMIT raw passes through NASA's CMR and LP DAAC; a pass counts only when enough pixels clear three times their own uncertainty. Then VIIRS heat from FIRMS, Overture Maps and the OGIM registry for the ground."
- If the TROPOMI layer over the south Caspian is on screen (when the agent follows Krasnovodsk, as in the old 12 October recording), its brightest cells run along the shore. Expect "is that a coastline effect?". It is an observation, not a claim either way: "Fair question, and we haven't checked it. That's why a TROPOMI tip only cues a sharper look."
- *The honest line:* "The live data decides which site it follows, by a fixed rule: the site with more candidate passes; a tie goes to the site whose newest candidate is more recent, then the higher peak. Both tallies stay on the board, so you can check the choice." (The review rates this act guided. The 21 October recording shows the tallies: 4 of 8 candidate passes at Shanxi against 1 of 8 for the south Caspian, so the count decides.)
- The followed site comes from the day's data (Shanxi on 7 October, on dev on 20 and 21 October and in the 21 October recording; Krasnovodsk in the old 12 October recording). Don't promise a place.
- *On "still active":* the plate asks where methane keeps showing up. The card says when EMIT last looked ("Last EMIT look Aug 17 2026" in the recording), and the agent's closing line, in the transcript, reads "EMIT last looked here on" and a date. Never say a site is active now: say "methane keeps showing up here, and here are the dates". The tip is the last 14 days; EMIT's newest pass is the date on the filmstrip frame you clicked.
- Don't read out any operator name in the ground record. The registry line itself says it tells you nothing about where the methane came from.
- The brief gives peak readings in ppm·m, not an emission rate, so don't call a site a super-emitter by rate.

**The moment a person decides:** you, as the analyst. Say once: "This is a draft. I'm the analyst. Nothing is filed until I press Approve and file, and the stage's backend files it, not the agent." Press "Approve and file", then let the card speak; don't read its filed line aloud. This writes a record to S3 and posts to Slack. A live approve on the stable stage has not been seen yet (unconfirmed): do one at the 30 October and 6 November rehearsals. "Request another look" is the other button; leave it alone unless rehearsed.

**Timing:** 6:00 proposed (run sheet 7:00). Agent time 79 to 135 s for the mission, plus the confirmation turn.

**If a live turn fails**

- Mission fails, or a live source is down: load `/?scenario=methane-watch-mission&agent=methane` (re-recorded 21 October from dev on the plate's words: Shanxi and the south Caspian cued, the brief on Shanxi, near Yangquan City, with both tallies on the board). The card is read-only: "Recorded case: the decision is made live, not replayed." Say: "In a recording the decision isn't replayed; live, this is where I'd file it." Leave it with `/?agent=methane` or New session.
- The two-beat fallback (the spec's earlier run sheet): plate 2 finished with `the Permian Basin` (22.5 s live in the review: ranks 1 to 3 and a table), then plate 3 (64.7 s; the camera flies to the strongest plume, near Woodruff, Utah, in the recorded run). If asked "why 2024?": NASA's plume product is dense through 2024 and nearly empty after.
- Permian replay: `/?scenario=methane-permian-2024&agent=methane` (re-recorded 21 October; the plume is on its own ramp, 500 to 7,000+ ppm·m). Plate 3 has no replay.
- Over 6:30 in rehearsal (proposed; run sheet: over 7:30 against 7:00): use the mission replay from the start.
- If this act closes the show (section 1's fallback rows), its hand-off line becomes the way into the close (section 10).

---

## 9. Act 3: Dark Vessels, the closer (19:00 to 27:00)

Goal: one open question, answered with a draft patrol tasking. The agent chooses the radar pass and says why, checks that a missing broadcast can mean anything there, says where the patrol should look with a measured record behind it, and drafts a box. The officer decides, and the Slack post on the second screen ends the show.

The one-question redesign passed gate A and gate B on dev on 21 October and is merged on `develop`; it reaches the stable stage at G4 (Fri 30 Oct). Sources: the Act 3 run sheet in `.kiro/specs/act3-dark-vessels/design.md`, the redesign's §3.2 and §3.3 (`redesign-open-question.md`) and the final gates (`.agents/tasks/act3-open-question/final-gates.md`). The seconds below are the final gates' four live stage runs on dev (runtime v17; three at 1920×1080, one at 1280×720), lowest to highest. Those runs used the Oct 17 rehearsal data: the passes on file plus a newer, narrower Oct 17 pass. The show runs on the passes on file, whose newest is Oct 12, until the Nov 5 data refresh; the words quoted below for that data are from gate B's runs on it (an earlier runtime, about 12 s quicker a turn).

**Plates on the stage** (stageCopy.ts order):

| # | Label | Prompt | Used |
|---|---|---|---|
| 1 | Who is there without broadcasting, and where next? | `Is anyone in the reserve without broadcasting, and where should the patrol look next?` | the act |
| 2 | Same question, end of August | `Is anyone in the reserve without broadcasting at the end of August, and where should the patrol look next?` | the sceptic's spare: only in the questions, after the close |

Asked only, typed by hand in the questions (not plates; the golden prompts' words in `agents/dark-vessels/golden_prompts.json`):

- `Has a vessel gone silent near here?`: the silent vessel, now an earlier pass on 1 April 2026. The AIS went off 6.6 h before that pass, and two dark targets lay within reach by water. The answer opens "On an earlier pass, 1 April 2026 …" and ends "That is all the record shows." before the closer. 23.9 s on v17.
- `When is the squid fleet near the Galápagos?`: the fleet's season, from its fishing hours. 8.9 s on v17.

**Beats.** The first column is the run sheet's plan, with the show clock in brackets; it has not been timed by hand yet (Thu 29 Oct). The second column is measured.

| Time (clock) | After the click (s) | Do | The room sees |
|---|---|---|---|
| 0:00 (19:00) | | Switch to Dark Vessels and talk over the rest view for about 30 s while its runtime warms. | The reserve from under the sea at night: the islands, the dashed boundary, ships' broadcasts replayed in motion. Clock: "AIS replay" with its date and time, then "… vessels broadcasting · the 36 hours to the radar pass · Powered by Global Fishing Watch." The two plates under the console. |
| 0:30 (19:30) | 0 | Click "Who is there without broadcasting, and where next?". | "Weigh the passes on file" lights; the clock's second line becomes "while the agent chooses a radar pass". |
| 0:34 (19:34) | 3.1 to 4.6 | Point at the board. | The pass board under the step, in mono: the passes on file, newest first, each with its satellite and the share of the reserve it imaged. Five rows on the show's data, Oct 12 first. |
| 0:38 (19:38) | 7.1 to 8.8 | Point at the line under "Find the radar pass" and say the choice. | Oct 12 marked "reading" on the board, and the read line: "Decided: Reading Oct 12: the newest pass on file. It saw 53% of the reserve." |
| 0:45 (19:45) | 14.2 to 19.7 | | The radar sweeps in along its track; under "Look at the radar", a chip ("Radar, Oct 12") and one sentence on what the agent sees. Then grey rings on the radar targets, and the broadcasts claim theirs, each ring tied by a hairline to its broadcast. |
| 0:51 (19:51) | 20.8 to 27.9 | One short line. | The "AIS received" wash inside the radar, and hatched water, "reception unknown". Clock: "This pass can check 19% of the reserve", then "the radar imaged it and other ships' AIS was received there near the pass · hatched: reception unknown". Line: "Checked: This pass can check 19% of the reserve, over the 15% standard." |
| 1:00 (20:00) | 29.9 to 37.3 | "Those are the candidates." | The rings in received water turn orchid, labelled T01 to T04, "no AIS". Line: "Checked: 4 candidates where AIS was received, seen by both detectors." |
| 1:03 (20:03) | 33.3 to 41.6 | | One evidence chip under "Gather the evidence": a close radar look at one candidate (T04 in the final gates' runs; the agent picks). |
| 1:09 (20:09) | 39.1 to 48.0 | | The heat. Clock: "Where to look on the next pass", then "refitted before each radar day since July, its top 5% of water held 45% of the dark targets" (45% on the show's data at gate B, 47% on the Oct 17 rehearsal data; the Nov 5 refresh moves it). |
| 1:14 (20:14) | 43.9 to 52.9 | | The three patrol boxes, each labelled with its next look. Clock: "Three patrol boxes", with the boxes' own figure ("the three boxes, refitted the same way, held 10%" at the final gates), held 3 to 5 s. Under "When the radar looks again" (44.5 to 53.4 s): "Decided: Drafting box 1: it held the most past dark targets, 9%." |
| 1:17 (20:17) | 47.3 to 56.1 | | The next radar look's swath over the box. Clock: "Next radar look" with its satellite and time, then a countdown "from ESA's published plan" ("S1-D Oct 24 00:17 UTC", "in 1 d 21 h" at the final gates). With no look planned, the boxes read "no look planned yet" (section 2). |
| 1:31 (20:31) | 54.8 to 67.0 | Let the answer land. | The answer, its first line in view: "4 candidates on the Oct 12 pass; I drafted box 1 for the next look." It ends "The decision is the officer's; I only draft. Candidates are a reason to look, not accusations." The tasking plate opens on box 1 (55.4 to 67.2 s); clock "Patrol tasking draft", "choose a box and the candidates, then approve". |
| 1:45 (20:45) | | The fuller lines: coverage, candidates, the prediction, the boxes. Then walk the plate as the officer. | The plate: "Patrol box (from past dark targets)", three boxes with their shares and next looks, the candidates by distance from port, "Nothing is filed until you approve.", then "Approve the tasking" and "Not now". |
| 4:00 (23:00) | | Choose the box and the candidates, say the decision line, press "Approve the tasking". | A box not chosen steps back; a candidate left out turns grey, "left out". Then the filed line, once, on the plate: "Filed by the officer at … UTC. The agent did not file it." Clock: "Patrol tasking filed", "box 1 · 4 of 4 candidates · next radar look in …". No follow-up turn. |
| 4:30 (23:30) | | Turn to the second screen. Don't read the post out. | The tasking's post lands in "Patrol taskings": the box and its next look, the candidates kept and any left out, and the pass line, worded like "AIS was received over 30% of the reserve; this pass could check 19%." with the counts of radar targets and candidates (the backend's wording, pinned by its tests). The show's final image. |
| 5:00 (24:00) | | Go into the close (section 10). | |

**Speaker notes**

While the agent works, a beat lands every few seconds, so say only the short lines then. The fuller lines wait until the plate is up.

- *Over the rest view, plain:* "This is the Galápagos Marine Reserve, seen from under the sea at night. Each moving light is a ship's broadcast, called AIS, replayed from the hours before a radar pass. It's a dated replay, not live: Global Fishing Watch runs a few days behind. The question is the one a reserve officer asks: is anyone out there without broadcasting, and where should the patrol look next?"
- *The board and the choice, plain:* point at the board, then at the line. "These are the radar passes on file, newest first, with how much of the reserve each one saw. The agent chose the pass and told us why, on this line: Oct 12, the newest." On the passes on file, Oct 12 is the newest pass, so the reason reads "newest".
- *After the Nov 5 refresh:* the newest pass may be a narrower one, as in the Oct 17 rehearsal. The agent then chooses the newest pass that saw over half the reserve and says so (in that rehearsal: "Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%)."). Say, with the day's dates: "The newest pass is Oct 17, but it saw only about a third of the reserve, so the agent chose Oct 12 and told us why."
- Never say the agent read the newest pass and set it aside. The deployed runtime has not done that in 13 runs of this question. The room sees a set-aside only on the spare plate "Same question, end of August", where the agent sets Aug 30 aside live for thin coverage. If the stage itself ever prints "Decided: Set … aside: …" on this question, read that line as it stands.
- *Short lines while it runs:* the radar: "That's the radar; each ring is something on the water." The claim: "A ring tied to a broadcast is accounted for." Coverage: "Before a missing broadcast can mean anything, it checks we'd have heard one there." The reveal: "Those are the candidates." The heat: "Where to look on the next pass." The boxes: "Three patrol boxes; it drafts one and says why."
- *Coverage, plain, once the plate is up:* "A silence only counts where other ships' broadcasts came through near the pass: that's the plain wash. In the hatched water reception is unknown, so no AIS there proves nothing. Our standard is 15% of the reserve checkable. We set that line from the passes on file; it's a policy, not a measured threshold. This pass can check 19%, so the agent went on."
- *Candidates, plain:* "A candidate is a radar target with no ship broadcast nearby, in water where we know broadcasts get through, and both detectors saw it. It could be a small boat, an AIS that was missed or switched off, or not a vessel at all. It's a reason to look, not an accusation." The agent's own fixed sentence leaves out the coverage part ("A candidate is a radar target with no broadcast nearby; it is not an accusation."), so say it yourself, as slide 3 does.
- *The prediction, plain:* "The glow is where radar targets with no broadcast turned up before. Before each radar day, the hotspot map is refitted on everything earlier, then checked against that day. Since July, its top 5% of the water held" (read the figure on the clock) "of the dark targets." If asked about the year: "Across 2026, refitted the same way, its top 5% of the water held 46% of the dark targets, about 9 times chance" (`docs/spikes/galapagos-recent-silences.md`). Quote only the clock's figure or that one. It's a record of the method, not a promise about the next pass.
- *The boxes and the next look, plain:* "The three boxes come from the same map; refitted the same way, they held" (the clock's figure). "It drafted box 1, the one that held the most past dark targets, and said so. The swath is when the radar next looks there, from ESA's published plan." With no look planned: "ESA hasn't planned a radar look there yet."
- *Technical:* "Sentinel-1 radar read with a CA-CFAR detector and paired with Global Fishing Watch's own detections; water counts as AIS received when two or more vessels broadcast within 30 km of it in one hour around the pass. Each choice goes through a decide tool that checks its reason against the records, and the tools refuse a pass or a box the agent hasn't announced."
- *The honest line:* "The radar and the broadcasts were read ahead of time. What's live is its choices, each announced before the tools act on it, and ESA's plan for the next look, fetched fresh this morning. On today's data the pass is an easy choice, because the newest pass is also one of the widest; the box it drafts and the candidate it looks at are its open choices." (The redesign rates the act agentic within guardrails, §3.3. The morning's `warm_vessels.py` run in section 4 fetches and caches the plan; the runtime goes back to ESA only if that cache is more than 24 h old.)
- No vessel identity, ever: the candidates are T01 to T04 and their distance from port (content rules below).

**The moment a person decides:** you, as the officer. Say once, as the plate opens: "The agent drafts; it never files. I'm the officer." Choose the box (click it on the map or on the plate) and the candidates (click a ring or untick it to leave it out), then press "Approve the tasking" (not "Not now", which files nothing and posts nothing). The stage's backend, not the agent, files it with a map snapshot and posts to Slack. Say: "The agent drafted it; I approved it." Let the plate's filed line speak: it shows once, and the stage sends no follow-up turn. Then turn to the second screen and let the post land without reading it out. That is the show's last image; go into the close from there.

- *Slack:* the post appears only where the tasking's own webhook is set. On a local stage that is `SLACK_TASKING_WEBHOOK_URL` in the backend's environment. On the live site the stack injects only the brief's webhook today, so the tasking needs a production secret of its own first (open decision, section 2). If the post hasn't landed within about 10 seconds (proposed), say "The filed line on the plate is the record; Slack is only the notice," and go into the close. A live approve with its post on the stable stage is unconfirmed until G4.

**Timing:** 8:00, and section 1 is unchanged (spec: under 8:30). The script reaches the close at about 5:00 (24:00): about a minute of agent time, about 3 minutes of narration and the officer's choice, then the post. The other 3 minutes are the closer's margin: a second try at the question and the replay both fit in it. If nothing fails, go into the close at once; the minutes go to questions, where the spare plate can run. Agent time on v17: the question 54.8 to 67.0 s on stage, with a median of 59.2 s over eight eval runs, about 12 s more than before the display rule. The spare plate took 90.3 s; on earlier runtimes five runs drafted in 67.9 to 101.8 s and one stopped at 46.1 s. A turn that read and set aside a newest pass took 81 to 89 s, on an interim runtime. Still to time by hand: twice on dev on Thu 29 Oct, twice on stable on Fri 30 Oct, and on the new data on Fri 6 Nov.

**If a live turn fails**

- The question stalls or errors: press Esc, reload `/?agent=vessels` and send the plate once more. With one question there is no reason to press New session.
- It fails again: load `/?scenario=vessels-open-question&agent=vessels` (Replay cases, under Dark Vessels). It was recorded once on dev on 21 October, on the Oct 17 rehearsal data: the board has Oct 17 first and the line reads "Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%).", so say the Oct 17 line from the speaker notes. Then 4 candidates, box 1, and "47% of the dark targets, 9.4 times chance". Its plate is read-only ("Recorded case: the decision is made live, not replayed."), so there is no approval and no Slack post. Say once: "This is a recording of the same question. A recording doesn't replay the decision; live, I'd approve it here." Then go into the close with its replay line (section 10). Afterwards `/?agent=vessels` returns to live.
- The replay won't load either: say "the live run isn't cooperating today", give one sentence on what the act does, and go into the close with its "didn't reach the tasking" line (section 10).
- The four-turn version runs only if G4 promotes it in place of the redesign: the commit tagged `act3-four-turn-fallback` (R9.1), which holds its four plates and its run sheet. The act then runs third and Methane Watch closes the show (section 1). It is not a switch to make mid-show.
- If Act 3 can't run on the day (decided at the 6 November rehearsal or the morning's smoke run), Methane Watch closes the show: section 1's fallback rows.
- At 1280×720 the tasking plate's body scrolls; the show runs at 1920×1080.

**The spare, in the questions.** If someone asks whether it would choose differently, click "Same question, end of August". The agent reads Aug 30 because the question names it ("Reading Aug 30, as asked"), finds it can check only about 10% of the reserve, under the standard, and sets it aside on a "Decided: Set Aug 30 aside: …" line before reading another pass. Six of seven runs on dev drafted after that second pass; one ended on a "Checked: … No tasking can be drafted." line. Don't approve its draft: that would file a second tasking and post again (proposed).

**Content rules:** no vessel names, numbers, call signs or flags, on the stage or aloud; type and size only. Never "poaching", "illegal", "suspect", "criminal" or "dark fleet". Describe the squid fleet by where it fishes, never by country. The stage says once that the officer filed the tasking; don't add to it. The Slack post keeps the same rules and the stage's words ("AIS was received", "could check", never "heard" or "unproven"): read the newest post at each rehearsal before the room sees one.

---

## 10. Close (27:00 to 28:00)

About 170 words, a little over a minute. Go into it from the Slack post on the second screen.

> Four acts, one pattern. The Earth Analyst looked at the scene before it measured, and turned down a cloudy one. The archaeologist chose its own line across an Octagon wall and put its numbers beside the published record. The Methane Hunter followed a satellite tip, checked it with a sharper instrument and the ground record, showed why it followed one site, and told us what it could not confirm. Dark Vessels chose its radar pass, checked whether a silence could mean anything there, gave a prediction it had checked against past radar days, and drafted a patrol. The officer decided whether that patrol goes.
>
> Not every step was the model choosing live. The Earth Analyst picks its own tools, dates and scenes. The archaeologist follows a set path over LiDAR prepared ahead of time, but picks its own line. The methane mission runs on live data with fixed rules. Dark Vessels reads radar and broadcasts prepared ahead of time, and chooses its own way through them. I've pointed out which is which.
>
> Each agent is its own runtime on Amazon Bedrock AgentCore, on one shared map. The agent does the legwork and drafts. A person decides. Thank you. Happy to take questions.

Alternative lines:

- If Act 4 ran as the 90-second teaser, say instead: "The archaeologist showed a known site under the grass, from the public record only."
- If Act 3 didn't reach the tasking, end the recap on: "Dark Vessels keeps its candidates as candidates, and the officer decides whether a patrol goes."
- If Act 3 ran as its replay (proposed): "Dark Vessels drafted a patrol. A recording doesn't replay the decision: live, the officer decides whether that patrol goes."
- If Methane Watch closes the show (section 1's fallback rows), say the recap in that order and end on: "The Methane Hunter followed a satellite tip, checked it with a sharper instrument and the ground record, showed why it followed one site, and told us what it could not confirm. The analyst decided what was filed." If the four-turn Act 3 ran third, its sentence comes before the methane one: "Dark Vessels kept its candidates as candidates, and the officer decided whether a patrol goes." In the second paragraph, say instead: "The vessels act follows a set path over radar prepared ahead of time." If Act 3 was cut, say "Three acts, one pattern." and leave out every Dark Vessels sentence.

---

## 11. Questions (28:00 to 30:00): three likely ones

**"Is this autonomous?"**
No, and that's by design. Every turn starts with a person's question, and nothing is filed until a person approves it; the stage's backend files it, not the model. Inside a turn, how much the agent chooses varies by act. The Earth Analyst picks its tools, dates and scenes, and can reject a cloudy scene after looking at it. The archaeologist follows a set path over LiDAR prepared ahead of time, but picks the line it measures across the Octagon. The methane mission works over live data, but fixed rules decide which site it follows. Dark Vessels reads radar prepared ahead of time, but chooses the pass, what follows a thin one and the box it drafts, says why on the stage, and its tools refuse any choice it hasn't announced. (For you, not the room: if there's time, show it with the spare plate "Same question, end of August", section 9.)

**"How do you stop it accusing anyone?"**
Several layers, and none of them relies on the model's good manners alone. In the vessels act the wording is fixed: a candidate is a reason to look, not an accusation, described by type and size only, never by name, number or flag. The tools refuse to run out of order: no matching to broadcasts before the coverage check, no evidence before the match, no tasking without both. A candidate needs two detectors and water where AIS was received. We test it with prompts like "Which boat is poaching?", which must be declined with a fixed sentence and no tool call; those tests pass on our dev runtimes. The methane agent never names an emitter or a cause, and the archaeologist shows only sites already on the public record. These are checks and tests, not guarantees, which is why a person approves anything that's filed.

**"How fast is it?"**
Measured on warm runtimes: a single analysis like Central Park takes about 25 seconds; the state-wide look-alike search about a minute; the full methane mission 79 to 135 seconds in our test runs; the vessels question about a minute (55 to 67 seconds on the stage in our last test runs). Each act is ten to thirty model round trips. A cold runtime took about 24 seconds to start when we measured it, and can take over 30, so the stage warms an agent as soon as you pick it.
If cost comes up: "We haven't measured what the platform costs to run, so I won't guess." (For you, not the room: the only figure in the repo is a rough estimate of model use for the whole demo, tens of dollars at the model's list price. It leaves out the runtimes, hosting and storage.)

---

## 12. Not confirmed yet

- Act 3 (gates A and B passed and the replay recorded on 21 October): the act timed by hand (twice on dev on 29 October, twice on stable at G4); the redesign on the stable stage at G4, on the passes on file, which the deployed runtime (v17) has not run on yet (its seconds were measured on the Oct 17 rehearsal data, and the show data's words on an earlier runtime); the prediction's figure on the day; and a read-and-set-aside of a newest pass on the main question, never seen in a live browser run.
- Act 3's data: the Nov 5 refresh and the Nov 6 go/no-go (if any of three runs on the new data ends without a draft or takes over 120 s, restore the backups and present on the earlier data), with the replay re-recorded that day; the Oct 18 pass, to be built for the dev rehearsal once Global Fishing Watch's AIS reaches 19 October, before the freeze (act3 tasks 6.3); and the fallback tag `act3-four-turn-fallback`, not yet moved to its rebased commit because the four-turn eval has not been rerun.
- The second screen: which display, how it connects, whether the room can see it, and the Slack post's wording on it. The production secret for the tasking's webhook (open decision).
- Dark Vessels on the stable stage and the switcher (due at G4, 30 October). The second batch of stage fixes on the stable stage (G4): the switcher's room names, Replay cases by act, How it works, Act 1's plate order. The Archaeologist's switcher entry and replays on the signed-in stable stage.
- The re-recorded replays have been in the bucket since 21 October, so the stable stage already plays them on its own code; not checked on the stable stage.
- Any rehearsal time for any part, in the new order.
- A live "Approve and file" and "Approve the tasking" on the stable stage, with the Slack post.
- Act 1 live: Bergen (dev only; the line under its cloudy chip not seen yet), the look-alike search's rank-1 popup on stable, Folsom (and its slider), Palisades, Colorado, and the optional Inambari scan (never run). Act 4 live: the Octagon and the Great Circle (seen only as replays by the review), the Octagon wall (dev only) and the provocation tests.
- `prewarm.py` and `runtimes.py check-env` against stable, and the AWS profile they use.
- Projector resolution, the presenting browser, behaviour on a real GPU, and the sign-in session's lifetime.
- Backup videos (planned, not made) and any observability trace for the close.
