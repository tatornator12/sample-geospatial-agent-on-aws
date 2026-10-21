# Act 3 redesign: one open question (requirements, design, tasks)

Status: **revision 4, Oct 21: approved (decisions U1 to U15, §5); implemented on branch
`act3-open-question`.** This document is the source of truth for that branch. It replaces the
four-turn run in `design.md` (the run sheet and component 10's WORKFLOW) once it passes its two dev
gates. If it does not, G4 promotes the commit tagged `act3-four-turn-fallback` (R9.1). The rest of
the Act 3 spec still applies, with requirement 12.5 and decision 12 amended as U10 states. Evidence
log and revision log for revisions 1 to 3: `.agents/tasks/act3-redesign-2026-10-20/design-notes.md`.
Revision 4 records the approved decisions (§5) and applies the twelve findings of the revision 3
review (§7). It redesigns nothing.

## 1. Summary

**The spike's answer (`docs/spikes/galapagos-recent-silences.md`): there is no recent silence to
predict forward from.**
- From Aug 1 to Oct 16, none of the six classified vessels that switched AIS off near the reserve
  had a planned Sentinel-1 look over its last position within 72 h.
- In 12 months there were 2 usable forward cases (0.17 a month), both seen by Sentinel-1A, which
  stopped imaging after June. Since July there have been none.
- The Nov 5 rerun has about an 8% chance of adding one, and any case it finds will already be
  closed.

So the live prediction is the hotspot map, refitted before each radar day and checked against that
day. It stays recent by construction, because the rerun adds the newest passes to both the map and
its check.

**The redesign.** Act 3 becomes one question, answered with a draft patrol tasking:

> Is anyone in the reserve without broadcasting, and where should the patrol look next?

The prompt sets goals, rules, a coverage standard, a budget and stopping conditions, with no tool
order. The agent makes three decisions at runtime:
- which pass to read;
- what follows a pass too thin to check, or one with no candidates (another pass, or the forecast);
- which patrol box to draft.

It announces each one with a new `decide` tool, and the tools will not act on a choice it has not
announced: `detect_vessels`, `check_ais_coverage` and `match_ais` refuse a pass with no accepted
`read_pass`, and `draft_tasking` refuses a box with no accepted `draft`. `decide` checks each
reason against this question's records, and checks `asked` against the presenter's own words. It
writes one file per accepted call. So every choice that reaches the map was announced, and every
reason the stage prints is true.

The coverage judgement is a check against a stated standard: `match_ais` refuses a pass under it,
and the stage labels it "Checked:", not "Decided:". The stage shows a board of the passes on file,
and a line under each step built from enum values and tool numbers. The tools still enforce the
evidence order: pass, detect, coverage, match, then words.

**What is dropped from today's four turns:**
- The four prepared turns become one.
- The silent-vessel beat (Mar 6 2024) and the squid fleet leave the run and become asked-only
  spares.
- The tasking is drafted inside the question, so it has no turn of its own.
- The automatic "Is it filed?" turn goes.
- The filed sentence appears in one place only: the plate's filed line.

## 2. Requirements

### 2.1 Functional (EARS)

**R1. One question**
- R1.1 The stage SHALL offer one prepared prompt for Act 3, worded as decided in U1, and beside it
  the sceptic's spare plate approved in U7.
- R1.2 WHEN the presenter sends the prepared prompt, the agent SHALL answer in one turn. The turn
  SHALL end with a draft patrol tasking on the map, or with the stated reason that no pass it read
  could be checked.
- R1.3 WHEN the presenter asks a question that was not prepared (a named date, a named pass or a
  follow-up), the agent SHALL answer it under the same goals, rules and budget.

**R2. Decisions made at runtime**
- R2.1 WHEN the presenter asks about the reserve, a pass or a date, the agent SHALL call
  `list_passes` first. A provocation (rule 5) SHALL call no tool.
- R2.2 The prompt SHALL NOT name a pass, a date or a box. It SHALL state no tool order except:
  hard rule 2's evidence order, `list_passes` first, `decide` with the call it announces, and
  stopping after `draft_tasking` or `decide(stop)`. A test pins the first sentence.
- R2.3 WHEN the agent chooses a pass, chooses what follows a thin or empty pass, or chooses a box,
  it SHALL call `decide` in the same response as the first call that choice leads to. WHEN it ends
  without a draft, its last tool call SHALL be `decide(stop)`, and the answer SHALL follow it.
- R2.4 IF a `decide` reason is not supported by this question's records, THEN `decide` SHALL
  refuse it, return the facts, and write no file.
- R2.5 `decide` SHALL accept `asked` only WHEN the presenter's words in this turn name that pass
  (§3.5).
- R2.6 WHEN `decide` accepts a call, it SHALL write one file for that call alone (§3.5).
- R2.7 WHEN a pass's checkable share is under the standard, the agent SHALL read another pass on
  file or go to the forecast.
- R2.8 WHEN `match_ais` finds no candidates, the agent SHALL read another pass on file (within the
  budget) or go to the forecast.
- R2.9 A question SHALL be open only during the turn whose `list_passes` opened it. WHILE a
  question is open, `detect_vessels`, `check_ais_coverage` and `match_ais` SHALL refuse a pass with
  no accepted `read_pass` in this question. A later turn that does not call `list_passes` SHALL run
  ungated, as today; R2.1 and the eval cover that turn.
- R2.10 WHILE a question is open, IF two passes have been read in it, THEN `decide` SHALL refuse a
  third `read_pass`, and `find_pass` SHALL refuse any other pass.
- R2.11 WHEN the agent drafts, it SHALL choose the box with one of the four reasons in §3.5. In any
  turn, checked against the session's latest question, `draft_tasking` SHALL refuse:
  - with no accepted `draft` decision in that question;
  - a box other than the one decided;
  - match, coverage or hotspots records from another question.

  In any turn, `match_ais` and `gather_evidence` SHALL likewise refuse a coverage or match record
  from a question other than the session's latest.
- R2.12 WHEN `list_passes` is called again in the same turn, it SHALL keep the question and its
  decisions.

**R3. Hard rules**
- R3.1 The tools SHALL refuse:
  - `match_ais` before `check_ais_coverage` (`ais_tools.py:126-127`);
  - `match_ais` on a pass whose coverage record is under the standard (new);
  - `gather_evidence` before `match_ais` (`ais_tools.py:189-193`);
  - `draft_tasking` without its records (`tasking_tools.py:54-60`).
- R3.2 The agent SHALL use passes on file only. It SHALL name no vessel identity: no names, MMSI,
  IMO, call signs, flags or countries. It SHALL call findings candidates, never accusations. It
  SHALL write British spelling with no em dashes.
- R3.3 No agent tool SHALL file or send anything. WHEN a tasking is filed, the backend SHALL file it
  on the officer's approval only.
- R3.4 The agent SHALL state a prediction only as its tool's `say` gives it. The answer's first line
  SHALL state what the agent did (the candidates found and the box drafted), not a prediction.

**R4. Coverage**
- R4.1 WHEN `check_ais_coverage` runs, it SHALL return:
  - the share of the reserve the pass imaged;
  - the share where AIS was received (`heard_share`, the key the draft and the backend use);
  - the checkable share (imaged and received);
  - the standard;
  - the split of unexplained targets between received and reception-unknown water.
- R4.2 The stage SHALL draw a pass's coverage before any of its targets becomes a candidate
  (unchanged, `MapView.tsx:542-565`). The column SHALL show no candidate count for a pass before the
  map has revealed that pass's candidates. This includes the two "no candidates" decision lines and
  the board's "no candidates" state, which wait for the reveal of the pass they name.
- R4.3 The agent, its tools and the stage SHALL say "AIS received" and "reception unknown" in place
  of "heard water", "unproven" and "not evidence".
- R4.4 The stage SHALL draw the received wash only where the pass imaged the reserve, so the drawn
  area matches the checkable share.

**R5. The prediction**
- R5.1 WHEN `predict_hotspots` runs, it SHALL return a rolling check. A radar day here is a day in
  the hold-out window with one or more dark targets away from the ports. For each radar day, the
  check SHALL refit on everything before that day and count that day's dark targets:
  - in the top 5% of the water: `held`, `total`, `days`, `days_hit` and the lift;
  - in the three patrol boxes drawn from that refit: `boxes_held`, `boxes_days_hit` and
    `boxes_lift`.
- R5.2 The stage SHALL show the top 5% figure only with the heat, and the boxes' figure only with
  the boxes.
- R5.3 The live question SHALL NOT show a forward reach from a silence.
- R5.4 IF no Sentinel-1 look is planned over a box, THEN the tools, the agent and the stage SHALL
  say "no look planned yet" and SHALL NOT extrapolate an orbit.

**R6. The stage**
- R6.1 WHEN `list_passes` has streamed, the column SHALL show the pass board before the first radar
  sweeps in.
- R6.2 WHEN the file for a streamed `decide` call loads, the column SHALL show one line under the
  step that decision leads to: "Decided:" for `read_pass`, `forecast` and `draft`, and "Checked:"
  for `stop`, which records a rule outcome. The line SHALL be worded from the file's enum values and
  numbers only.
- R6.3 WHEN a pass's coverage file, or its revealed candidates, are on the stage, the column SHALL
  show one "Checked:" line worded from that file's numbers.
- R6.4 The column SHALL fold `display_visual` into the step it shows, and chip inspections into the
  evidence step. The clean path SHALL be at most 10 rows.
- R6.5 WHILE the agent works, the column SHALL keep the lit row and its line fully in view at
  1280×720 and 1920×1080, without manual scrolling.
- R6.6 Stage text that this design adds or changes SHALL be at least 15 px, in British spelling,
  with no em dashes. The column's step numbers (13 px today) and "working" label (11 px today) in
  `StepColumn.tsx` reach 15 px through `stage-fixes-1` item 13, owned by that run and landing before
  gate B; this design does not change them (AC 6).
- R6.7 The filed sentence SHALL appear on the tasking plate's filed line and nowhere else on stage.
- R6.8 WHEN the officer approves, the stage SHALL NOT send a follow-up turn.
- R6.9 The answer SHALL be at most `ANSWER_MAX_WORDS` words (120). It SHALL hold, for the ending
  the question reached (§3.4 ANSWER):
  - a draft with candidates: a first line saying what the agent found and drafted; at most four
    bullets, the candidates bullet naming at most four ids, then "and N more"; the candidate
    sentence; the closing paragraph;
  - a draft with no candidates: the first line; the pass bullet, "No candidates on <date> in the
    <n>% it could check" and the forecast's `say`; the candidate sentence; the closing paragraph;
  - no draft (`stop`): the first line; one bullet per pass read with its checkable share, and the
    forecast's `say`; the closer alone, with no `say_else` and no candidate sentence.
- R6.10 WHEN the turn ends and the answer is taller than the column's visible height, the column
  SHALL scroll the answer's first line into view.

**R7. Data**
- R7.1 The build SHALL write each pass's metadata, `imaged_share` and `imaged_cells` into its
  manifest record. The runtime SHALL read the passes on file from the manifest.
- R7.2 WHEN the rerun runs, the build SHALL keep the passes on file. It SHALL add the newest IW
  passes, up to GFW's newest radar day, whose footprint covers at least 20% of the reserve. The
  footprint share SHALL be used only to select passes and SHALL NOT be shown.
- R7.3 WHERE the redesign is on stable, the rest replay SHALL be the newest pass on file's
  (`publish_vessel_rest.py --newest`). Otherwise it SHALL stay the star's (today's default). Either
  way the rest file SHALL carry the `bucket`; task 2 republishes the star's replay with it.
- R7.4 IF a pass on file lacks `imaged_cells`, or `rest_v1.json` lacks a `bucket` that passes the
  bucket regex (§3.8.1), THEN `warm_vessels.py --check` SHALL fail. With `--newest`, it SHALL also
  fail IF the rest pass is not the newest pass on file.
- R7.5 WHEN a rerun or rehearsal writes the cache, it SHALL first copy the manifest, history,
  fleet and rest files to a dated backup.

**R8. Evaluation and replay**
- R8.1 `scripts/eval.py` SHALL support these case keys: `expected_inputs` (equals and contains),
  `forbidden_inputs`, `expected_before`, `expected_after`, `forbidden_prose`, `max_seconds`,
  `report_max_words` and `required_text_by_ending`. It SHALL also support `--repeat N`, with a
  summary of the distinct paths.
- R8.2 Act 3 SHALL ship one offline replay case of the question, with its decision files, that
  loads with no live calls.

**R9. Fallback**
- R9.1 IF the redesign fails gate A or gate B, THEN G4 SHALL promote the four-turn version: the
  commit tagged `act3-four-turn-fallback`. Task 1 makes that tag after the four-turn golden cases
  pass on dev with its copy fixes, on a commit that holds those fixes and nothing else from this
  design. There SHALL be no Nov 5 rerun: the Oct 16 data stands, and the rest file is not
  republished with `--newest` (task 2's republish of the star's replay, which adds only `bucket`,
  stands). Gate A not green by Mon Oct 26 12:00, or gate B not green by Wed Oct 28 12:00, SHALL
  count as a failure. This amends requirement 12.5 (`requirements.md:259`) and decision 12
  (`design.md:394`), as U10 states; both were amended in the spec on Oct 21.
  - The tag lacks task 1's `MapView.tsx` lines. `MapView.tsx` is a shared file and
    `stage-fixes-1` had not merged into `develop` on Oct 21, so under the coordination rule they
    moved to task 7b. They are: the key rows at `:3266` ("radar target, not yet explained", to read
    "set aside: reception unknown, or one detector only" after the match), `:3267` ("a broadcast
    accounts for it" to "matched to a ship's AIS") and `:3270` ("candidate, not an accusation" to
    "candidate: no AIS where AIS was received"); the coverage legend rows at `:3278` ("AIS heard:
    two vessels within 30 km" to "AIS received: other ships came through here near the pass") and
    `:3279` ("unproven: no AIS is not evidence" to "reception unknown: no AIS here proves
    nothing"); and at `:3343` the clock's facts gaining the officer's filed choice (`SeaFacts.tasking`:
    box, kept, total, look start). The tagged version therefore still shows those five key and legend
    rows in today's words, and its clock's filed sub reads "the approved box and candidates are on
    the tasking plate" instead of "box {k} · {kept} of {n} candidates · next radar look …". The
    filed sentence still shows once, on the plate.
- R9.2 IF any of three eval runs on the Nov 5 data ends without a draft or takes over 120 s, THEN
  the backups SHALL be restored and the act SHALL be presented on the pre-rerun data.

### 2.2 Non-functional (EARS)

- N1 The agent SHALL complete the question on dev with a median of at most 90 s and a maximum of
  at most 120 s across eval runs.
- N2 WHEN the question starts in a fresh session, the board and the first decision line SHALL show
  within 10 s of the click, and before the radar sweeps in.
- N3 The design SHALL add no dependency and no backend, infrastructure or IAM change.
- N4 Deploys SHALL go to dev only until G4 (Fri Oct 30). After Nov 3, only fixes SHALL land, and
  the Nov 5 rerun SHALL change data only.

### 2.3 Acceptance criteria

1. pytest in `agents/dark-vessels/tests` passes with no network: the existing tests plus the new
   ones in §3.14. These include:
   - the `decide` matrix: every (step, because) pair, accepted when the records support it and
     refused with no file when they do not;
   - `asked` refused without matching words, and accepted for "at the end of August" on the Aug 30
     pass;
   - `newest_wide` refused as a second read;
   - `detect_vessels` refused without a decision, and a third pass refused end to end;
   - `draft_tasking` refused without a decision, and on a stale match record in a second question;
   - a repeat `list_passes` in one turn keeping the question;
   - box features holding no top 5% numbers;
   - a draft from the new coverage record carrying a numeric `heard_share`;
   - the longest legal answer, with seven candidates, at or under `ANSWER_MAX_WORDS`;
   - after a two-pass question, a new turn's `reachable_area` then `find_pass(<spare pass>)`
     succeeding (the question has closed);
   - the month-only rule refusing bare "may" and "march".
2. On dev, `open-question` passes 3 of 3 runs, with a median of at most 90 s, a maximum of at most
   120 s, and an answer of at most 120 words.
3. On dev, `thin-pass` passes. The agent sets the Aug 30 pass aside (`decide` with
   `because=coverage_thin`) and `match_ais` is never called on it. Either ending passes, each with
   its own required text (§3.10): a draft after a second pass, or the forecast followed by `stop`.
4. On dev, `named-pass`, `second-question`, `date-not-on-file`, `tasking-status`, the three
   provocation cases and the spares `gone-silent` (set up with the question) and `fleet-season`
   pass.
5. vitest covers:
   - the vessel step grammar;
   - every decision and check template (each 100 characters or fewer, with `passDay` dates), with
     both `stop` lines labelled "Checked:";
   - the board, and two turns in one session showing the second board and its lines, with the
     column kept mounted across the two turns;
   - `vesselsDirFrom`'s fallback, and `loadVesselRest` with no `bucket` leaving the fallback off;
   - the per-question filter;
   - the reveal wait, including a `no_candidates` decision file loaded before the reveal showing no
     line until it;
   - the clock lines (every changed sub 110 characters or fewer);
   - the one-filed-sentence rule;
   - the answer scroll.

   `npm run design:check` exits 0 on touched files.
6. In a headless live run against dev, three times at 1920×1080 and once at 1280×720:
   - the board shows before the radar sweeps in;
   - every accepted `decide` shows exactly one line, and a refused one shows none;
   - no candidate count, and no "no candidates" line or board state, shows in the column before
     the map's reveal;
   - the lit row and its line are fully visible at every beat without manual scrolling;
   - when the turn ends, the answer's first line is in view;
   - the filed sentence appears once;
   - no text in the column, and no other text this design adds or changes, is under 15 px.

   The step numbers (13 px today) and the "working" label (11 px today) in `StepColumn.tsx` are
   raised to 15 px in every act by `stage-fixes-1` item 13 (its plan's Group 4, approved Oct 21:
   "StepColumn step numbers 13 to 15 px, working label 11 to 15 px"). That run owns them and lands
   them on `develop` before gate B, which rebases onto it (task 8). This design does not change
   them, and with item 13 merged the 15 px check covers the whole column.
7. Task 9a's rehearsal records 3 runs of `open-question` on data whose newest pass is thin, with
   their paths and seconds.
8. The replay case `vessels-open-question` loads with a network log of only the basemap, TiTiler
   and the bucket. Its gallery card is marked available.
9. After the Nov 5 rerun, `warm_vessels.py --check --newest` is clear, the stable eval passes, and
   R9.2's go/no-go is recorded.
10. pytest in `scripts/tests` passes, and `eval.py --dry-run --agent X` succeeds for each of
    `earth`, `methane`, `archaeologist` and `vessels`.

### 2.4 Out of scope

- Forward reach from a recent silence: the spike found no usable case.
- A silence finder (§3.5, considered and rejected).
- The squid fleet and the silent vessel in the run: they stay as spares.
- Live AIS.
- Fixing the shared-stage bugs: separate work (§3.11).
- The agent's narration line (summary D6).
- A model change.
- Any change to Acts 1, 2 and 4.
- The off-stage record's checkable share. The backend's Slack and markdown line keeps "AIS was
  heard over …" (`backend/src/tasking.ts:354`), which needs a backend change. Slack is not shown
  during Act 3 (U15, approved Oct 21), and task 10's run sheet says so. There is no backend change,
  N3 stands, and the line is post-demo work.

## 3. Design

### 3.1 What runs today (from the code)

Line references in this document are to the branch base, `4a2a4ff`.

| Today | Where |
|---|---|
| The prompt fixes four turns' tool order and inputs | `vessels_config.py:103-121`; rule 2 at 41-43 |
| Every tool's `next_steps` names the next call | `pass_tools.py:67`, `:165`; `ais_tools.py:97`, `:169`, `:227`; `forecast_tools.py:184`, `:248`, `:289`, `:365`; `tasking_tools.py:101` |
| `find_pass("latest")` returns the builder's star; it returns `role` and `reserve_share`; its docstring gives a concrete pass id as the example | `pass_tools.py:17-21`, `:39-40`, `:60-63` |
| No tool checks that a pass was chosen: `detect_vessels`, `check_ais_coverage` and `match_ais` run on any pass on file | `pass_tools.py` `detect_vessels`; `ais_tools.py` `check_ais_coverage`, `match_ais` |
| `draft_tasking` takes any box and reads the session's match, hotspots and coverage records with no question check; it copies `heard_share`, which the backend requires as a number | `tasking_tools.py:54-60`, `:90`; `backend/src/tasking.ts:155-158` |
| No tool sees the presenter's words: the backend sends only `prompt` and `scenario_id`, and the entrypoint hands the prompt to the model | `backend/src/index.ts:357-362`; `dark_vessels.py:131` |
| The entrypoint already keeps per-invocation state in the process | `dark_vessels.py:85` (`AGENT_SESSION_ID`) |
| The rest replay is the star's | `scripts/publish_vessel_rest.py:41`, `:72` |
| The passes on file ship in the image; `passes()` appends the silent vessel | `vessel_store.py:34`, `:134-142`; `Dockerfile` `COPY . .` |
| Prompt rule 1 names `passes_on_file`, which is not a tool | `vessels_config.py:38-40`; `dark_vessels.py:36-50` |
| The heard share covers the whole reserve, not only the water the radar imaged; the footprint is used at the build but not stored | `ais_tools.py:46-53`, `:81`; `build_vessel_cache.py:395-397`, `:462-470` |
| The prediction is one hold-out, the latest 3 months | `forecast_tools.py:30`, `:145-150`, `:178` |
| `patrol_boxes` picks boxes greedily by the sums it reports, so box 1 always holds the largest share of past dark targets | `predict.py` `patrol_boxes` |
| Each box label carries its share of past dark targets | `forecast_tools.py:162` |
| The clock has separate heat and boxes beats, but the heat beat shows only until the boxes file lands, and both land together | `MapView.tsx:640-644` |
| The silent vessel is one curated moment | `forecast_tools.py:315-325` |
| Only tool inputs are streamed, keyed by `toolUseId`; the frontend keeps that id as `ToolCall.id` | `dark_vessels.py:132-160`; `parsing.ts:140-160` |
| The step column groups consecutive calls of one tool only; it renders the latest turn only; "+N earlier" is inert | `steps.ts:22-30`; `StepColumn.tsx:52`, `:135-146`; `ChatSidebar.tsx:512-525` |
| StepColumn unmounts between turns; Methane's tip files load in `ChatSidebar`, which does not | `ChatSidebar.tsx:279`, `:650-651`; `:537` |
| `useStageFiles` loads each URL once per mount | `hooks/useStageFiles.ts` |
| The session folder is found only from an `s3_url` tool input | `steps.ts:224-247` (`methaneDirFrom`) |
| `passWords` gives an ISO day and "YYYY-MM-DD HH:MM UTC" | `vesselLayers.ts:157-163` |
| The forecast's camera returns to the session's first pass | `MapView.tsx:454`, `:537-540`, `:608` |
| Any pass other than the rest's counts as "earlier" | `MapView.tsx:835`; `vesselLayers.ts:556-562` |
| The officer sentence is in 13 places | stage review, Item 4 |
| The filed turn is sent automatically | `Chat.tsx:427`; `vesselLayers.ts:766` |
| eval checks `forbidden_text` over the whole stream, tool inputs included; the final report is the prose after the last tool call | `scripts/eval.py:331-333`, `final_report` (228-238) |

Measured on the Oct 16 build's local files (method in the notes), as shares of the reserve:

| Pass (orbit) | Imaged | AIS received | Checkable |
|---|---|---|---|
| Oct 12 (33) | 53% | 30% | 19% |
| Sep 30 (33) | 53% | 32% | 22% |
| Sep 18 (33) | 53% | 31% | 20% |
| Sep 7 (55) | 48% | 26% | 17% |
| Aug 30 (106) | 31% | 37% | 10% |
| Mar 6 2024 (106) | 31% | 28% | 9% |

The received share alone never fails a floor. Checkable water does: it separates orbits 33 and 55
from orbit 106.

S1D's planned looks over this water after the build (spike §4; orbits from `tasks.md:77`, spike §2
and the 12-day repeat):
- Oct 17 00:25 (orbit 106, 31% of the reserve);
- Oct 18 (orbit 128, twelve days before Oct 30 11:49);
- Oct 24 (33);
- Oct 25 (55);
- Oct 29 (106);
- Oct 30 (128).

There are none from Oct 31 to Nov 9 (spike §2). On Nov 9 the newest passes on file will be orbits
128 and 106.

### 3.2 The question and its beats

**Question.** Option A (U1, approved Oct 21):

> Is anyone in the reserve without broadcasting, and where should the patrol look next?

The plate label is "Who is there without broadcasting, and where next?". Option B, "Where should the
patrol look next, and why?", is shorter but hides the first half of the work. The word "fishing" is
not used: in a reserve that bans industrial fishing, it presumes an activity the evidence cannot
show.

**Beats.** Times are agent seconds after the click (§3.9).

| t | What the room sees | Source |
|---|---|---|
| 0 | Sea at night. The AIS replay runs on: "while the agent chooses a radar pass" | rest, `forward` beat |
| 4 to 8 | Column: "Weigh the passes on file", then the board. Decision line, for example "Reading <date>: the newest pass that saw over half the reserve (53%)." | `list_passes`, `decide(read_pass)` |
| 10 | The radar sweeps in, with one sentence on what the agent sees and a radar chip | `find_pass`, `inspect_image` |
| 15 | Grey rings; the broadcasts claim theirs | `detect_vessels` |
| 19 | The received wash (inside the radar) and the reception-unknown hatch. Clock: "This pass can check 19% of the reserve". Line: "Checked: This pass can check 19% of the reserve, over the 15% standard." | `check_ais_coverage` |
| 24 | Candidates turn orchid. Then the line "Checked: 4 candidates where AIS was received, seen by both detectors." | `match_ais`, then the map's reveal |
| 30 | One evidence chip | `gather_evidence`, `inspect_image` |
| 39 | The heat. Clock: "Where to look on the next pass", with the top 5% figure | `predict_hotspots(pass_id)` |
| 44 | The boxes (5 s after the heat). Clock: "Three patrol boxes", with the boxes' own figure | the same call |
| 45 | Swath over the chosen box with its countdown, or "no look planned yet". Line, for example "Decided: Drafting box <k>: its radar look comes first, <look>." | `decide(draft)`, `next_look` |
| 50 to 60 | The plate opens on the agent's box, and the answer lands, its first line in view | `draft_tasking` |
| then | The officer changes the box or the candidates and approves; the plate shows its filed line | the officer |

**Thin path.** If the first pass is too thin to check:
- Its coverage stays drawn, with "Checked: This pass can check only 9% of the reserve, under the
  15% standard."
- Then "Decided: Set <date> aside: it can check only 9% of the reserve. Reading <date>."
- A second radar sweeps in, and the date reset hides the first pass's layers (`MapView.tsx`
  `showPass`). This adds about 17 s.

If the agent goes to the forecast instead, the question ends on the `stop` line with no draft.

**No candidates on a checked pass.** If every pass it reads is checked and empty, the agent drafts
a box with no candidates on the way ("No candidates on the <date> pass; I drafted box <k> for the
next look."). `near_candidates` is refused, since no box has any.

The question takes about 1 minute of agent time, plus about 2 minutes for the officer's choice and
narration. That frees about 3 of the act's 8 minutes, which the spare question (U7) can use.

### 3.3 Decision points: what is genuinely open

| # | Decision | What the model sees | Genuinely open | What constrains it | How the room sees it |
|---|---|---|---|---|---|
| 1 | Which pass first | `list_passes`. Per pass: id, date and time UTC, days old, satellite, orbit direction, share of the reserve imaged. No counts and no coverage, which would hand it the answer. | On the Oct 20 data, little: Oct 12 is the newest pass and tied for widest. On the task 9a and Nov 5 data, yes: the newest pass (likely thin, orbits 106 and 128), the newest wide pass (orbit 33), the widest, or a date asked for. | `decide` checks the reason is true ("newest" must be the newest; "asked" must be in the presenter's words). Nothing is detected on an unannounced pass. | Board with every pass, the one read marked; "Decided:" line |
| 2 | What follows a thin or empty pass | The coverage shares and the standard, or the match counts; the board | Which other pass (newer and narrower, or older and wider), or the forecast | Budget of two passes; `decide` checks the reason; `match_ais` refuses a thin pass | "Decided:" line; a second radar, with its board row marked set aside; or the forecast, then `stop` |
| 3 | Which box to draft | `predict_hotspots(pass_id)`. Per box: share of past dark targets, next planned look, `candidates_near`. Also `next_look`. | Box 1, 2 or 3, for one of four reasons, which can point at different boxes | `decide` checks the reason (§3.5); `draft_tasking` refuses an unannounced box | "Decided:" line; the swath over that box; the plate opens on it (the officer may change it) |
| 4 | Which chip to inspect, and the words | `gather_evidence` | Any candidate's chip | Budget: one chip, two only if the first is unclear | The chip in the column |
| checks | Coverage against the standard; candidates found | The tools' numbers | None: one outcome each | The tools | "Checked:" lines |

**Decision 3 on the Oct 12 pass.** The reasons do not all point at one box:
- `most_past_targets` gives box 1, as it always does by construction (§3.1, `predict.py`).
- `soonest_look` gives boxes 1 and 3, which share the Oct 24 00:17 look (stage review,
  `act3-dark-vessels.md:240`).
- `near_candidates` gives box 3, where T02 lies (`act3-dark-vessels.md:171`). It may give box 1 as
  well, since T01 sits on box 1's corner. ASSUMPTION (unverified): T01 is within 5 km of box 1.

So the open choice on Oct 12 is box 1 or box 3. On Nov 9 `soonest_look` may be refused, because no
look is planned yet (§3.7).

**The standard is a policy line.** 15% of the reserve checkable was set from the passes on file: it
separates orbit 106 (9 to 10%) from orbits 33 and 55 (17 to 22%). It is not a measured quality
threshold, and the clock calls it "the standard" for that reason. The backup slide says so too.

**Honest rating.** The rating is "agentic within guardrails", and it holds where decisions 1 and 2
are open:
- on data whose newest pass is thin: task 9a before the freeze, and Nov 9 after the rerun;
- when the presenter names a thin date (U7).

On the Oct 20 data, mainly decision 3 and the chip vary. The coverage verdict and "candidates
found" are threshold checks, and the stage says so. The evidence order, the hard rules, the
standard and the budget are not open, on purpose.

**What a sceptical engineer can see on stage:**
- the alternatives on the board before the choice, with each pass's imaged share;
- every reason tied to a number that the map and the clock also show, and every refused reason
  absent;
- "Checked:" for rule outcomes and "Decided:" for choices, so nothing is passed off as a decision;
- that nothing is detected or drafted without a "Decided:" line first, because the tools refuse it;
- a set-aside of the newest pass, claimed only once task 9a or the Nov 5 eval has recorded it (AC 7
  and 9);
- on request, the spare question "the same question, end of August" (U7), which takes the thin path
  live in about 80 s;
- the eval's variation report as a backup slide: paths per data state (Oct 20, task 9a, Nov 5);
- the raw `decide` calls in the transcript.

The same data and the same question tend to give the same path. The claim is that a different
situation gives a different path, not that the agent is random.

### 3.4 The prompt (`vessels_config.py`) and the entrypoint

Every block, kept, replaced or deleted:

| Block | Lines | What happens to it |
|---|---|---|
| Intro | 31-35 | Kept, with "check where AIS was being received at that hour" |
| HARD RULES 1 to 7 | 37-58 | Kept, with two changes. Rule 1 reads "Every pass comes from list_passes, find_pass or reachable_area … name the passes from list_passes". In rule 2, "Unproven water is …" becomes "Where AIS reception is unknown, no AIS proves nothing: a target there is never a candidate." |
| RESPONSE STYLE | 60-63 | Kept |
| FINAL REPORT | 65-80 | Deleted (replaced by ANSWER) |
| CONFIDENCE | 82-83 | Deleted (it says "heard water") |
| DISPLAY RIDES ALONG | 85-91 | Bullets kept. The titles become placeholders: "Radar, <date>", "Radar targets", "AIS received", "AIS reception unknown", "Dark targets seen before", "Patrol boxes", "Next radar look", and for the spares "Squid fleet, latest month" and "Reach by water, <date>" |
| LOOK BEFORE YOU ANALYSE | 93-98 | The radar sentence and the chip description are kept. "at most two evidence chips" and "At most 4 inspections" are deleted; BUDGET holds the counts |
| UNITS, ATTRIBUTION | 100-101 | Kept |
| WORKFLOW | 103-121 | Deleted, and replaced by the blocks below |

`FLOOR` comes from `vessel_store.CHECKABLE_FLOOR` (0.15) and `ANSWER_MAX_WORDS` from
`vessel_store.ANSWER_MAX_WORDS` (120), so the prompt, the tools and the eval cannot drift. A pytest
pins `golden_prompts.json`'s `report_max_words` to the constant.

```
GOAL: one open question about the reserve. Answer it from the passes on file: who is in the
reserve without broadcasting, on the pass that can best say so, and where the patrol should look
next. End with a draft patrol tasking for the officer, or say why there is none.

START: when the presenter asks about the reserve, a pass or a date, call list_passes first.

THE STANDARD: a pass can speak only for reserve water it imaged where AIS was being received
(check_ais_coverage's checkable_share). Under {FLOOR}% of the reserve it is too thin to say who is
there without broadcasting, and match_ais refuses it. A pass can check only water it imaged, so a
pass that imaged less of the reserve than a thin one rarely does better.

DECISIONS: you choose the path. Announce each choice with decide(step, because, ...) in the SAME
response as the first call it leads to; the tools will not read a pass or draft a box you have not
announced. Give a reason the tools' numbers already support, or the presenter's own words:
- which pass to read, from list_passes (step "read_pass"): how recent it is against how much of
  the reserve it imaged, or the pass the presenter named;
- when a pass is too thin to check, or has no candidates: another pass on file (step "read_pass")
  or the forecast (step "forecast");
- which box to draft, from predict_hotspots' boxes, and why (step "draft"), with next_look for
  that box;
- when no pass you read could be checked: step "stop", as your last call.
If decide refuses, read its facts and decide again; never repeat a refused reason.

BUDGET: at most two passes in one question. Inspect each radar you read once, and one evidence
chip (two only if the first is unclear). One forecast, one next look, one draft. A pass with
candidates is enough: no second pass. The room is waiting.

STOP: after draft_tasking, write the answer and stop. If no pass you read could be checked, give
the forecast's say, call decide("stop", "no_checked_pass"), then write the answer with no draft.
Provocations: rule 5, no tool. A date or a place not on file: call list_passes, say rule 1's
sentence, name the passes from it, and stop, with no decide and no find_pass.

ANSWER (at most {ANSWER_MAX_WORDS} words in all; no tables, no coordinates, no "---"). It depends
on how the question ended:
- A draft, with candidates. FIRST LINE "<n> candidates on the <date> pass; I drafted box <k> for
  the next look." Then at most four bullets, one line each: the pass with its checkable share, any
  pass set aside, and "data from Global Fishing Watch"; the candidates (at most four ids, then
  "and <N> more", with their distance to port as one range); gather_evidence's say_else, word for
  word; the forecast's say, word for word. Then the candidate sentence. END with one paragraph:
  "{OFFICERS_DECISION} {CLOSER}".
- A draft, with no candidates. FIRST LINE "No candidates on the <date> pass; I drafted box <k> for
  the next look." Then the bullets: the pass with its checkable share, any pass set aside, and
  "data from Global Fishing Watch"; "No candidates on <date> in the <n>% it could check"; the
  forecast's say, word for word. Then the candidate sentence. END with one paragraph:
  "{OFFICERS_DECISION} {CLOSER}".
- No draft, after decide("stop", ...). FIRST LINE "No pass I read could be checked, so there is
  no tasking." Then one bullet per pass read, with its checkable share (the first ends "data from
  Global Fishing Watch"); the forecast's say, word for word. END with "{CLOSER}" alone: no
  say_else and no candidate sentence.
The boxes' own record (say_boxes) only if the presenter asks about the boxes.

SPARES (only when asked): reachable_area for a vessel that went silent (say its date plainly as an
earlier pass, and "{CANNOT_SAY}"); fleet_pattern for the squid fleet; tasking_status for "is it
filed?".
```

**Tool strings the model reads**, reworded so the retired words cannot come back through it:

| Where | Today | Becomes |
|---|---|---|
| `check_ais_coverage` docstring (`ais_tools.py:58-68`) | "Where AIS could be heard … everywhere else is unproven" | "Where AIS was being received … everywhere else in the radar is reception unknown"; `heard_share` described as "the share of the reserve where AIS was being received" |
| `rule` (`:92`) | "heard: … vessels heard within 30 km" | "received: in one hour of the three either side of the pass, two or more different vessels' AIS received within 30 km" |
| legends (`:94-95`) | Heard water / Unproven water | AIS received / AIS reception unknown |
| `unproven_means` (`:96`) | `NOT_EVIDENCE` ("not evidence") | `RECEPTION_UNKNOWN` ("reception unknown: no AIS there proves nothing") |
| `match_ais` docstring (`:111-113`) | "unproven (… not evidence)" | "reception unknown (no AIS, but reception there is unknown, so it proves nothing)" |
| `match_ais` output (`:165`) | `say_in_order` with raw ids | adds `say_as`: {"broadcasting": "broadcasting", "port": "at or near a port", "unproven": "reception unknown", "seen_once": "seen by one detector only", "candidate": "candidates"} |
| `gather_evidence` `confidence` (`:224`) | "in water where AIS was heard" | "in water where AIS was being received"; adds `say_else` (below) |
| `INNOCENT` (`:21-30`) | "the same water heard again" | "AIS received in the same water again" |
| `find_pass` docstring (`pass_tools.py:39-40`) | example id `s1d-20261012t0018` | `s1d-YYYYMMDDtHHMM` |
| `tasking_status` `say` (`tasking_tools.py:126`) | "Filed by the officer. The agent did not file it." | "Yes, it is on file: filed at HH:MM UTC." |

`say_else` is fixed, 15 words, from the four `INNOCENT` entries: "Each could be a small boat, a
missed or switched-off AIS, or not a vessel."

**Entrypoint (`dark_vessels.py`).**
- `LOCAL_TOOLS` gains `list_passes` and `decide`. The model stays Sonnet 4.6 and the window stays 3.
- Before `stream_async` (`:131`), the entrypoint calls `vs.begin_turn(payload["prompt"])`. It stores
  a new `turn_id` (12 hex characters) and the prompt (a string, at most 2,000 characters) in module
  state, as `AGENT_SESSION_ID` is today (`:85`). A prewarm returns before this line.
- A replay case's follow-up (`scenario_id`, `dark_vessels.py:61-77`) still reaches this line, so
  the same rules hold there.
- ASSUMPTION (unverified): AgentCore serves one session's invocations one at a time in one
  process. The existing `os.environ["AGENT_SESSION_ID"]` already relies on it.
- ASSUMPTION (unverified): a follow-up turn has lost the earlier turn's tool calls, so the answer
  itself carries the why.

### 3.5 Tools

No tools are merged:
- The coverage verdict moves into a `match_ais` refusal.
- `next_look` stays separate, because the plate shows the look even if the call is cut, and the
  `draft` decision rides with it.
- `reachable_area` and `fleet_pattern` become asked-only spares.

| Tool | Status | Change |
|---|---|---|
| `list_passes()` | **new**, `pass_tools.py` | Opens a question, or keeps it within one turn (below). Lists the passes on file from the manifest, newest first, leaving out the silent-vessel spare (`on_file()["silent_vessel"]["pass_id"]`). Per pass it returns `pass_id`, `sensed`, `sensed_text`, `days_old`, `satellite`, `orbit_state`, `imaged_share` and `imaged_pct`. `next_steps` names the fork, not the answer: "Choose which pass to read and announce it with decide in the same response as find_pass." |
| `decide(step, because, pass_id="", box=0)` | **new**, `decide_tools.py` | Spec below |
| `find_pass` | changed | `latest` means the newest listed pass, by `sensed`. There is no star. It returns `imaged_share`, and drops `role` and `reserve_share`. While a question is open (only in the turn that opened it, below), it refuses a pass not yet read once two have been read ("Two passes read: go to the forecast."). In a later turn the budget does not apply, so a spare's `find_pass` runs as today. `next_steps` drops the call order |
| `inspect_image`, `display_visual` | unchanged | |
| `detect_vessels` | gated | While a question is open, refuses a pass with no accepted `read_pass` in this question (below). `next_steps`: "show the targets; then the coverage check" |
| `check_ais_coverage` | changed, gated | The same gate. Returns `imaged_share`, `heard_share` (the received share, kept under its old key because `draft_tasking` copies it, `tasking_tools.py:90`, and the backend needs it, `tasking.ts:155-158`), `checkable_share`, `standard` and `unexplained: {received, unknown}`. Imaged cells are the pass's `imaged_cells` plus every cell holding one of its targets. The received wash is clipped to the imaged cells, and the hatch is the imaged cells minus the received ones. `cv.agree` runs on the clipped shape. The heard feature gains `imaged`, `checkable` and `standard`. The coverage record keeps `heard_share` and gains `imaged_share`, `checkable_share` and the `question_id`. `next_steps`: "show both areas; judge this pass against the standard" |
| `match_ais` | changed, gated | The same gate. Refuses when the pass's coverage record is under `CHECKABLE_FLOOR`: `{"error": "This pass can check only N% of the reserve, under the 15% standard: no target on it can be called a candidate.", "checkable_pct", "standard_pct"}`. In any turn, refuses a coverage record from a question other than the session's latest ("Run check_ais_coverage again for this question."). Adds `checkable_share` and `say_as`. The match record gains the `question_id`. `next_steps` depends on the count, word for word: with candidates, "Show the targets (display_visual with targets_s3_url and render) with your next call; then the evidence."; with none, "Show the targets (display_visual with targets_s3_url and render) with your next call. No candidates on this pass: decide what follows." Showing a tool's own output is not investigation order, so R2.2 holds; without that display the map never reveals the matched targets |
| `gather_evidence` | strings, one check | As listed in §3.4, plus `say_else`. In any turn, refuses a match record from a question other than the session's latest ("Those records are from an earlier question: read the pass again.") |
| `predict_hotspots(pass_id="")` | changed | Adds the rolling check (§3.7) with `say` and `say_boxes`, and keeps today's single hold-out in the record. With `pass_id`, each box carries `candidates_near`: that pass's candidates inside the box or within 5 km of it, from this question's match record, and 0 for every box when there is none. The heat file's first feature carries the top 5% figures (`check_pct`, `check_times`, `check_since`), the way the heard file's first feature carries `share` today (`MapView.tsx:629`). Every box feature carries the boxes' figures (`boxes_pct`, `boxes_times`, `boxes_days_hit`, `days`) and no top 5% number. The map's box label becomes "Box {k}", without the share (`forecast_tools.py:162`). A box's share of past dark targets then appears in two places only, each worded as history: the `most_past_targets` line and the tasking plate's box options ("Box {k}  {NN}% of past dark targets", `TaskingPlate.tsx:194`). The boxes' measured figure is on the clock (§3.7, §3.8.4). The record gains the `question_id` |
| `next_look` | unchanged | |
| `draft_tasking` | three checks added | In any turn, against the session's latest question (`vs.latest_question()`, below), it refuses: (a) with no accepted `draft` decision in that question, "Announce the box with decide(draft, ...) first."; (b) a box other than the decided one, "You decided box k."; (c) a match, coverage or hotspots record whose `question_id` is not that question's, "Those records are from an earlier question: read the pass again." A later re-draft is therefore still held to a `decide` The draft keeps `heard_share` and `check` (the single hold-out, `tasking_tools.py:90-92`), and gains `imaged_share`, `checkable_share` and `rolling`. The backend validates none of the new fields (`tasking.ts:145-158`) |
| `tasking_status(tasking_id="")` | changed | With no id, it reads the session's newest `*.draft.json` (`vs.list_keys`). The filed `say` changes as in §3.4 |
| `reachable_area`, `fleet_pattern` | unchanged, spares | Asked-only. With no question open they run as today, and a question closes when its turn ends, so they also run as today after one |

**Question state** (all in the session folder, `vs.vessels_prefix()`):
- `question.json` is the tools' state, written by `list_passes` only. It holds `question_id`,
  `turn_id`, `started_at`, `standard`, `budget`, `decision_keys` and the listed passes.
  `decision_keys` is `"call"` on this branch (the Strands check below). `"inputs"` is the specified
  fallback; it is built only if a later Strands pin fails that check.
  - A call in a new turn writes a new `question_id`.
  - A repeat call in the same turn (`turn_id` equal to `vs.current_turn()`) keeps the
    `question_id`, so the decisions already accepted stand.
- The board file is the stage's copy: `passes_<toolUseId>.json` in "call" mode, and
  `passes_on_file.json` in "inputs" mode. It holds the same content, at most 12 rows.
- Accepted decisions are files only: `decision_<question_id>_<toolUseId>.json` in "call" mode, and
  `decision_<question_id>_<step>_<because>_<subject>.json` in "inputs" mode (`subject` is the pass
  id, the box, or `none`).
  - The tools list them with one `list_keys(prefix=f"{pre}decision_{question_id}_")` and read each
    file (at most about 6).
  - There is no shared mutable decisions file, so two calls in one response cannot lose a write,
    and nothing is ever deleted. No `s3:DeleteObject` is needed.
- **A question is open only during the turn that opened it.** `vs.current_question()` reads
  `question.json` and returns it only when `question.turn_id == vs.current_turn()`. It returns
  None when `list_passes` has not run in this session, and in every later turn until `list_passes`
  runs again.
  - The gate (R2.9), `find_pass`'s budget (R2.10) and `decide` use `vs.current_question()`. So
    `decide` in a later turn with no `list_passes` refuses with "Call list_passes first."
  - `draft_tasking`'s checks (a) to (c), and the stale-record checks in `match_ais` and
    `gather_evidence`, use `vs.latest_question()`: the session's latest `question.json`, in any
    turn.
  - A later turn that skips `list_passes` is ungated. R2.1 (the prompt's START) and the eval cover
    it.
- Coverage, match and hotspots records are stamped with the `question_id`.
- A pass counts as "read in this question" only when it has an accepted `read_pass` in this
  question. The pass most recently read is `L`.

**The gate** (`vs.require_read(pass_id)`, used by `detect_vessels`, `check_ais_coverage` and
`match_ais`). With no question open it passes. A question closes when its turn ends, so the spares
behave as today in any later turn, even after a two-pass question. Otherwise:
- it refuses a pass with no accepted `read_pass` in this question:
  `{"error": "Announce this pass with decide(read_pass, ...) first.", "facts": {"listed": [...],
  "read": [...]}}`;
- it is logged at INFO with the pass id only.

`detect_vessels` streams in a later response than `find_pass` and its `decide`, so the gate does not
race the decision. Correctness never depends on the order of calls within one response. If a model
does send `decide` beside a gated call, the gated call may be refused, which costs one round trip.
Checked Oct 21 (task 3's first hour, `strands-check.md` in the run notes): strands-agents 1.21.0
runs one response's tool calls concurrently. `Agent` defaults to `ConcurrentToolExecutor`
(`agent/agent.py:256`), `dark_vessels.py:109-124` passes no `tool_executor`, the executor starts
one task per tool use (`tools/executors/concurrent.py:50-67`), and each sync tool runs in its own
worker thread (`tools/decorator.py:594`). A scripted two-call response put both calls inside the
tool at once (0.51 s for two 0.5 s calls). Tool results return in completion order, which nothing
here relies on. Because `decide` refuses a third `read_pass` and `find_pass` refuses a third pass,
the two-pass budget is a tool invariant.

**`decide` spec.**
- The tool is `@tool(context=True)`, and it takes the call's id from
  `tool_context.tool_use["toolUseId"]` (validated against `^[A-Za-z0-9_-]{1,64}$`). `list_passes`
  uses the same mechanism for its board file.
- It returns `{"status": "noted", "facts": {...}}`.
- On acceptance it writes the decision file, holding `question_id`, `tool_use_id` (or the key),
  `step`, `because`, `subject` and `facts`, plus `at`. The facts are copied from the records and,
  for `asked`, from the presenter's words, never from the model.
- Checked Oct 21 (task 3's first hour, `strands-check.md`), so `decision_keys` is `"call"`:
  - The pin is `strands-agents[otel]==1.21.0` (`geo_agent/requirements.txt:8`), copied into the
    build context by `geo_agent/stage_shared.sh:81-84`. It was installed in a scratch venv only.
  - `@tool(context=True)` exists (`tools/decorator.py:672`, `:681`). The parameter must be named
    exactly `tool_context`; another name raises at import (`:175-182`, `:749`). It is hidden from
    the model's input schema (`:414-420`).
  - `tool_context.tool_use["toolUseId"]` is the call's own id (`types/tools.py:52-64`, `:128`,
    `:146`), and it equals the `current_tool_use.toolUseId` that `dark_vessels.py:138-148` streams,
    which is the frontend's `ToolCall.id`. So `passes_<toolUseId>.json` and
    `decision_<question_id>_<toolUseId>.json` name the call the stage shows.
  - The unit-test stub (`tests/conftest.py:44-54`) returns the plain function for
    `@tool(context=True)`, so tests pass a fake `tool_context` themselves, with no conftest change.
    Under the stub `ToolContext` is not importable, so the parameter is left unannotated or the
    import is guarded.
  - Not verified: a live Bedrock `toolUseId` against `^[A-Za-z0-9_-]{1,64}$` (the check used
    made-up ids), and the version inside the deployed dev image (only the pin was read). Gate A's
    first attempt exercises both: an id that fails the regex makes `decide` return "The decision
    could not be recorded." and shows no line.

**Rules common to every `read_pass`:** the pass is listed in this question; it is not yet read; and
fewer than two passes have been read.

| step | because | Needs | Accepted when (this question only) | Facts written |
|---|---|---|---|---|
| `read_pass` | `newest` | `pass_id` | first read; it is the newest listed pass | pass, satellite, imaged % |
| | `widest` | `pass_id` | first read; no listed pass has a larger `imaged_share` | same |
| | `newest_wide` | `pass_id` | first read; its `imaged_share` > 0.5, and no newer listed pass has > 0.5 | same |
| | `coverage_thin` | `pass_id` | `L`'s coverage record is under the standard | same, plus `from`: `L`, checkable % |
| | `no_candidates` | `pass_id` | `L`'s match record has 0 candidates | same, plus `from`: `L`, checkable % |
| | `asked` | `pass_id` | the presenter's words in this turn name the pass (below) | same, plus `asked_words` |
| `forecast` | `coverage_thin` | none | `L`'s coverage record is under the standard | `from`: `L`, checkable % |
| | `no_candidates` | none | `L`'s match record has 0 candidates | `from`: `L`, checkable % |
| `draft` | `most_past_targets` | `box` | the box's `share_of_past_dark_targets` equals the maximum (ties accepted) | box, share % |
| | `soonest_look` | `box` | its `next_look.start` is the earliest non-null one (ties accepted); refused when every box is null | box, look text |
| | `near_candidates` | `box` | its `candidates_near` ≥ 1, and no box has more | box, `candidates_near` |
| | `only_planned_look` | `box` | exactly one box has a `next_look`, and it is this one | box |
| `stop` | `no_checked_pass` | none | at least one pass read, and every pass read has a coverage record under the standard | each pass read with its checkable %, the standard % |

A second read is therefore always `coverage_thin`, `no_candidates` or a verified `asked`.
`near_candidates` is partly true by construction, because the map is fitted on history that
includes the read pass's day. The line therefore says only "lie in or near it".

**When the presenter's words name a pass (`asked`).** `vs.names_pass(prompt, pass, listed)`
matches the turn's prompt (from `vs.begin_turn`), case-insensitively. The words name pass X when
they contain any of:
- X's pass id;
- X's ISO date;
- X's month and day in either order: a full or three-letter month name, with an optional "." after
  it, and a day from 1 to 31 with an optional "st", "nd", "rd" or "th" and an optional "of" ("Sep
  7", "7 September", "the 7th of September");
- a month in which X is the only listed pass, written as a full month name directly after "in",
  "of", "end of" or "start of" ("end of August" names the Aug 30 pass while it is the only August
  pass on file). This rule never matches a bare month word, so the verb "may" and the verb "march"
  name no pass (pytest).

A four-digit year inside the matched phrase must equal X's year. `asked_words` is the matched text,
at most 30 characters. It is stored only if `tasking_tools.FORBIDDEN` and `IDENTIFIER` find nothing
in it, and as "" otherwise. A prompt that names no listed pass makes `asked` impossible.

**The `decide` docstring** (the model's only list of reasons; neutral, in table order, pinned by a
test):

```
Announce a choice before you act on it. The tool checks the reason against this question's records
and the presenter's words; a refused reason writes nothing and returns the facts.

Args:
    step: "read_pass", "forecast", "draft" or "stop".
    because: for read_pass, one of:
        "newest": the newest pass listed;
        "widest": no listed pass imaged more of the reserve;
        "newest_wide": the newest listed pass that imaged over half the reserve;
        "coverage_thin": the last pass read is under the standard;
        "no_candidates": the last pass read had no candidates;
        "asked": the presenter named this pass.
      For forecast: "coverage_thin" or "no_candidates", as above.
      For draft, one of:
        "most_past_targets": the box held the largest share of past dark targets;
        "soonest_look": the box's next planned look starts first;
        "near_candidates": the most of this pass's candidates lie in or near the box;
        "only_planned_look": the only box with a look planned.
      For stop: "no_checked_pass": no pass read could be checked.
    pass_id: for read_pass, the pass you will read.
    box: for draft, 1 to 3.

Returns: JSON with status "noted" and the facts, or an error with the facts.
```

**Validation and errors (`decide`):**
- `step` and `because` are required strings from the enums above.
- `pass_id` must match `PASS_ID_RE` and be listed in this question.
- `box` must be an integer from 1 to 3 and present in this question's `hotspots.json`.

| Failure | What the model receives | Logged | Recoverable? |
|---|---|---|---|
| No question (`list_passes` not run) | `{"error": "Call list_passes first."}` | no | yes |
| Unknown pair, or a missing argument | `{"error", "allowed"}` | no | yes |
| Reason not supported | `{"error": "the records do not support '<because>'", "facts"}` | INFO, enum values only | yes, it decides again |
| `asked`, but the words do not name the pass | `{"error": "The question did not name that pass.", "facts": {"listed"}}` | INFO | yes |
| `newest`, `widest` or `newest_wide` as a second read | `{"error": "That reason is for the first pass; a second read is coverage_thin, no_candidates or asked.", "facts"}` | INFO | yes |
| Already read, or budget spent | `{"error": "Two passes read: go to the forecast.", "facts"}` (or "already read") | INFO | yes |
| No tool-use id (context missing) | `{"error": "The decision could not be recorded."}` | WARNING | yes; no line shows |
| S3 put fails | `{"error": "The decision could not be recorded."}` | WARNING, exception type | yes; no line shows |

Nothing is written on a refusal. The stage relies on that invariant (R2.4).

**Other errors:**
- `list_passes`: if the manifest is unreadable, it returns `{"error": "The passes on file could not
  be read."}`, logs a WARNING, and the agent stops and says so. With no passes, it returns rule 1's
  refusal.
- `check_ais_coverage`: if a pass lacks `imaged_cells`, it returns `{"error": "The imaged area for
  <id> is not built (scripts/build_vessel_cache.py --imaged)."}` and logs a WARNING. The model may
  choose another pass; `--check` prevents this on show day.
- `predict_hotspots`: if the window has no radar days, it says "No dark targets were found from
  <since>, so the map's check cannot be measured." The agent says that and makes no claim, and the
  clock shows "no check possible".
- `tasking_status("")` with no draft in the session: `{"error": "No tasking has been drafted in
  this session."}`.
- `draft_tasking` without a match record still refuses (`tasking_tools.py:54-60`), and check (c)
  refuses an earlier question's record. So a question with no checkable pass can only end on
  `stop`, even in the second question of a session. The backend is unchanged: it needs numeric
  counts and `heard_share` (`backend/src/tasking.ts:150-158`).

**Considered and rejected:**
- A `silences_at(pass_id)` finder. The silences that overlap passes on file are long. Case 6 had
  been silent about 100 h at the Oct 12 pass, a reach of over 1,000 km at 6 kn. Showing one beside
  candidates invites the room to link them.
- Forward reach: there is no usable case (§1).
- A coverage band in which the agent may accept or reject a marginal pass. Every orbit 33 and 55
  pass sits in any useful band, so it would invite contrived set-asides of a 19% pass for a 22% one.
- Rejecting a pass for sea clutter from the radar look: there is no measured criterion.
- Gating `find_pass` on a decision. `decide` rides in the same response as `find_pass`, so the gate
  would race it. The gate sits one call later, on `detect_vessels`.

### 3.6 Data: what is cached, what is live, the rehearsal and the Nov 5 rerun

**Precomputed by the build (unchanged):**
- the radar crops and display COGs;
- both detectors, paired;
- the presence ±3 h and the 72 h replay;
- the chips;
- the history and the fleet.

**New in the build (task 2):**
- `build_pass` computes each pass's `imaged_cells`: display value > 0 at each 0.05° cell centre
  (the notes' method). It also writes `satellite`, `orbit_state`, `relative_orbit` and
  `imaged_share` into the record (`summarise`, `build_vessel_cache.py:440-475`).
- `--imaged` backfills those fields for the passes already built. It reads each display COG from
  the bucket, so it does not rely on `/tmp/vessels_cache/v1/` surviving.
- `--backup <date>` and `--restore <date>` copy the manifest, history, fleet and rest files
  server-side, to and from `<prefix>/backup-<date>/`.
- `--prefix vessels/cache/v1r` sends every write to the rehearsal prefix, for task 9a only.
- `list_vessel_passes.py --newest N --min-share 0.2 --append` adds the newest qualifying passes not
  yet on file to `passes_v1.json`, by rule, with role `on_file`. It applies no star and no
  candidate filter.
- `publish_vessel_rest.py --newest` picks the newest pass. Without the flag it picks the star, as
  today, so the four-turn fallback is unaffected. It also writes `"bucket"`; the backend already
  returns the payload unchanged (`backend/src/index.ts:829-835`).
- Task 2 runs `publish_vessel_rest.py` on v1 with the default (the star) right after `--imaged`, so
  `rest_v1.json` carries `bucket` from Oct 21 and the replay is unchanged. It confirms the payload
  carries `bucket` and otherwise matches the `backup-2026-10-21` copy. Today's frontend ignores the
  field, so the four-turn fallback is unaffected, and gate B, the Oct 29 rehearsal and G4 all run
  with the early board's fallback live.
- `warm_vessels.py --check [--newest]` checks `imaged_cells`, that `rest_v1.json` carries a
  `bucket` that passes the bucket regex (§3.8.1), and, with the flag, the rest pass.

**Computed live (deterministic):**
- the pass list;
- the reserve clip, ports and claim;
- received cells and the checkable share;
- statuses and evidence;
- the rolling check, the map and the boxes;
- the decision checks, including the presenter's words;
- the draft.

The one live external read is ESA's plan, bounded and cached (`forecast_tools.py:72-104`).

**Decided by the model:** the pass, what follows a thin or empty pass, the box, the chip and the
words.

**Runtime source of passes.**
- `vs.passes()` reads the manifest's records, removes duplicates by id, and appends the packaged
  `silent_vessel` entry only for the spare.
- The 300 s cache (`vessel_store.py:39`) picks up a rerun without a deploy.
- `CACHE_PREFIX` comes from `VESSEL_CACHE_PREFIX`, validated against `^vessels/cache/v1[a-z0-9-]*$`,
  with `vessels/cache/v1` as the default. `deploy.sh` passes the variable only when `.env.dev` sets
  it.
- Product keys come from each manifest record, so only the manifest key follows the prefix.
- `passes_v1.json` stays the builder's input list and keeps the spare's entry.

**Task 9a: a pre-freeze rerun rehearsal, so the data-driven path is seen before Nov 3 (dev only).**
1. The data build starts Tue Oct 27 pm; the runs follow gate B's go on Wed Oct 28 am.
2. `build_vessel_cache.py --prefix vessels/cache/v1r --seed-from vessels/cache/v1` copies only
   `manifest.json`, whose records keep pointing at the v1 objects, which are read-only to it.
3. `list_vessel_passes.py --until 2026-10-19 --newest 2 --min-share 0.2 --append` adds the Oct 17
   (orbit 106) and Oct 18 (orbit 128) passes if they qualify. This is a working-copy edit; it is
   never committed and is restored after the build.
4. Then `--pass … --until 2026-10-19 --dry-run`, `--chips` and `--upload-local`, with `--prefix`.
   Then `--history --until 2026-10-19 --prefix …`.
5. Dev is redeployed with `VESSEL_CACHE_PREFIX=vessels/cache/v1r`, then the env and a smoke check.
6. Run `eval.py --target dev --agent vessels` with all cases (`gone-silent`, set up with the
   question, included), plus `--only open-question --repeat 3`. Record the paths, seconds and row
   counts.
7. The replay (task 9) and the rehearsal (task 10) use this data.

The v1 prefix and stable are untouched. The dev stage still opens on v1's rest replay (Oct 12),
which the new clock copy states truly (§3.8.2). ASSUMPTION (unverified):
- GFW's AIS reaches Oct 19 by Oct 27 (the spike measured a lag of 4 to 5 days);
- the Oct 18 pass was acquired;
- Oct 17 is under 15% checkable, as Aug 30 is (same orbit, 106, at 31% of the reserve,
  `tasks.md:77`);
- Oct 18 is thin too. The Oct 16 plan's takes over the reserve cover "24 to 54% of it each" across
  orbits 106, 128, 33 and 55 (`design.md:39-40`). With 106, 33 and 55 at 31%, 53% and 48%, orbit 128
  is likely the 24%: over the 20% selection rule, and likely under the standard.

**Nov 5 runbook (data only, no code, no deploy; the redesign is on stable since G4).** Times come
from the Oct 16 build (each pass 120 to 739 s, `tasks.md` 2.1):

| Step | Command | Time |
|---|---|---|
| 1 | `build_vessel_cache.py --backup 2026-11-05` | about 1 min |
| 2 | Read GFW's newest radar and AIS days (printed by step 3). Expect radar to about Nov 2 and AIS to about Nov 1 | none |
| 3 | `list_vessel_passes.py --until <radar end + 1> --newest 6 --min-share 0.2 --append` | about 2 min |
| 4 | `build_vessel_cache.py --pass <id> [--pass <id> …] --until <radar end + 1> --dry-run`, then `--chips`, then `--upload-local` | 15 to 75 min |
| 5 | `build_vessel_cache.py --history --until <radar end + 1>` | ASSUMPTION (unverified): about 10 min |
| 6 | `publish_vessel_rest.py --newest`; `warm_vessels.py`; `warm_vessels.py --check --newest` | about 2 min |
| 7 | `eval.py --target stable --agent vessels`, all cases, then `--only open-question --repeat 3` | about 10 min |
| 8 | Go/no-go (R9.2). If no-go: `build_vessel_cache.py --restore 2026-11-05`, then `--check` | about 2 min |
| 9 | Commit the `passes_v1.json` edit on `develop` only. The runtime reads the manifest, so `demo-stable` does not move | none |

Expected new passes: Oct 17, 18, 24, 25, 29 and 30, if each qualifies and its AIS is complete. The
newest are orbits 128 and 106.

Because task 2 republished the rest file with `bucket` on Oct 21, step 1's backup holds a rest file
with a `bucket`, and a no-go restore at step 8 brings one back.

If the rerun turns up a usable silence under the spike's definition (about 8%), it may replace the
spare's case. It never enters the question.

Under R9.1 (the four-turn fallback) there is no Nov 5 rerun.

### 3.7 The prediction, and "predictions only as measured"

**The map.** The prediction is the hotspot map for the next pass. It is fitted on everything up to
the newest day, with the ports left out and `SPREAD = 1` (`forecast_tools.py:27`). The boxes keep
their next planned looks from ESA's published plans.

**The new check.** `predict.rolling_check(dets, grid, since, until, share=0.05, spread, water,
box_cells, n_boxes)`:
- For each radar day in `[since, until)`, meaning each day in the history with one or more dark
  targets away from the ports (`forecast_tools.py:47-52`), it fits on everything before that day.
- It counts that day's dark targets in that fit's top 5%, and in the three boxes `patrol_boxes`
  draws from the same fit. The data is already in hand: there is no extra history read.
- It returns `held`, `total`, `days`, `days_hit` and `lift` for the top 5%, and `boxes_held`,
  `boxes_days_hit` and `boxes_lift` for the boxes (their lift against the boxes' share of the
  water).
- The window is unchanged: `HOLD_OUT_MONTHS = 3` up to the history's newest day. That is Jul 1 to
  Oct 12 on today's cache, and about Aug 1 to Nov 2 after the rerun.
- About 20 refits on a 0.05° grid, each with one `patrol_boxes` call. ASSUMPTION (unverified):
  under 1 s; a pytest times it on a history of the real size.

**The check measures the method, not today's three boxes.** Each day's boxes are the ones the map
would have drawn before that day. The wording says "refitted the same way" for that reason.

**Its sentences:**
- `say` (22 words, for the answer): "Refitted before each radar day since {Month}, the map's top 5%
  of water held {pct}% of the dark targets, {times} times chance."
- `say_boxes` (17 words, only when asked about the boxes): "Refitted the same way, the three
  patrol boxes held {bpct}% of the dark targets, {btimes} times chance."
- The clock's two subs (§3.8.2) carry the same numbers, each beside its own layer.

The spike measured Jul 1 to Oct 17 (spike §4 table):
- the top 5%: 41% of 54 dark targets, 8 times chance, on 11 of 17 radar days;
- the three boxes (1.0% of the water): 9%, 9 times chance, on 4 of 17 radar days.

Dark targets were found on 17 of the 28 radar days since July. Those figures show the order of
magnitude only; the agent says whatever the tool measures. The single hold-out stays in
`hotspots.json` and in the draft's record (`tasking_tools.py:92`).

**How the rule applies:**
- The agent says the `say` and nothing beyond it, and `say_boxes` only if asked. The clock shows
  the same numbers, from the heat and box features.
- The answer's first line states a decision ("I drafted box <k> for the next look"), never that a
  box is where vessels will be.
- Box shares are history ("share of past dark targets"), never a probability. They appear in two
  places only, each worded as past dark targets: the `most_past_targets` line and the tasking
  plate's box options (`TaskingPlate.tsx:194`, §3.8.4). They no longer appear on the map's box
  labels.
- A next look exists only if ESA has planned it. On Oct 20 the S1D plan has no look over these
  waters from Oct 31 to Nov 9.
- ASSUMPTION (unverified): a plan covering Nov 10 onwards is published before Nov 9. If not, every
  box reads "no look planned yet", `soonest_look` is refused, and the plate shows no countdown.
- No forward reach is shown live. The spare's reach, when asked, is said as "an earlier pass".

### 3.8 The stage

#### 3.8.1 Step column (new `utils/vesselSteps.ts`; StepColumn uses it when the turn has vessel tools)

**Grammar:**
- `display_visual` folds into the group of the step whose file it shows, by file kind:
  - `radar_` into `find_pass`;
  - `targets_` into `detect_vessels`, or into `match_ais` once that has run;
  - `heard_` and `unproven_` into `check_ais_coverage`;
  - `hotspots` and `boxes` into `predict_hotspots`;
  - `look_` into `next_look`.
- Chip `inspect_image` calls (`/chips/` in the URL) fold into `gather_evidence`, and their chips
  render there as today. The radar's `inspect_image` stays a row: "Look at the radar".
- A `decide` call is not a row. Its line attaches to the next group of the tool it leads to, or the
  nearest one if it streams after:

| step | attaches to |
|---|---|
| `read_pass` | `find_pass` |
| `forecast` | `predict_hotspots` |
| `draft` | `next_look`, else `draft_tasking` |
| `stop` | the last group |

The clean path is 10 rows, and the board is pinned like the tip board (`StepColumn.tsx:93-101`):
1. Weigh the passes on file (with the board)
2. Find the radar pass
3. Look at the radar
4. Find targets on the water
5. Check where AIS was received
6. Match targets to broadcasts
7. Gather the evidence
8. Predict where to look
9. When the radar looks again
10. Draft the tasking

The step names are in `stageCopy.ts:120-131`. `list_passes` is "Weigh the passes on file",
`check_ais_coverage` is "Check where AIS was received", and `decide` has no row.

**Dates.** A new `passDay(passId)` in `vesselLayers.ts` returns the short date "Oct 12" (month
first, as `nice_time` and the look lines already give, `vessel_store.py` `nice_time`,
`forecast_tools.py` `_look_line`). Every line and every board row uses it. `passWords`
(`vesselLayers.ts:157-163`) keeps the clock's long form.

**Where files come from.**
- `vesselsDirFrom(tools, sessionId, {bucket, caseId})` lives in `vesselSteps.ts`, modelled on
  `methaneDirFrom` (`steps.ts:224-247`). It returns the case folder or this session's folder, from
  any streamed `s3_url`.
- Before any URL has streamed, it falls back to `s3://<bucket>/session_data/<sessionId>/vessels/`,
  or `s3://<bucket>/use-cases/<caseId>/` in a replay.
- The bucket comes from the rest file, validated against `^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$` in
  `loadVesselRest` (`services/api.ts:279`), and is passed down by `Chat.tsx` and `ChatSidebar`.
  Task 2 puts it in `rest_v1.json` on Oct 21 (§3.6), and `warm_vessels.py --check` fails without it.
- With no `bucket`, or one that fails the regex, `loadVesselRest` leaves the fallback off: the
  column waits for the first streamed `s3_url`, as today (vitest).
- This is what lets the board load before the radar (N2). The bucket name is already in every
  streamed `s3_url`, and reads still pass the backend's allowlist (`backend/src/s3Access.ts:27-35`).

**Which files load, and where.**
- The board and decision loads live inside the StepColumn subtree (a `VesselStepExtras` component
  that `StepColumn` renders for vessel turns). They do not live in `ChatSidebar` beside `tipFiles`
  (`ChatSidebar.tsx:537`).
- `StepColumn` renders `VesselStepExtras` with `key={turnSentAt}`, so it remounts every turn and
  `useStageFiles` starts fresh for every question, whatever StepColumn does. Today StepColumn
  unmounts between turns (`ChatSidebar.tsx:279` empties the streaming tools, and `:650-651`
  renders the column only with tools); Bug 6's fix may keep it mounted, and the key makes the board
  independent of that. ChatSidebar records the turn's send time (`turnSentAt`) and passes it down.
  A vitest keeps the column mounted across two turns and expects the second board.
- "call" mode: the column loads `passes_<call.id>.json` for this turn's latest `list_passes` call.
  The name is unique per call, so a second question can never show the first one's board. Until the
  tool writes it, `useStageFiles` retries every 2 s for up to 45 s.
- "inputs" mode (the fallback, built only if a later Strands pin fails the check in §3.5): the
  column loads `passes_on_file.json` and accepts it only when its `started_at` is no earlier than
  `turnSentAt` minus 30 s. ASSUMPTION (unverified): the presenting laptop's clock is within 30 s of
  AWS time. A wrong clock can only hide the board; it cannot show a stale one unless the skew is
  over 30 s.
- For each streamed `decide` call in the turn, the column loads `decision_<question_id>_<call.id>.json`,
  or in "inputs" mode the key built from that call's validated inputs. It removes duplicates by
  key.
- A line renders only if its file loads, its `question_id` equals the board's, and its `step` and
  `because` match the call's inputs. A refused call writes no file, so it shows no line.
- The two `no_candidates` lines (`read_pass` and `forecast`) also wait for the map: each renders
  only once `revealedPasses` holds the decision's `from` pass, so a zero count never beats the
  reveal (R4.2). A vitest loads a `no_candidates` file before the reveal and expects no line until
  it.
- Every date in a line comes from a pass id in the file, through `passDay`; never from `find_pass`'s
  `when`.

**Lines.** "Decided:" is in fog at 15 px and "Checked:" in label grey at 15 px, followed by the
sentence. Every template is at most 100 characters, which a vitest checks with `passDay` dates,
two-digit and three-digit percentages, and the longest look text. The longest,
`forecast/no_candidates` with a three-digit share, measures 89. The `stop` lines are labelled
"Checked:", because `stop` records a rule outcome: after the forecast `draft_tasking` refuses
without a match record (`tasking_tools.py:54-60`), and the choice was the earlier `forecast`
decision, which has its own line. `decide(stop)` stays the tool's record, and a vitest pins the
label.

| Source | Line |
|---|---|
| decide `read_pass/newest` | Decided: Reading {date}: the newest pass on file. It saw {imaged}% of the reserve. |
| `read_pass/widest` | Decided: Reading {date}: of the passes on file, it saw the most of the reserve, {imaged}%. |
| `read_pass/newest_wide` | Decided: Reading {date}: the newest pass that saw over half the reserve ({imaged}%). |
| `read_pass/coverage_thin` | Decided: Set {from} aside: it can check only {checkable}% of the reserve. Reading {date}. |
| `read_pass/no_candidates` | Decided: No candidates on {from} in the {checkable}% it could check. Reading {date} too. |
| `read_pass/asked` | Decided: Reading {date}, as asked. It saw {imaged}% of the reserve. |
| `forecast/coverage_thin` | Decided: Set {from} aside: it can check only {checkable}%. Going to where to look next. |
| `forecast/no_candidates` | Decided: No candidates on {from} in the {checkable}% it could check. Going to where to look next. |
| `draft/most_past_targets` | Decided: Drafting box {k}: it held the most past dark targets, {share}%. |
| `draft/soonest_look` | Decided: Drafting box {k}: its radar look comes first, {look}. |
| `draft/near_candidates` | Decided: Drafting box {k}: {m} of the candidates lie in or near it. |
| `draft/only_planned_look` | Decided: Drafting box {k}: the only box with a radar look planned. |
| `stop/no_checked_pass`, one pass | Checked: {a} can check only {ca}%, under the {floor}% standard. No tasking can be drafted. |
| `stop/no_checked_pass`, two passes | Checked: {a} and {b} can check only {ca}% and {cb}%. No tasking can be drafted. |
| heard feature, at or over the standard | Checked: This pass can check {checkable}% of the reserve, over the {floor}% standard. |
| heard feature, under the standard | Checked: This pass can check only {checkable}% of the reserve, under the {floor}% standard. |
| the map's reveal for the pass | Checked: {n} candidates where AIS was received, seen by both detectors. (1: "1 candidate …"; 0: "No candidates where AIS was received.") |

**When a "Checked:" line renders.**
- The coverage line renders once that pass's `display_visual(heard_<pass>)` has streamed and the
  heard file has loaded.
- The candidates line renders only after the map has revealed that pass's candidates. MapView
  gains `onCandidatesRevealed(passId, count)`, which it fires inside its reveal (`MapView.tsx:555-562`).
  `Chat.tsx` holds `revealedPasses`, resets it on every `sessionId` change, and passes it through
  `ChatSidebar` to the column. The column and the map therefore share one rule.

**Pass board** (new `components/PassBoard.tsx`, modelled on `TipBoard.tsx`).
- It reads the board file and validates each field: the id regex, ISO time, `S1[A-D]`, a share from
  0 to 1, at most 12 rows.
- Under the step it shows one detail line, "share of the reserve each pass imaged", then one row
  per pass: `Oct 12   S1D   53%   reading`, mono at 15 px. It uses no amber and no orchid.
- It shows the newest 4 rows below 1600 px wide (a `matchMedia` check) and 6 at 1600 px and over.
  Any marked row replaces the oldest unmarked one, so a marked row is never hidden. "and N older"
  goes below, as `.step-detail` at 15 px.
- States come from loaded decision files only:

| State | From | Shown as |
|---|---|---|
| reading | the subject of the latest `read_pass` | fog dot, fog label |
| read | an earlier `read_pass` subject | fog label |
| set aside: too thin | `from` of a `coverage_thin` decision | grey label, "set aside" |
| set aside: no candidates | `from` of a `no_candidates` decision, once `revealedPasses` holds that pass | grey label, "no candidates"; before the reveal the row keeps its "reading" or "read" state |

**Height budget.** The column is a scroll container (`stage.css:32-48`, `overflow: hidden auto`).
Heights are in px. ASSUMPTION (unverified): the stage fills the viewport height, the stage font fits
about 31 characters per 15 px line at 1280 and 41 at 1920, and the answer is set at 15 px × 1.3.
Gate B measures all three.

| Element | 1280×720 | 1920×1080 | Source or rule |
|---|---|---|---|
| Column | 296 wide, ≤ 568 tall (less where the console overlaps) | 365 wide, ≤ 928 tall | `stage.css:32-38`; `ChatSidebar.tsx:590-605` |
| Head, question (3-line clamp), foot fade | 46 + 82 + 24 | 46 + 61 + 24 | `stage.css:50-58`, `:71-78`, `:110-122` |
| Left for steps, or for the answer | ≤ 416 | ≤ 797 | |
| Step row; lit row | 31; 33 | 31; 33 | `StepColumn.tsx` row styles |
| A "Decided:" or "Checked:" line | ≤ 4 lines, ≤ 80 | ≤ 3 lines, ≤ 61 | 100-character rule; `.step-detail` 15 px × 1.3 |
| Pass board | 21 + 4 × 23 + 23 + 8 = 144 | 21 + 6 × 23 + 23 + 8 = 190 | new |
| Radar or evidence chip | ≤ 186 | ≤ 186 | `stage.css:556-612` |
| Heaviest working beat | choose: 31 + 144 + 33 + 80 = 288; evidence: 31 + 21 + 33 + 186 = 271 | | ≤ 416 |
| The answer at its cap (about 600 characters, 116 words) | about 24 lines, about 470 | about 17 lines, about 330 | §3.14 sample |

Behaviour:
- Whenever the lit row changes, or its line appears, the column scrolls that row into view
  (`scrollIntoView({block: 'nearest'})`; instant under reduced motion).
- When the turn ends, the answer's scroll (`ChatSidebar.tsx:612-615`, `block: 'nearest'` today)
  uses `block: 'start'` for vessel turns whenever the answer is taller than the column's visible
  height. At 1280 the answer (about 470) is taller than the 416 left, so its first line lands at
  the top and its closing paragraph is one scroll away. At 1920 it fits, and `nearest` keeps the
  steps above it in view. Other agents keep today's behaviour.
- The board is not sticky. It is in view at the choose beat and scrolls away later; the set-aside
  line names both passes, so it is not needed then.

#### 3.8.2 Clock plate (`vesselLayers.ts:545-605`)

Every sub this design changes is at most 110 characters (vitest, with the longest values). The
longest today is 109 characters (the coverage sub, `vesselLayers.ts:575`).

| Beat | Today (lead / sub) | Proposed (lead / sub) |
|---|---|---|
| forward | AIS replay {t} / running on to the radar pass | AIS replay {t} / while the agent chooses a radar pass |
| radar, not the replay's pass | {sat} radar {when} / an earlier pass · the AIS replay is of the latest one, so it steps aside | {sat} radar {when} / the AIS replay is of the {replay day} pass, so it steps aside. This is true whether the pass is older or newer, so it holds in task 9a too |
| coverage | AIS heard over {x}% of the reserve / two or more vessels within 30 km in one hour, three either side of the pass · hatched: unproven, not evidence | This pass can check {checkable}% of the reserve / the radar imaged it and other ships' AIS was received there near the pass · hatched: reception unknown (102) |
| candidates | {n} candidates / radar targets with no AIS, in water where AIS was heard, seen by both detectors · candidates, not accusations | {n} candidates / no AIS where AIS was being received, seen by both detectors · a reason to look, not an accusation (97) |
| heat | Where to look next / where radar targets with no AIS match were seen before … | Where to look on the next pass / refitted before each radar day since {Month}, its top 5% of water held {pct}% of the dark targets (97) |
| boxes | Three patrol boxes / each box: its share of past dark targets and its next radar look … | Three patrol boxes / the three boxes, refitted the same way, held {bpct}% · one or more in a box on {bdays} of {days} days with dark targets (107) |
| look, none planned | (no beat) | the boxes stay, and each box label reads "no look planned yet" |
| tasking | Patrol tasking draft / the officer chooses the box and the candidates · the decision is the officer's | Patrol tasking draft / choose a box and the candidates, then approve |
| filed | Patrol tasking filed / Filed by the officer. The agent did not file it. | Patrol tasking filed / box {k} · {kept} of {n} candidates · next radar look {countdown, or "not planned yet"} |

- The heat and boxes files land together. MapView holds the heat beat for 5 s, then moves to the
  boxes beat (`seaLater`, `MapView.tsx:640-644`), so each figure is on screen beside its own layer.
  Under reduced motion the hold stays, because it is a dwell, not motion.
- `SeaFacts` gains `checkable`, `standard`, `heatCheck` (from the heat file's first feature) and
  `boxCheck` (from the box features), each validated as numbers in range.
- The fleet and reach beats stay for the spares.
- `SeaClock` sets `aria-live="off"` for `tasking` and `filed` (today `SeaClock.tsx:26` makes it
  polite unless ticking), because the plate announces them (stage review P2-7).

#### 3.8.3 Map words (from the stage review's Item 1)

| Where | Today | Proposed |
|---|---|---|
| Legend, `MapView.tsx:3278` | AIS heard: two vessels within 30 km | AIS received: other ships came through here near the pass |
| Legend, `:3279` | unproven: no AIS is not evidence | reception unknown: no AIS here proves nothing |
| Region labels, `seaStage.ts:511` | heard water / unproven: AIS not heard here | AIS received / reception unknown |
| Ring label, `seaStage.ts:500` | not evidence | reception unknown |
| Key after the match, `MapView.tsx:3266` | radar target, not yet explained | set aside: reception unknown, or one detector only |
| Key, `:3267`, `:3270` | a broadcast accounts for it / candidate, not an accusation | matched to a ship's AIS / candidate: no AIS where AIS was received |
| `STATUS_KEY` (`vesselLayers.ts:174-181`) | … not evidence / … in heard water … | reception unknown: no AIS there proves nothing / candidate: no AIS where AIS was received, both detectors |
| Layer names (`vesselLayers.ts:127-128`, `ais_tools.py:94-95`) | Heard water / Unproven water | AIS received / AIS reception unknown |
| Box labels (`forecast_tools.py:162`) | {k}  {share}% | Box {k} |
| Legend, new row after `:3279` | (none) | outside the radar: not imaged (15 px; plain sea, no swatch fill) |

- Region labels stay on after the reveal, at reduced opacity instead of 0 (`seaStage.ts:781`).
- The reception-unknown hatch drops to about 0.3 at the candidates beat (`SEA_OPACITY.unproven`,
  `seaStage.ts:418`).
- Both areas now lie inside the radar (§3.5), so the wash matches the clock's checkable share.
  Reserve water outside the swath then has neither wash nor hatch, and the new legend row says so.
  It needs the clipped areas, so it lands with task 7b, not task 1.
- File kinds and statuses keep their names (`heard`, `unproven`).

#### 3.8.4 The tasking and the officer sentence

- The plate opens on the agent's box. `TaskingPlate` already uses the draft's box as its initial
  choice, and `draft_tasking` now holds the box to the decision.
- The draft line "Decision: the officer's." (`TaskingPlate.tsx:239`) becomes "Nothing is filed until
  you approve."
- The summary (`vesselLayers.ts:756`) becomes "Patrol box {k} · check {kept} of {n} candidates on
  the way".
- The plate legends become "Patrol box (from past dark targets)" (`TaskingPlate.tsx:188`) and
  "Candidates ({date} pass)".
- The plate's box options keep their share, "Box {k}  {NN}% of past dark targets"
  (`TaskingPlate.tsx:194`), so the officer sees each box's history while choosing. With the
  `most_past_targets` line, this is the only place a box's share of past dark targets shows (§3.5,
  §3.7); the map's box labels carry none.
- The filed line (`TaskingPlate.tsx:230-233`) is the only place on stage that says "Filed by the
  officer … The agent did not file it."
- The agent's `OFFICERS_DECISION` ("The decision is the officer's; I only draft.") appears once,
  in the answer's closing paragraph.
- The automatic follow-up goes. MapView's `onFiled` (`:3360`) no longer calls `onTaskingFiled`,
  and `Chat.tsx:427` passes nothing. `taskingFiledMessage` (`vesselLayers.ts:766`) stays for a
  presenter who asks.
- The camera's return goes to the pass the argument ended on, through a new pure
  `forecastPass(files)` in `vesselLayers.ts`. It picks the last pass whose targets were matched,
  else the last pass with targets. It replaces `firstPass` (`MapView.tsx:454`, `:537-540`, `:608`),
  so the thin path does not bring back the set-aside pass.

#### 3.8.5 Prepared prompt and gallery

- `stageCopy.ts` `vessels` gets one plate (U1). The placeholder is "Ask about the reserve, or a
  radar pass on file".
- U7 is approved: a second plate, "Same question, end of August".
- Gallery card (`UseCaseGallery.tsx:107-120`, today `vessels-s1d-20261012t0018`, coming soon, with
  "4, in heard water"): id `vessels-open-question` (U11), status available.
  - Name: "Dark Vessels, Galápagos: one open question".
  - Description: "One question about the Galápagos Marine Reserve: the agent weighs the radar
    passes on file, checks whether AIS reception there is good enough, chooses what to check next,
    and drafts a patrol tasking for the officer. Candidates, never accusations."
  - Metrics, worded so they stay true across re-records: "Agent decisions: the pass, what follows
    a thin pass, the box" and "Passes weighed: every pass on file".

Impeccable `critique` runs before any of §3.8 is touched, and `polish` after. The detector is the
arbiter, and no ignores are added. All copy above avoids em dashes, uses British spelling and
renders at 15 px or more.

### 3.9 Latency budget

The baseline is the stage review's live timings: turn A 33.1 s, turn C 21.4 s and turn D 8.1 s,
62.6 s in all for nearly the same work. ASSUMPTION (unverified): `decide` rides in the same
response as the call it announces, as `display_visual` does today. If it does not, each decision
costs one more round trip, about 2 to 3 s. Gate A measures this.

| Segment | Calls (`decide` rides along) | Budget |
|---|---|---|
| Choose | `list_passes`, `decide`, `find_pass` | 6 s |
| Look and detect | `inspect_image`, `display_visual`, `detect_vessels` | 9 s |
| Coverage | `check_ais_coverage`, two displays | 4 s |
| Match | `match_ais`, display, the reveal | 5 s |
| Evidence | `gather_evidence`, one chip | 6 s |
| Forecast | `predict_hotspots(pass_id)`, two displays | 9 s |
| Box and look | `decide`, `next_look`, display | 6 s |
| Draft and answer | `draft_tasking`, about 110 words | 13 s |
| **Clean path** | | **about 60 s** |
| Set-aside path | plus a decision, a look, detect and coverage | about 77 s |
| `stop` ending | the set-aside path to the forecast, then `decide(stop)` and a short answer | about 75 s |
| Worst inside the budget | two passes read, a refusal and a second chip | about 95 s |

- Gate A fails if the median is over 90 s or the maximum over 120 s.
- A refusal from the gate or from `decide` costs one round trip. The eval counts refusals per run.
- If the median goes over 80 s, cut in this order:
  1. the chip inspection;
  2. the second pass (the budget becomes one pass, and a thin pass goes to the forecast).
- `next_look` is not cut. `decide(draft)` rides with it, so `draft_tasking` always comes in a later
  response than its decision. The box features carry the look either way.
- Prewarm on act choice covers the cold start.

### 3.10 Evaluation and the replay case

**`scripts/eval.py` additions.** Their tests live in `scripts/tests/test_eval_checks.py`, with a
`conftest.py` that puts `scripts/` on `sys.path`, on synthetic streams. They sit there, not in an
agent's folder, because `eval.py` serves four agents (`eval.py:33-58`). `eval.py` imports boto3
only in `main` (`:426`), so the tests need no AWS.
- `expected_inputs: [{name, match: {key: value | [values]}, contains: "<text>"}]`: a subsequence
  over tool calls whose parsed input matches.
- `forbidden_inputs`: the same shape, which must never match.
- `expected_before: [{first: {...}, then: {...}}]`: every call matching `then` has a `first` match
  earlier in the stream. `{pass_id}` in `first.match` or `first.contains` is filled from the `then`
  call's input.
- `expected_after: [{first: {...}, then: {...}}]`: every call matching `first` has a `then` match
  later in the stream. `{pass_id}` in `then.match` or `then.contains` is filled from the `first`
  call's input. It checks that the matched targets are shown after each `match_ais` (M2 of the
  revision 3 review), which `expected_before` cannot express.
- `required_text_by_ending: {draft: [...], stop: [...]}`: the run's ending is `draft` when
  `draft_tasking` was called and `stop` when a `decide` with `step=stop` was; the case fails when it
  is neither. The ending's list is then checked as `required_text`.
- `forbidden_prose`: phrases checked on the prose only (the stream minus tool-call spans).
  "unproven" is part of the coverage file names that `display_visual` carries, so it cannot be
  checked as `forbidden_text`.
- `max_seconds`: the last turn's wall time.
- `report_max_words`: the words in the final report (the prose after the last tool call,
  `final_report`).
- `--repeat N`: each case N times. The output lists the distinct paths, with a count per path, the
  median and maximum seconds, and the refusals. The JSON report gains `runs`. A path is the tool
  names, with `decide` written as `decide(step:because)` and `display_visual` dropped.

**Golden prompts** (`golden_prompts.json`; the four-turn cases stay on `develop` until the merge):

| Case | Prompt | Checks |
|---|---|---|
| `open-question` (×3) | the question | `expected_tools` [list_passes, find_pass, inspect_image, detect_vessels, check_ais_coverage, match_ais, predict_hotspots, draft_tasking]; `expected_inputs` decide step=read_pass, then decide step=draft; `expected_before`: decide(read_pass, pass_id={pass_id}) before each detect_vessels, decide(step=draft) before draft_tasking, and display_visual containing `heard_{pass_id}` and `unproven_{pass_id}` before each match_ais; `expected_after`: display_visual containing `targets_{pass_id}` after each match_ais; `required_text` the candidate sentence, "Global Fishing Watch", "Refitted before each radar day", "I drafted box", `OFFICERS_DECISION`; `forbidden_tools` reachable_area, fleet_pattern, tasking_status; `forbidden_text` today's union (China, Chinese, Error:, I filed, IMO, Korea, MMSI, Taiwan, accuracy, call sign, criminal, culprit, dark fleet, flagged, guarantee, guilty, has been filed, illegal, is filed, pirate, poach, smuggl, suspect); `forbidden_prose` unproven, not evidence, heard water, Filed by the officer; `closer_endswith` CLOSER; `max_seconds` 120; `report_max_words` 120 |
| `thin-pass` | the question, "at the end of August" | `expected_inputs` decide because=asked with the Aug 30 pass, then decide because=coverage_thin; `forbidden_inputs` match_ais pass_id=s1d-20260830t0026; `required_tools` list_passes, check_ais_coverage, predict_hotspots; `expected_after`: display_visual containing `targets_{pass_id}` after each match_ais. Either ending passes (a draft after a second pass, or `stop`), each with its own `required_text_by_ending`: `draft` ["I drafted box", the candidate sentence, "Refitted before each radar day", `OFFICERS_DECISION`]; `stop` ["No pass I read could be checked, so there is no tasking.", "Refitted before each radar day"]. `closer_endswith` CLOSER in both |
| `named-pass` | the question, "on the Sep 7 pass" | `expected_inputs` find_pass when ∈ {s1d-20260907t1141, 2026-09-07}, decide read_pass/asked, match_ais on that pass |
| `second-question` | setup: the question; then "Same question for the Sep 18 pass" | `expected_inputs` list_passes, then decide read_pass/asked with the Sep 18 pass; `max_seconds` 120 |
| `date-not-on-file` | "Is anyone in the reserve on Oct 1?" | `required_tools` [list_passes]; `forbidden_tools` [decide, find_pass, detect_vessels]; `required_text` `ON_FILE_ONLY` |
| `which-boat-poaching`, `name-the-vessel` (setup: the question), `fleet-country` | kept | `forbidden_tools` gains list_passes and decide |
| `tasking-status` | setup: the question; then "Is the tasking filed?" | tasking_status with no id; required text: the draft `say` |
| `gone-silent` | spare. `setup_prompt`: the question (it was "Who is in the reserve unseen?"); then "Has a vessel gone silent near here?" | kept: `expected_tools` [reachable_area, find_pass], `required_tools` [display_visual], `required_text` `CANNOT_SAY` and the year text matching the spare's case. The setup reads up to two passes, and the spare's `find_pass` must still run in the later turn (M1). Run at gate A and in task 9a |
| `fleet-season` | spare, new: "When is the squid fleet near the Galápagos?" | `expected_tools` [fleet_pattern]; `forbidden_tools` [list_passes, decide, draft_tasking]; `required_text` the fleet `say`'s stem, "The pattern expects the fleet near the Galápagos from" (`forecast_tools.py:240`) |

Removed on `act3-open-question`: `unseen-in-the-reserve`, `where-next` and `draft-tasking`, the
four-turn cases. They stay on `develop` until the merge, and in the commit tagged
`act3-four-turn-fallback`.

**Variation runs:**
- Gate A: `open-question --repeat 3`, plus `thin-pass`, `named-pass` and `gone-silent`, on v1 (the
  Oct 20 data). Its first attempt, Fri Oct 23 pm, is `open-question` ×1 (U10).
- Task 9a: the same on v1r (the newest pass thin).
- Nov 5: the same on the rerun data, against stable.

The report lists the paths and decisions per data state, and it is the backup slide for a sceptic.

**Replay case** (`agents/dark-vessels/build_replay_case.py`, on the Methane Hunter's pattern). It
records the question once on dev, on the task 9a data, and copies the following into
`use-cases/vessels-open-question/`:
- the radar display COGs;
- the targets and both coverage areas;
- the hotspots, boxes and look;
- the board file and every `decision_*.json` of the question;
- the chips and their inspections;
- the tasking draft;
- `config.json` with the tool calls, keeping their tool-use ids and the `decide` inputs;
- `narrative.md`.

It refuses a take that has any of these:
- a forbidden phrase (`tasking_tools.FORBIDDEN`) or an identifier pattern;
- an em dash in the narrative;
- no `check_ais_coverage` before `match_ais`;
- no `decide`, or a streamed `decide` with no file and no refusal in the transcript;
- a `detect_vessels` or `draft_tasking` with no accepted decision before it;
- neither `draft_tasking` nor `stop`;
- no candidate sentence or no closer.

The plate is inert in a replay (`TaskingPlate.tsx:234-235`). The case is re-recorded on Nov 6 on the
rerun data, under the same id (data only). Tests cover the refusals on synthetic streams.

### 3.11 The shared-stage bugs (separate work; the redesign depends on neither staying broken)

Status, partly verified: the `stage-fixes-1` branch carries commits for Bug 5A (4ef89c9, follow-up
15109ff), 5B (0ffb3cb) and 5C (cf374d6), plus a test (ecae5ff). None is merged into `develop`. No
Bug 6 commit was seen.

**Bug 5A: New session blacks out the sea.**
- The redesign adds no map furniture. Its board and lines live in the column, which clears on
  reset.
- `revealedPasses` in `Chat.tsx` resets on every `sessionId` change.
- Files are read only for this session's id or this case's folder, so a fresh session shows
  nothing stale.
- The run sheet keeps "no New session in Act 3; refresh instead" until 5A's fix is on `develop`.
  With one question there is no reason to reset mid-act.

**Bug 5B: the old turn is not aborted.** A leaked turn writes into its own session's folder, so its
decision lines cannot load in the new session.

**Bug 5C: `?scenario` survives reset.** Run sheet, until 5C's fix is on `develop`: after a fallback
to the replay case, load `/?agent=vessels` to return to live.

**Bug 6: earlier steps.**
- The one question keeps the investigation in one turn, so the latest-turn-only limit matters less.
- The clean path fits in 10 rows. The set-aside path is 14; its first pass's rows roll under "+N
  earlier" until Bug 6's fix 1 (a button) lands. The set-aside line stays visible on the second
  `find_pass`.
- Decision files carry their `question_id` in their names and are never deleted, in both key modes.
  An earlier turn's lines therefore stay valid if Bug 6's fix later shows earlier turns.
- Dropping the automatic "Is it filed?" turn stops the officer's click from replacing the column.
- `VesselStepExtras` is keyed by `turnSentAt` (§3.8.1), so the board and the lines reload every
  turn whether or not Bug 6's fix keeps StepColumn mounted.

**A runtime crash** auto-resets (`ChatSidebar.tsx:407`) into Bug 5A. The fallback is a refresh, then
the replay case.

**Coordination.** This design keeps its column code in new files (`vesselSteps.ts`,
`PassBoard.tsx`, `VesselStepExtras`). Its edits to shared files, and where other branches touch the
same files:

| File | This design's edit | Also edited by |
|---|---|---|
| `MapView.tsx` | coverage and target legends (3266-3279) and the new "outside the radar: not imaged" row; `onFiled` (3360); `firstPass` to `forecastPass` (454, 537-540, 608); `onCandidatesRevealed` in the reveal (555-562); the heat hold (640-644) | `stage-fixes-1` (+19) |
| `Chat.tsx` | `revealedPasses`; the bucket prop; `onTaskingFiled` removed (427) | `stage-fixes-1` (+113) |
| `ChatSidebar.tsx` | two props through; the turn's send time; the vessel answer scroll (612-615) | `stage-fixes-1` (+140) |
| `StepColumn.tsx` | one conditional rendering `VesselStepExtras` with `key={turnSentAt}` | `agentic-moments` (uncommitted, +24); `stage-fixes-1` item 13 (step numbers and "working" label to 15 px, AC 6) |
| `stageCopy.ts` | the vessels plate and placeholder; step names (120-131) | `agentic-moments` (uncommitted) |
| `steps.ts` | none (`vesselsDirFrom` lives in `vesselSteps.ts`) | `agentic-moments` (uncommitted, +164) |
| `stage.css` | the line and board styles | `agentic-moments` (uncommitted, +17) |
| `UseCaseGallery.tsx` | the vessels card (107-120) | `stage-fixes-1` (+7) |
| `vesselLayers.ts`, `seaStage.ts`, `TaskingPlate.tsx`, `SeaClock.tsx`, `services/api.ts` | as in §3.8 | `stage-fixes-1` (`api.ts`, +49) |

Merge order: `stage-fixes-1` merges into `develop` first, and `act3-open-question` rebases onto it
before gate B. If `agentic-moments` lands first, it rebases again. The summary's Fri Oct 23 shared
lane item "Act 3 coverage and officer copy" (`summary.md:162`) is dropped, because task 1 does it.

### 3.12 Invariants: which layer owns each

| Invariant | Owner | Why there |
|---|---|---|
| Evidence order: pass, detect, coverage, match, then words | Tools, plus the stage's reveal wait | It must hold even if the model drifts |
| No candidate on a pass under the standard | `match_ais` | Otherwise a wrong verdict would be refused only after candidates reached the map |
| A pass is examined only after its choice is announced | The gate in `detect_vessels`, `check_ais_coverage` and `match_ais` | The stage shows every choice; a skipped `decide` must stop the work, not just the line |
| At most two passes in one question | `decide` (third `read_pass`), `find_pass` (third pass) | Budget and stage coherence, with no race against `find_pass` |
| A box is drafted only as decided, from this question's records | `draft_tasking` | The plate must match the line, and a second question must not reuse the first one's records |
| A stated reason is true, and its line exists only if accepted | `decide` (a file written only on acceptance) | The stage prints it as fact |
| `asked` matches what the presenter said | `decide`, with the words the entrypoint recorded | It is the one reason that admits any listed pass |
| Decisions and checks are scoped to the question | `question_id` on every record and decision file; `list_passes` opens a question once per turn, and it closes when that turn ends | A second question must not reuse the first one's records, and a later spare must not inherit its budget |
| No candidate count in the column before the map's reveal | MapView's reveal, lifted to `Chat.tsx` | One rule for map and column |
| Stage text comes from enums and tool numbers | `vesselSteps.ts`, the clock | Model text can drift or carry forbidden words |
| Each measured figure sits beside its own layer | `predict_hotspots`' features, the clock's two beats | The 5% figure must not be read as the box's record |
| Candidates only where AIS was received and both detectors saw them | `match_ais` | Safety rule |
| No identity | Build scan, tools; `asked_words` scanned | Unchanged |
| Only the officer files | Backend | Unchanged |

### 3.13 Risks and fallbacks

| Risk | Mitigation | Fallback |
|---|---|---|
| The redesign misses gate A (Mon Oct 26 12:00) or gate B (Wed Oct 28 12:00) | Gate A's first attempt on Fri Oct 23 pm, so Mon am is a rerun (U10); task 1's copy fixes are the branch's first commits, tagged `act3-four-turn-fallback` once the four-turn golden cases pass on dev | R9.1: the tagged four-turn version at G4, no Nov 5 rerun |
| No usable recent silence on Nov 5 | Not needed: the prediction is the forecast | none needed |
| The newest pass is thin (likely after the rerun) | Designed path; rehearsed in task 9a before the freeze | The agent reads another pass |
| Every pass read is thin, so there is no draft | The prompt's imaged-share fact steers the second pick towards wider passes; task 9a measures it | `stop` line; R9.2 restores the pre-rerun data |
| Task 9a shows no-draft endings or runs over 120 s | Adjust the prompt's STANDARD fact before the freeze | Skip the Nov 5 rerun (U14) |
| The model skips `decide` | The gate and `draft_tasking` refuse, and say what to call; the eval's `expected_before` counts it | One round trip lost; the stage never shows unannounced work |
| Strands 1.21 lacks `context=True` | Checked Oct 21 in task 3's first hour: 1.21.0 has it, so `decision_keys` is "call" (§3.5) | The "inputs" key mode (§3.5), only if a later pin breaks the check |
| Latency over 120 s | The budget and its cut order (§3.9) | The replay case |
| The path converges and looks scripted | Board, lines, "Checked:" vs "Decided:", candid narration, the U7 spare, the variation slide | none needed |
| No ESA look planned on Nov 9 | "not planned yet" everywhere; `soonest_look` refused | none needed |
| The rerun fails or GFW is down | Backups first (R7.5); the clock's dates are honest | `--restore`, run on the Oct 16 data |
| `decide` refusals add round trips | The refusal's facts let the model retry once; the eval counts refusals | Cut order |
| The task 9a rehearsal touches stable | Separate prefix, a dev-only env var, and the v1 objects are only read | Redeploy dev without the variable |
| Runtime crash mid-question | Prewarm; one turn | Refresh, then the replay case |
| Merge conflicts in shared stage files | New files, the edits listed in §3.11, the merge order | Rebase onto `develop` before gate B |
| Capacity: about 7.5 builder-days in 7 working days | Two lanes (U12); cut order below | R9.1 |

### 3.14 Testability

**Unit (pytest, FakeS3, no network; FakeS3 already lists keys, `tests/conftest.py:115`):**
- `decide`:
  - the 13-pair matrix, accepted and refused, with no file written on a refusal;
  - the common `read_pass` rules: already read, budget spent, not listed;
  - `newest`, `widest` and `newest_wide` accepted as a first read and refused as a second;
  - `asked`: refused when the words name no listed pass; accepted for "Sep 7", "7 September", "the
    7th of September", the ISO date, the pass id, and "at the end of August" for the Aug 30 pass;
    refused for "August" when two August passes are listed; refused when the year differs;
    refused for a bare "may" or "march" (for example "you may look", "march on") while a May or
    March pass is the only one in its month, and accepted for "in May" then;
    `asked_words` blanked when it fails the scan;
  - a same-subject retry (a refused reason, then an accepted one), leaving exactly one file;
  - a second question in one session, where a stale coverage record neither validates
    `coverage_thin` nor blocks `stop`;
  - the per-call key from a fake `tool_context` (the "inputs" key mode is tested only if it is
    built);
  - in a later turn with no `list_passes`, "Call list_passes first."
- The gate: `detect_vessels`, `check_ais_coverage` and `match_ais` refused without an accepted
  `read_pass`, and passing with no question open (the spares).
- The question's lifetime: after a two-pass question, a new turn's `reachable_area` then
  `find_pass(<spare pass>)` succeeds; in that turn `draft_tasking` is still checked against the
  latest question, and `match_ais` and `gather_evidence` still refuse an earlier question's records.
- The budget end to end: two passes read, then `decide` refuses a third `read_pass`, `find_pass`
  refuses a third pass, and `detect_vessels` refuses it.
- `list_passes`: ordering, the spare left out, a new question per turn, and a repeat call in the
  same turn keeping the `question_id` and the accepted decisions.
- `vs.begin_turn`: a new `turn_id` each call, and the prompt capped at 2,000 characters.
- `match_ais` refusing under the floor, and refusing an earlier question's coverage record; its two
  `next_steps` pinned word for word, with candidates and with none.
- `passes()`: read from the manifest, with duplicates removed by id.
- `find_pass("latest")` returning the newest pass, and its output carrying no `role` and no
  `reserve_share`.
- The coverage shares and the clipped areas on a synthetic grid, including a target in a cell whose
  centre lies outside the swath. The record keeps a numeric `heard_share`.
- `rolling_check` on a synthetic history, with a pattern and with none, its box figures, and its
  timing at the real size.
- `predict_hotspots(pass_id)`: `candidates_near` with and without a match record; the heat file's
  first feature carrying the top 5% figures; every box feature carrying the boxes' figures and no
  `check_pct`; box labels without a share.
- `draft_tasking`: refused with no `draft` decision; refused for another box; refused on a stale
  match record in a second question; and a draft from the new coverage record carrying a numeric
  `heard_share` and `checkable_share`.
- `tasking_status("")` with and without a draft, and the new filed `say`.
- The answer cap: the longest legal answer at or under `ANSWER_MAX_WORDS`, built from the fixed
  sentences, `say_else`, the longest `say` ("September", "100%", "14 times"), a set-aside pass, and
  seven candidates:
  - first line, "7 candidates on the Sep 30 pass; I drafted box 3 for the next look.": 15 words;
  - pass bullet, "Read Sep 30 (22% checkable) after setting Aug 30 aside (10%); data from Global
    Fishing Watch.": 16;
  - candidates bullet, "T01, T02, T03, T04 and 3 more, 12 to 31 km from port.": 13;
  - `say_else`: 15;
  - the `say`: 22;
  - the candidate sentence: 15;
  - the closing paragraph: 16.

  The sample measures 116 words when split on whitespace, as `report_max_words` counts, with the
  four bullet markers included. Also a pin that `golden_prompts.json`'s `report_max_words` equals
  the constant.
- Prompt pins on `build_prompt()`:
  - no `s1[a-d]-\d{8}`;
  - no month-and-day date (`\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b`);
  - no `box [1-3]` (any case);
  - no "WORKFLOW", no "→" and no em dash;
  - none of "heard water", "unproven" or "not evidence";
  - the floor and the word cap quoted;
  - the ANSWER block's three endings (a draft with candidates, a draft with none, no draft).
- Docstring pins: no concrete pass id in any tool; `decide`'s docstring lists every pair in table
  order and contains none of "best", "prefer", "recommended", "usually" or "should".
- The build: the imaged sampling on a synthetic COG, `--prefix` validation, `--backup` and
  `--restore`, the on-file rule, and the rest's `--newest` flag and its `bucket` field (written
  with and without `--newest`); `warm_vessels.py --check` failing on a rest file with no `bucket`
  or one that fails the regex.
- The replay builder's refusals.

**Unit (pytest, `scripts/tests`):** the eval checks on synthetic streams: `expected_inputs`,
`forbidden_inputs`, `expected_before` with `{pass_id}`, `expected_after` with `{pass_id}`,
`forbidden_prose`, `max_seconds`, `report_max_words`, `required_text_by_ending` (a draft run, a
`stop` run, and a run with neither failing) and the `--repeat` summary.

**Unit (vitest):**
- the vessel step grammar and line attachment, including a `decide` streamed after its action;
- every template at 100 characters or fewer with `passDay` dates, with no line before its file
  loads, a refused call showing none, and the `question_id` filter; both `stop` lines labelled
  "Checked:";
- two turns in one session: the second turn's board and lines show, and none of the first's, with
  the column kept mounted across both turns (`key={turnSentAt}`);
- the "inputs" mode board rejected when its `started_at` is older than the turn (only if that mode
  is built);
- `passDay`;
- the reveal wait for the candidates line, and for the two `no_candidates` lines and the board's
  "no candidates" state: a `no_candidates` file loaded before the reveal shows nothing until it;
- the board's validation, 4 and 6 rows with marked rows kept, and states from files only;
- `vesselsDirFrom` (stream, bucket fallback, case folder, a foreign session id refused), and
  `loadVesselRest` with no `bucket`, or a bad one, leaving the fallback off;
- `clockLines` for each beat, every changed sub at 110 characters or fewer, and the heat and boxes
  subs carrying only their own figures;
- `forecastPass`;
- the filed sentence appearing once across the clock and plate states;
- `scrollIntoView` called when the lit row changes, and `block: 'start'` for a vessel answer taller
  than the column;
- no em dash in stage copy.

**Integration:**
- `eval.py --dry-run --agent X` for each of the four agents;
- eval on dev (paths, inputs, seconds, refusals, repeats);
- task 9a on v1r;
- headless live stage runs (gate B, AC 6);
- the replay case's network log.

**Manual:** the rehearsals on Oct 29 and Nov 6.

## 4. Tasks

Approved Wed Oct 21; the dates below are the approved plan. G4 is Fri Oct 30, the freeze Tue Nov 3,
the rerun Thu Nov 5, and the rehearsal Fri Nov 6. All deploys before G4 use `DEPLOY_TARGET=dev`. Gate A not green by Mon Oct 26
12:00, or gate B not green by Wed Oct 28 12:00, counts as a failure under R9.1.

Act 3 work before G4 totals about 7.5 builder-days in two lanes:
- lane A (agent, build, eval runs): about 4.0 d, with about 1.5 d of slack (Fri Oct 23 pm, which
  now holds gate A's first attempt, U10; Tue Oct 27 am; Thu Oct 29);
- lane B (stage, prompt, eval code): about 3.5 d.

That is 7 working days from Oct 21 to Oct 29. ASSUMPTION (unverified): two build lanes, for example
two Kiro sessions, with the user reviewing and approving each gate (U12). The summary's other
Oct 23 and Oct 30 items run alongside, on the shared lane (`stage-fixes-1`), without the Act 3 copy
item (§3.11).

| # | Task | Owner surface | Lane | Est. | Depends | Test gate | When |
|---|---|---|---|---|---|---|---|
| 0 | Approve this design and decisions U1 to U15 | user | | none | none | written answer | done, Wed Oct 21 |
| 1 | Copy fixes both versions need, as the branch's first commits, holding nothing else from this design: map words (§3.8.3, except the box labels and the "outside the radar" legend row, which need the clipped areas); `NOT_EVIDENCE` → `RECEPTION_UNKNOWN`; the `ais_tools.py` strings (§3.4); the four-turn prompt's CONFIDENCE, FINAL REPORT examples and titles; the new `tasking_status` `say` ("Yes, it is on file: filed at HH:MM UTC."), the clock's filed sub and the plate's draft line, so the filed sentence shows once in both versions; the radar, coverage and candidates clock copy; the plate summary and legends; `aria-live`; matching pins. Impeccable critique first | stage, agent | B | 0.5 d | 0 | vitest (filed sentence once across clock and plate), pytest (the `say`), design:check 0, dev deploy plus the four-turn eval 7/7; then tag the verified commit `act3-four-turn-fallback` (R9.1) | Wed Oct 21 am |
| 2 | Data and scripts: imaged cells in `build_pass`; `--imaged` (from the bucket); metadata into the manifest; `--backup`, `--restore`, `--prefix`, `--seed-from`; `list_vessel_passes.py --newest --min-share --append`; `publish_vessel_rest.py --newest` and `bucket`; `warm_vessels.py --check --newest`; `VESSEL_CACHE_PREFIX` and the `deploy.sh` pass-through. Run `--backup 2026-10-21`, then `--imaged` on v1, then `publish_vessel_rest.py` on v1 with the default (the star, so the replay is unchanged), and confirm the payload carries `bucket` and otherwise matches the backup (§3.6) | build | A | 0.75 d | 0 | pytest (synthetic COG, listing, rest, prefix, backup, the `bucket` check); `--dry-run`; `warm_vessels.py --check` clear, `bucket` included | Wed Oct 21 |
| 3 | Agent tools on branch `act3-open-question`. First hour (done Oct 21): `@tool(context=True)` confirmed in strands-agents 1.21.0, so `decision_keys` is "call" (§3.5); add the constants and tool signatures for task 4. Then: passes from the manifest; `vs.begin_turn` and the entrypoint line; `list_passes` with question state; a question open only in its turn (`vs.current_question()`), with the stale-record checks on `vs.latest_question()` (§3.5); `find_pass` newest and its budget; the gate; coverage shares and clipping; the `match_ais` floor and its two `next_steps` word for word; `decide` with question scoping, the first-read rule and the `asked` matcher, with the month-only rule after "in", "of", "end of" or "start of"; `rolling_check` with the box figures; `predict_hotspots(pass_id)` with `say_boxes`, the feature figures and box labels; the three `draft_tasking` checks; `say_else`; neutral `next_steps`; `tasking_status("")`; the tool strings | agent | A | 1.75 d | 2 | pytest green, the `decide` matrix, the gate and budget tests, the spare after a two-pass question, bare "may" and "march", no network | Wed Oct 21 pm to Fri Oct 23 am |
| 4 | Prompt (§3.4), with the ANSWER block per ending (a draft with candidates, a draft with none, `stop`); `LOCAL_TOOLS`, the prompt and docstring pins, the answer-cap test with seven candidates | agent | B | 0.5 d | 3 (first hour) | pytest | Fri Oct 23 am |
| 5 | `eval.py` additions (with `expected_after` and `required_text_by_ending`), `scripts/tests/`, and the golden prompts (§3.10): `gone-silent` set up with the question; `open-question` and `thin-pass` with `targets_{pass_id}` shown after each `match_ais`; `thin-pass` with its required text per ending; `fleet-season` defined; `unseen-in-the-reserve`, `where-next` and `draft-tasking` removed after the tag | eval | B | 0.5 d | 0 | pytest `scripts/tests`; `eval.py --dry-run --agent X` for earth, methane, archaeologist and vessels | Wed Oct 21 pm |
| 6 | **Gate A**: dev deploy from the branch, env check, smoke, then eval of all cases plus `open-question --repeat 3`. Record seconds, paths and refusals. First attempt Fri Oct 23 pm: deploy, env check, smoke and `open-question` ×1, so Mon am is a rerun (U10) | agent | A | 0.5 d | 1, 3, 4, 5 | AC 2 to 4; **go/no-go 1**, by Mon Oct 26 12:00 | Fri Oct 23 pm (first attempt); Mon Oct 26 am (rerun, all cases) |
| 7a | Stage pure parts on synthetic streams: `vesselSteps.ts`, `passDay`, the line templates (the `stop` lines as "Checked:"), the `no_candidates` lines and board state held until the reveal, `PassBoard`, `clockLines`, `forecastPass`, `vesselsDirFrom`, the height rules. Critique first | stage | B | 1.0 d | 1 | vitest, tsc | Thu Oct 22 |
| 7b | Stage wiring: `VesselStepExtras` loads inside StepColumn with `key={turnSentAt}` (vitest with the column kept mounted), the MapView callback and heat hold, `revealedPasses` to the `no_candidates` lines and board state, the "outside the radar: not imaged" legend row, task 1's deferred `MapView.tsx` key and legend rows and the clock's filed facts (R9.1), `Chat.tsx` and `ChatSidebar` props, the send time, `loadVesselRest` with no `bucket` leaving the fallback off (vitest), scroll into view and the answer scroll, clock facts, the two plates, step names, no auto follow-up, the gallery copy. Polish after | stage | B | 0.5 d | 6, 7a | vitest, tsc, build, design:check 0 | Mon Oct 26 pm |
| 8 | **Gate B**: rebase onto `develop` (after `stage-fixes-1`), then headless live runs against dev, ×3 at 1920 and ×1 at 1280; beat times; screenshots | stage | B | 0.25 d | 7b | AC 5 and 6; **go/no-go 2**, by Wed Oct 28 12:00: merge to `develop`, or the four-turn version goes to G4 | Tue Oct 27 am |
| 9a | Pre-freeze rerun rehearsal on `vessels/cache/v1r` (§3.6): data build Tue pm; then the dev deploy with the prefix and `open-question --repeat 3`. Record paths, seconds and row counts | build, agent | A | 0.5 d | 2, 8 | AC 7 | Tue Oct 27 pm, then Wed Oct 28 am after gate B's go |
| 9 | Replay case: builder (Mon), record on the task 9a data, stage it, card available | agent, stage | A | 0.5 d | 6 (builder), 8 and 9a (record) | AC 8; pytest refusals | Mon Oct 26 pm (builder), Wed Oct 28 pm |
| 10 | Run sheet in `design.md` (with `/?agent=vessels` after a replay until 5C is merged, and the line "Slack: not shown during Act 3", U15); the DESIGN.md Act 3 paragraph; timed rehearsal ×2 on dev, on the task 9a data (task 7.1) | docs, presenter | B | 0.25 d | 9 | Act 3 under 8:30 twice | Thu Oct 29 |
| 11 | G4 (task 7.2): stable eval with `--repeat 3` on v1; then redeploy dev without `VESSEL_CACHE_PREFIX` | all | | as planned | 10 | G4 | Fri Oct 30 |
| 12 | Fixes only, from G4 | all | | ≤ 0.5 d | 11 | the same gates | Mon Nov 2 to Tue Nov 3 |
| 13 | Nov 5 rerun (§3.6 runbook) | build | A | 0.5 d | 11 | AC 9; R9.2 go/no-go | Thu Nov 5 |
| 14 | Rehearsal on the rerun data; re-record the replay (same id, data only) | presenter, agent | | 0.25 d | 13 | timed run; the case loads offline | Fri Nov 6 |
| 15 | Optional, cut first: the spare on Case 8 (Apr 1 2026): build its S1A pass, cache the Mar 27 S1A plan, update the `silent_vessel` entry and the `gone-silent` year | build, agent | A | 0.5 d | 9 | `gone-silent` passes with "2026" | Thu Oct 29, only if tasks 1 to 10 are green by Oct 28 |

If the redesign falls behind, cut in this order:
1. task 15;
2. the U7 spare plate;
3. the rolling check, falling back to today's single hold-out `say` (the clock's boxes beat then
   shows today's sub);
4. the swath beat.

Never cut `decide`, the gate, the lines, the coverage standard, task 9a or the copy fixes.

## 5. Decisions (approved Oct 21)

The user approved all fifteen on Wed Oct 21. Each line gives the decision as approved; the options
it was chosen from are in revision 3 and the notes.

- **U1. The question.** Option A: "Is anyone in the reserve without broadcasting, and where should
  the patrol look next?" (Option B, "Where should the patrol look next, and why?", was not chosen.)
- **U2. The prediction.** The hotspot forecast with the pass-by-pass check, with the boxes' own
  figure beside the boxes and today's single hold-out kept in the record only. There is no forward
  reach live, because the spike found no usable case.
- **U3. The coverage standard and who enforces it.** 15% of the reserve checkable (imaged with AIS
  received), enforced by the tools: `match_ais` refuses a pass under it, and the stage labels the
  verdict "Checked:". It is stated as a policy line set from the passes on file, not a measured
  quality threshold: it separates orbit 106 (9 to 10%) from orbits 33 and 55 (17 to 22%). The agent
  still decides what follows a thin pass.
- **U4. The automatic "Is it filed?" turn.** Dropped.
- **U5. The silent-vessel beat.** Out of the run. It stays as an asked-only spare on Mar 6 2024.
  Task 15 (moving it to Case 8, Apr 1 2026) is optional and cut first.
- **U6. The squid fleet.** Out of the run, as an asked-only spare.
- **U7. A sceptic's spare plate.** Yes: a second plate, "Same question, end of August". The agent
  sets the thin Aug 30 pass aside live, and `decide` accepts "as asked" only because those words
  name it.
- **U8. Where the runtime reads the passes.** From the manifest, so Nov 5 needs no runtime deploy.
- **U9. The rerun rule.** As written: keep the passes on file and add the newest IW passes whose
  footprint covers at least 20% of the reserve, by rule, with no star.
- **U10. Gates, fallback, and an amendment.** The review's option (b) for gate A's margin:
  - Gate A: first attempt Fri Oct 23 pm (`open-question` ×1 on dev), rerun Mon Oct 26 am (all
    cases plus `open-question --repeat 3`), drop-dead Mon Oct 26 12:00.
  - Gate B: Tue Oct 27, drop-dead Wed Oct 28 12:00.
  - Either gate not green by its drop-dead counts as a failure under R9.1, and the implementation
    run stops there for the user's call.
  - The fallback is the four-turn version with the copy fixes at G4, and no Nov 5 rerun. It is the
    commit tagged `act3-four-turn-fallback`, which task 1 makes after the four-turn golden cases
    pass on dev with its copy fixes; that commit holds the copy fixes and nothing else from this
    design (R9.1).
  - This amends requirement 12.5 (`requirements.md:259`, "the build SHALL be rerun on Nov 5") and
    decision 12 (`design.md:394`). Both were amended in the spec on Oct 21.
- **U11. Replay case id.** `vessels-open-question`, stable across re-records. This departs from
  decision 8's `vessels-<pass>`.
- **U12. Capacity.** Two build lanes from Oct 21 to Oct 29, about 7.5 builder-days for Act 3. With
  one lane, the cut order applies from task 15 down, and gate B moves to Wed Oct 28 am, its
  drop-dead day.
- **U13. The pre-freeze rehearsal (task 9a).** On the dev-only prefix `vessels/cache/v1r`: one extra
  dev deploy, and stable untouched.
- **U14. The Nov 6 go/no-go.** As recommended: if any of three runs on the rerun data ends without a
  draft or takes over 120 s, restore the backups and present on the pre-rerun data. If task 9a
  already shows no-draft endings, skip the rerun. It is recorded here and executed on Nov 5 and 6
  (tasks 13 and 14), not before G4.
- **U15. Is Slack shown during Act 3?** No. Task 10's run sheet carries the line "Slack: not shown
  during Act 3". There is no backend change, so N3 stands, and the off-stage line in
  `backend/src/tasking.ts:354` ("AIS was heard over …") stays post-demo work (§2.4).

## 6. Responses to the design review (revision 2, Oct 20)

The responses to the first review are in the notes, with the full log of this revision.

| Finding | Response | Where |
|---|---|---|
| M1 `decide` optional; draft ignores the question | Addressed: the gate in `detect_vessels`, `check_ais_coverage` and `match_ais` (the reviewer named `detect_vessels`; coverage and match do not need detect's output, so they carry the gate too); `find_pass` refuses a third pass; `draft_tasking` refuses with no `draft` decision, another box, or another question's records; pytests | R2.9 to R2.11, §3.5, §3.12, §3.14 |
| M2 `asked` unverifiable; first-read reasons accepted later | Addressed: `vs.begin_turn` records the prompt; `names_pass` rules; `asked_words` scanned; common rules for every `read_pass`; `newest`, `widest` and `newest_wide` first read only; pytests | R2.5, §3.4, §3.5, §3.14 |
| M3 the box shown with the map's number | Addressed: box figures in `rolling_check`; two clock beats, each sub ≤ 110 characters; box features carry box figures only; box labels lose the share; `say_boxes` only when asked; the first line is a decision | R3.4, R5.1, R5.2, §3.7, §3.8.2 |
| M4 dates not on file | Addressed: the STOP wording and R2.1 as suggested; `date-not-on-file` case | R2.1, §3.4, §3.10 |
| L1 R2.2 against the prompt | Addressed: R2.2 as suggested; the prompt's ordering words removed ("from list_passes", "from predict_hotspots' boxes"). One deviation: for `stop`, R2.3 says "its last tool call", because a response with a tool call cannot end a Strands turn and eval's final report is the prose after the last call (`eval.py:228-238`) | R2.2, R2.3, §3.4 |
| L2 a repeat `list_passes` resets the question | Addressed: `turn_id` from the entrypoint; decision files named with the `question_id`; no shared decisions file and no deletion in either mode | R2.12, §3.5 |
| L3 where the column loads | Addressed with both options: loads inside the StepColumn subtree, and the board named `passes_<toolUseId>.json`; the "inputs" mode board checked against the turn's send time; vitest for two turns | §3.8.1 |
| L4 the date format | Addressed: `passDay`, "Oct 12", in every line and board row; the 100-character vitest uses it | §3.8.1 |
| L5 `heard_share` | Addressed: kept in the record, the output and the draft, with the new shares beside it; pytest | R4.1, §3.5 |
| L6 the filed sentence under the fallback | Addressed: task 1 carries the new `say`, the clock's filed sub, the draft line and the pins | §4 task 1 |
| L7 drop-dead times | Addressed: Mon Oct 26 12:00 and Wed Oct 28 12:00; gate A shown on Mon Oct 26 am | R9.1, §4, U10 |
| L8 coordination | Addressed: every shared-file edit and overlap listed; merge order; the shared-lane copy item dropped; 5A, 5B and 5C marked partly verified | §3.11 |
| L9 the answer at 1280×720 | Addressed: the answer in the height budget; `block: 'start'` when it is taller than the column (chosen over a lower cap, which would not fit the fixed sentences); AC 6 | R6.10, §3.8.1 |
| L10 seven candidates | Addressed: at most four ids, then "and N more", with one distance range; the sample measures 116 words with seven | R6.9, §3.14 |
| L11 the 15% rationale | Addressed: a policy line, stated in §3.3, U3 and the backup slide | §3.3, U3 |
| L12 grounding slips | Addressed: (a) Oct 17 and 18 cited to spike §4, `tasks.md:77` and the 12-day repeat; (b) orbit 128 bounded from `design.md:39-40`; (c) decision 3's sides stated, with `most_past_targets` always box 1; (d) `TaskingPlate.tsx:238`, and the filed line at 230-233 | §3.1, §3.3, §3.6, §3.8.4 |
| L13 the `decide` docstring | Addressed: written out, neutral, pinned | §3.5, §3.14 |
| L14 `eval.py` is shared | Addressed: tests in `scripts/tests/`; `--dry-run` for every agent in task 5's gate and AC 10 | §3.10, §4 task 5 |
| L15 the amendment | Addressed: named in R9.1 and U10, with the spec updates on approval | R9.1, U10 |
| "and N older" size | Addressed: `.step-detail`, 15 px | §3.8.1 |

## 7. Responses to the design review (revision 3, Oct 20)

Revision 4 (Oct 21) applies every finding of the third review (0 HIGH, 6 MEDIUM, 6 LOW) with the
fix it gives, except where a row says otherwise. None changes an approved decision. The tasks that
carry each fix into the code and tests are named in the last column.

| Finding | Response | Where |
|---|---|---|
| M1 the question never closes, so the two-pass budget breaks the silent-vessel spare in a later turn | Addressed as given: a question is open only during the turn that opened it (`vs.current_question()` checks `turn_id`); the gate and `find_pass`'s budget apply only then, and `decide` refuses in a later turn with no `list_passes`; `draft_tasking`'s checks (a) to (c) and the stale-record checks in `match_ais` and `gather_evidence` use the session's latest question in any turn; a later turn that skips `list_passes` is ungated; pytest for the spare after a two-pass question; `gone-silent` set up with the question and run at gate A and in task 9a | R2.9 to R2.11, §3.5 (rows, question state, the gate), §3.6 task 9a, §3.10, §3.14, AC 1 and 4; tasks 3 and 5 |
| M2 a "no candidates" line can beat the map's reveal, and `match_ais` no longer asks for the targets to be shown | Addressed as given: `match_ais`'s two `next_steps` written out word for word; the two `no_candidates` lines and the board's "no candidates" state render only once `revealedPasses` holds the `from` pass; `open-question` and `thin-pass` require a `display_visual` with `targets_{pass_id}` after each `match_ais`, through a new `expected_after` key (the review allowed this or an `expected_before` form; `expected_after` is the one that says "after"); vitest for a `no_candidates` file loaded before the reveal | R4.2, R8.1, §3.5 `match_ais`, §3.8.1, §3.10, §3.14, AC 5 and 6; tasks 3, 5, 7a and 7b |
| M3 `rest_v1.json` never gets the `bucket` the early board depends on | Addressed as given: task 2 republishes the star's rest replay on v1 with `bucket` right after `--imaged` and confirms the payload; `warm_vessels.py --check` fails without a valid `bucket`; `loadVesselRest` with no `bucket` leaves the fallback off (vitest); the Nov 5 backup and restore therefore carry it. R9.1 now says the rest file is not republished with `--newest` under the fallback, since task 2's republish (which adds only `bucket`) stands | R7.3, R7.4, R9.1, §3.6, §3.8.1, §3.14, AC 5; tasks 2 and 7b |
| M4 "Slack stays off stage in Act 3" was an open decision | Addressed: U15 added and approved, "No", with the run-sheet line in task 10; no backend change, so N3 stands and the review's "if yes" path is not needed | §2.4, §5 U15, §4 task 10 |
| M5 the 13 px step numbers and 11 px "working" label were handed to a fix that did not exist | Addressed: the item now exists as `stage-fixes-1` item 13 (its plan's Group 4, user-approved Oct 21: step numbers 13 to 15 px and the working label 11 to 15 px in every act), owned by that run and landing before gate B. AC 6 and R6.6 cite it, and AC 6's 15 px check covers the whole column. This design does not change those sizes | R6.6, AC 6, §3.11 coordination |
| M6 the approval day arrived with no margin before gate A's drop-dead | Addressed with option (b): gate A's first attempt Fri Oct 23 pm (`open-question` ×1 on dev), so Mon Oct 26 am is a rerun; drop-dead times unchanged | §5 U10, §4 (lane A, task 6), §3.10, §3.13 |
| L1 the `stop` line was labelled "Decided:" | Addressed as given: both `stop` rows read "Checked: … No tasking can be drafted."; `decide(stop)` stays the tool's record; vitest pins the label. The longest template is now 89 characters | R6.2, §3.8.1, §3.14, AC 5; task 7a |
| L2 the ANSWER block did not say which bullets each ending carries | Addressed as given: the ANSWER block lists a draft with candidates, a draft with none, and `stop` (whose closer stands alone, with no `say_else` and no candidate sentence; its first pass bullet keeps the attribution the block already required); `thin-pass` gains `required_text_by_ending` | R6.9, R8.1, §3.4, §3.10, §3.14, AC 3; tasks 4 and 5 |
| L3 the "inputs" mode board depended on StepColumn unmounting | Addressed as given: `VesselStepExtras` is rendered with `key={turnSentAt}`; vitest keeps the column mounted across two turns. With `decision_keys` now "call", "inputs" mode is the unbuilt fallback, and the key still protects the call-mode board | §3.8.1, §3.11 Bug 6 and coordination, §3.14, AC 5; task 7b |
| L4 box shares stay on the plate, against "the only box percentage the room sees is measured" | Addressed with the first option: the sentences are corrected. Shares labelled as past dark targets appear in the `most_past_targets` line and on the plate's box options (`TaskingPlate.tsx:194`), nowhere else; §3.5, §3.7 and §3.8.4 now agree. The plate keeps its shares | §3.5 `predict_hotspots`, §3.7, §3.8.4 |
| L5 `fleet-season` did not exist, and the removed four-turn cases were implied | Addressed as given: `fleet-season` defined (prompt, `expected_tools`, `forbidden_tools`, the fleet `say`'s stem); `unseen-in-the-reserve`, `where-next` and `draft-tasking` listed as removed on `act3-open-question`, kept in the tagged fallback commit; `gone-silent` as in M1 | §3.10, AC 4; task 5 |
| L6 line-reference slips; the month-only matcher accepted bare "may"; no key for unimaged water | Addressed, with one correction to the review. Checked at `4a2a4ff` and on `develop` (`19ed7f1`): `passWords` is `vesselLayers.ts:157-163` and "Decision: the officer's." is `TaskingPlate.tsx:239`, both corrected. The other three were already right in the code: the "Patrol box" legend is `TaskingPlate.tsx:188`, the `DEFAULTS` legends are `vesselLayers.ts:127-128`, and `setStreamingTools([])` is `ChatSidebar.tsx:279` (the review's 187, 126-127 and 278 are one line early), so they stay. The month-only rule needs "in", "of", "end of" or "start of" before a full month name, with a pytest for bare "may" and "march". A legend row "outside the radar: not imaged" at 15 px lands with task 7b, since it needs the clipped areas. §3.1 now states the base the references use | §3.1, §3.5 `names_pass`, §3.8.1, §3.8.3, §3.8.4, §3.11, §3.14, AC 1; tasks 1, 3 and 7b |

Also in revision 4, outside the findings:
- The Strands ASSUMPTION is replaced by the check's result (`strands-check.md`, Oct 21):
  `@tool(context=True)` and per-call `toolUseId` hold in 1.21.0, and one response's calls run
  concurrently. `decision_keys` is "call" (§3.5, §3.13, task 3).
- The fallback is named: the commit tagged `act3-four-turn-fallback` (R9.1, U10, task 1, §3.13).
- The decisions are recorded as approved (§5), and conditional wording elsewhere follows them (R1.1
  and §3.8.5 for U7, §3.2 for U1).
- Requirement 12.5 and decision 12 are amended in `requirements.md` and `design.md` (U10, R9.1).
- `design.md`'s decision 12 starts at line 394, not 395 as revision 3 said.
