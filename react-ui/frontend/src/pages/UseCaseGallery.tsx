import { useNavigate } from 'react-router-dom';
import { SHOW_ACTS, actFor } from '../utils/acts';
import './gallery.css';

interface Scenario {
  id: string;
  name: string;
  description: string;
  icon: string;
  metrics: {
    label: string;
    value: string;
  }[];
  status: 'available' | 'coming-soon';
  /** The act the case belongs to; the stage switches to it when the case loads. */
  agent?: string;
}

// Act 1, the Earth Analyst: the live demo runtime's id (AGENT_RUNTIMES, the backend's default).
// A backend without it plays these cases on its default act instead (utils/caseAgent.ts).
const EARTH_ANALYST = 'stable';

const scenarios: Scenario[] = [
  {
    id: 'la-fires-2025',
    name: 'LA Palisades Fire',
    description: 'Wildfire damage analysis in Pacific Palisades, California (January 2025)',
    icon: '/palisades_fire.png',
    // The recorded take (Oct 21, geospatial_agent_dev v32), its own tools: calculator and
    // calculate_environmental_impact (46,072,800 m² new burn), run_bandmath on the 2025-01-12 scene
    // (high severity 81,475,200 m², 31.9% of the 16 km frame).
    metrics: [
      { label: 'New burn since Nov 2024', value: '46.1 km²' },
      { label: 'High severity, Jan 12', value: '8,147.5 ha (31.9%)' },
    ],
    status: 'available',
    agent: EARTH_ANALYST,
  },
  {
    id: 'earth-places-like-central-park',
    name: 'Places like Central Park',
    description: 'Search by example: Clay embeddings rank the places across New York State that look most like Central Park, and the agent looks at its top two',
    icon: '/places_like_central_park.png',
    // The recorded take (Oct 21, geospatial_agent_dev v32): find_similar_places compared 190,329
    // cells for July 2025; rank 1 at cosine 0.9573, named West Point by reverse_geocode.
    metrics: [
      { label: 'Cells Compared', value: '190,329' },
      { label: 'Top Match', value: 'West Point, 0.957' },
    ],
    status: 'available',
    agent: EARTH_ANALYST,
  },
  {
    id: 'amazon-deforestation',
    name: 'Amazon Deforestation',
    description: 'Deforestation-free sourcing verification in Brazilian Amazon (2020-2025)',
    icon: '/amazon_eudr.png',
    metrics: [
      // { label: 'Field Area', value: '3,574 hectares' },
      // The narrative's net loss of dense and very dense forest (15.71 km² is the 2025 dense area, a gain).
      { label: 'Forest lost since 2020', value: '8.28 km² (23.2% of field)' },
      { label: 'EUDR Status', value: 'Non-Compliant' },
    ],
    status: 'available',
    agent: EARTH_ANALYST,
  },
  {
    id: 'lake-mead-water',
    name: 'Lake Mead Drought',
    description: 'Water level analysis at Lake Mead reservoir (2020-2025)',
    icon: '/lake_mead_drought.png',
    metrics: [
      // { label: 'Water Loss', value: '31.5 km² (10.9%)' },
      { label: 'Exposed Lakebed', value: '+33.9 km² (19.6%)' },
      { label: 'Drought Severity', value: 'Severe' },
    ],
    status: 'available',
    agent: EARTH_ANALYST,
  },
  {
    id: 'methane-permian-2024',
    name: 'Permian Basin Methane',
    description: 'The strongest methane plume NASA EMIT saw over the Permian Basin in 2024, and the ground beneath it',
    icon: '/methane_permian.png',
    // The recorded take (Oct 21, methane_hunter_dev v43): search_methane_plumes found 39 complexes,
    // triage_plumes ranked the strongest at 8,130.7 ppm·m.
    metrics: [
      { label: 'Plume Complexes', value: '39 in 2024' },
      { label: 'Strongest Peak', value: '8,130.7 ppm·m' },
    ],
    status: 'available',
    agent: 'methane',
  },
  {
    id: 'methane-watch-mission',
    name: 'Methane Watch brief',
    description: 'One prompt, the whole mission: a global baseline, TROPOMI tips over nine watch areas, EMIT cued on the two strongest, three ground-record checks and a draft brief for the analyst',
    icon: '/methane_watch.png',
    // The recorded take (Oct 21, methane_hunter_dev v43): 9 areas scanned, Shanxi and the south
    // Caspian cued; the brief follows Shanxi (check_recent_passes: 4 of 8 passes read since
    // 2025-01-01 are candidates, the latest 2025-11-30).
    metrics: [
      { label: 'Watch Areas', value: '9 scanned, 2 cued' },
      { label: 'Candidate Passes', value: '4 of 8 at Shanxi since 2025' },
    ],
    status: 'available',
    agent: 'methane',
  },
  {
    id: 'archaeologist-newark',
    name: 'Newark Earthworks',
    description: 'The Octagon Earthworks from space, then under the grass: 1 m LiDAR shows the eight-sided enclosure and its circle beneath a former golf course. A site already on the World Heritage list.',
    icon: '/newark_earthworks.png',
    // From the public record (Ohio History Connection; UNESCO 2023).
    metrics: [
      { label: 'Octagon Encloses', value: '50 acres (documented)' },
      { label: 'Designation', value: 'World Heritage, 2023' },
    ],
    status: 'available',
    agent: 'archaeologist',
  },
  {
    id: 'archaeologist-great-circle',
    name: 'The Great Circle, measured',
    description: 'The Great Circle Earthworks measured across on 1 m LiDAR: the bank and the interior ditch in metres, beside what the record says',
    icon: '/great_circle.png',
    // The recorded take (dev): 362 m measured bank to bank; the record says nearly 1,200 ft (about 366 m).
    metrics: [
      { label: 'Bank to Bank', value: '362 m (366 m documented)' },
      { label: 'Bank and Ditch', value: '+2.6 m, −2.7 m' },
    ],
    status: 'available',
    agent: 'archaeologist',
  },
  {
    // The one open question (redesign §3.8.5, U11: the id stays across re-records). The metrics are
    // worded to stay true on any take. Recorded on dev by agents/dark-vessels/build_replay_case.py.
    id: 'vessels-open-question',
    name: 'Dark Vessels, Galápagos: one open question',
    description: 'One question about the Galápagos Marine Reserve: the agent weighs the radar passes on file, checks whether AIS reception there is good enough, chooses what to check next, and drafts a patrol tasking for the officer. Candidates, never accusations.',
    icon: '/dark_vessels.png',
    metrics: [
      { label: 'Agent decisions', value: 'the pass, what follows a thin pass, the box' },
      { label: 'Passes weighed', value: 'every pass on file' },
    ],
    status: 'available',
    agent: 'vessels',
  },
];

/** The page's acts, in show order, each with the cases that play on it (the Act 3 card included). */
function casesByAct() {
  return SHOW_ACTS.map((act) => ({
    act,
    id: `replay-act-${act.roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    cases: scenarios.filter((scenario) => actFor(scenario.agent)?.roomName === act.roomName),
  })).filter((group) => group.cases.length > 0);
}

/**
 * Replay cases (S10): recorded runs grouped by act in show order. Each available case is one
 * button that covers its card (the whole card opens it; Tab, Enter and Space work natively); the
 * button is quiet at rest and lit amber only under the pointer or the keyboard's focus, so one
 * call to action at most is amber (the One Spotlight Rule). A case still being recorded says
 * "Coming soon" and has no button.
 */
export function UseCaseGallery() {
  const navigate = useNavigate();

  const handleScenarioClick = (scenario: Scenario) => {
    if (scenario.status === 'available') {
      navigate(`/?scenario=${scenario.id}${scenario.agent ? `&agent=${scenario.agent}` : ''}`);
    }
  };

  return (
    <div className="page-content gallery">
      <div className="gallery__inner">
        <h1 className="gallery__title">Replay cases</h1>
        <p className="gallery__lead">
          Recorded runs of each act. A replay shows what the agent did without calling it again; the map still needs
          the network.
        </p>
        {casesByAct().map(({ act, id, cases }) => (
          <section key={id} className="gallery__act" aria-labelledby={id}>
            <h2 id={id} className="gallery__act-name">
              {act.roomName}
            </h2>
            <ul className="gallery__cases">
              {cases.map((scenario) => {
                const available = scenario.status === 'available';
                return (
                  <li key={scenario.id} className={`case-card${available ? '' : ' case-card--soon'}`}>
                    <img className="case-card__image" src={scenario.icon} alt="" width={640} height={360} />
                    <h3 className="case-card__name">{scenario.name}</h3>
                    <p className="case-card__description">{scenario.description}</p>
                    {scenario.metrics.length > 0 && (
                      <dl className="case-card__metrics">
                        {scenario.metrics.map((metric) => (
                          <div key={metric.label} className="case-card__metric">
                            <dt>{metric.label}</dt>
                            <dd>{metric.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {available ? (
                      <button
                        type="button"
                        className="case-card__open"
                        aria-label={`Open the replay: ${scenario.name}`}
                        onClick={() => handleScenarioClick(scenario)}
                      >
                        Open the replay
                      </button>
                    ) : (
                      <p className="case-card__soon">Coming soon</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
