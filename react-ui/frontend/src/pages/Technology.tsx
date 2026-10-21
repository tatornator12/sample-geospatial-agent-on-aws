/**
 * "How it works" (S11): one screen for a mixed room, saying what the intro deck's slide 4 says,
 * in the same order. One AgentCore runtime per agent; a foundation model choosing and chaining
 * the agent's tools over real data; the data each act works with (show order, the room's names);
 * the shared map stage and the session files in S3; and the person who decides. Every claim is
 * the fact sheet's (facts.md, Platform facts and Per act); nothing internal.
 */
import { SHOW_ACTS } from '../utils/acts';
import './technology.css';

// What each act works with, by the act's room name (facts.md, "Data sources" per act).
const DATA: Record<string, string> = {
  'Earth Analyst':
    'Sentinel-2 imagery, vegetation, water and burn indices, change scans, and Clay embeddings to find places that look alike.',
  'AI Archaeologist':
    'USGS 3DEP 1 m LiDAR prepared ahead of time, Sentinel-2, and sites already on the public record (UNESCO, the National Park Service, state and tribal stewards).',
  'Methane Watch':
    'TROPOMI for a wide tip, NASA EMIT passes for a close look, then night-time heat, mapped infrastructure and a public facility registry.',
  'Dark Vessels':
    "Sentinel-1 radar passes and Global Fishing Watch AIS, read ahead of time, and ESA's published plans for the next radar look.",
};

export function Technology() {
  return (
    <div className="page-content how">
      <div className="how__inner">
        <h1 className="how__title">How it works</h1>
        <p className="how__lead">
          Four agents, one map. Each agent runs on its own Amazon Bedrock AgentCore runtime. A foundation model reads the
          question, then chooses the agent's tools and chains them over real data. A person makes the decisions.
        </p>

        <div className="how__columns">
          <section aria-labelledby="how-data">
            <h2 id="how-data" className="how__heading">
              What each agent works with
            </h2>
            <dl className="how__agents">
              {SHOW_ACTS.map((act) => (
                <div key={act.roomName} className="how__agent">
                  <dt>{act.roomName}</dt>
                  <dd>{DATA[act.roomName]}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div>
            <section aria-labelledby="how-turn">
              <h2 id="how-turn" className="how__heading">
                How a turn runs
              </h2>
              <p>
                The model picks a tool, reads its result and decides the next step, until it can answer. How freely it
                chooses varies: the Earth Analyst picks its own tools, dates and scenes; the archaeologist follows a set
                path but picks the line it measures; the methane mission follows a set plan over live data.
              </p>
              <p>
                Every step, layer and image it looked at lands on the shared map stage, and the session's files are kept
                in Amazon S3.
              </p>
              <p>Replay cases are recorded runs: they load without calling the agents.</p>
            </section>

            <section aria-labelledby="how-person">
              <h2 id="how-person" className="how__heading">
                A person decides
              </h2>
              <p>
                An agent can draft, but it never files. The analyst files the methane brief, and the officer approves
                the patrol tasking. The stage's backend does the filing, not the model.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
