import { useNavigate } from 'react-router-dom';
import { theme } from '../theme';

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

const scenarios: Scenario[] = [
  {
    id: 'la-fires-2025',
    name: 'LA Palisades Fire',
    description: 'Wildfire damage analysis in Pacific Palisades, California (January 2025)',
    icon: '/palisades_fire.png',
    metrics: [
      { label: 'Total Area Burned', value: '21,000 acres' },
      // { label: 'Structures at Risk', value: '4,200 buildings' },
      { label: 'High Severity Burn', value: '29.4%' },
    ],
    status: 'available',
  },
  {
    id: 'amazon-deforestation',
    name: 'Amazon Deforestation',
    description: 'Deforestation-free sourcing verification in Brazilian Amazon (2020-2025)',
    icon: '/amazon_eudr.png',
    metrics: [
      // { label: 'Field Area', value: '3,574 hectares' },
      { label: 'Dense Vegetation Loss', value: '15.71 km² (44.0%)' },
      { label: 'EUDR Status', value: 'Non-Compliant' },
    ],
    status: 'available',
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
  },
  {
    id: 'methane-permian-2024',
    name: 'Permian Basin Methane',
    description: 'The strongest methane plume NASA EMIT saw over the Permian Basin in 2024, and the ground beneath it',
    icon: '/methane_permian.png',
    metrics: [
      { label: 'Plume Complexes', value: '39 in 2024' },
      { label: 'Strongest Peak', value: '8,130.7 ppm·m' },
    ],
    status: 'available',
    agent: 'methane',
  },
  {
    id: 'methane-watch-south-caspian',
    name: 'Methane Watch brief',
    description: 'One prompt, the whole mission: a global baseline, a TROPOMI tip, EMIT cued on recent passes, a self-check and a draft brief for the analyst',
    icon: '/methane_watch.png',
    metrics: [
      { label: 'Candidate Passes', value: '4 of 4 since 2025' },
      { label: 'Strongest Peak', value: '9,144.0 ppm·m' },
    ],
    status: 'available',
    agent: 'methane',
  },
];

export function UseCaseGallery() {
  const navigate = useNavigate();

  const handleScenarioClick = (scenario: Scenario) => {
    if (scenario.status === 'available') {
      navigate(`/?scenario=${scenario.id}${scenario.agent ? `&agent=${scenario.agent}` : ''}`);
    }
  };

  return (
    <div className="page-content" style={{ padding: theme.spacing.xxl }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h2
          style={{
            ...theme.typography.headlineLarge,
            marginBottom: theme.spacing.sm,
            color: theme.colors.onBackground,
          }}
        >
          Featured Impact Scenarios
        </h2>
        <p
          style={{
            ...theme.typography.bodyLarge,
            color: theme.colors.secondary,
            marginBottom: theme.spacing.xl,
          }}
        >
          Pre-loaded satellite analysis scenarios with quantifiable environmental impact metrics
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: theme.spacing.lg,
          }}
        >
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              onClick={() => handleScenarioClick(scenario)}
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.md,
                padding: theme.spacing.lg,
                boxShadow: theme.elevation.level1,
                transition: theme.transitions.medium,
                cursor: scenario.status === 'available' ? 'pointer' : 'not-allowed',
                opacity: scenario.status === 'coming-soon' ? 0.6 : 1,
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (scenario.status === 'available') {
                  e.currentTarget.style.boxShadow = theme.elevation.level3;
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = theme.elevation.level1;
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {/* Image Header */}
              <div
                style={{
                  width: '100%',
                  height: '180px',
                  backgroundColor: theme.colors.surfaceVariant,
                  borderRadius: theme.borderRadius.sm,
                  marginBottom: theme.spacing.md,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <img
                  src={scenario.icon}
                  alt={scenario.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
                {scenario.status === 'coming-soon' && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: theme.spacing.md,
                      padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.borderRadius.sm,
                      ...theme.typography.bodyMedium,
                      color: theme.colors.secondary,
                    }}
                  >
                    Coming Soon
                  </div>
                )}
              </div>

              {/* Title */}
              <h3
                style={{
                  ...theme.typography.titleLarge,
                  marginBottom: theme.spacing.xs,
                  color: theme.colors.onSurface,
                }}
              >
                {scenario.name}
              </h3>

              {/* Description */}
              <p
                style={{
                  ...theme.typography.bodyMedium,
                  color: theme.colors.secondary,
                  marginBottom: theme.spacing.md,
                }}
              >
                {scenario.description}
              </p>

              {/* Metrics */}
              {scenario.metrics.length > 0 && (
                <div
                  style={{
                    borderTop: `1px solid ${theme.colors.outlineVariant}`,
                    paddingTop: theme.spacing.md,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing.xs,
                  }}
                >
                  {scenario.metrics.map((metric, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          ...theme.typography.bodyMedium,
                          color: theme.colors.secondary,
                        }}
                      >
                        {metric.label}
                      </span>
                      <span
                        style={{
                          ...theme.typography.labelLarge,
                          color: theme.colors.onSurface,
                          fontWeight: 600,
                        }}
                      >
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* CTA Button for available scenarios */}
              {scenario.status === 'available' && (
                <div
                  style={{
                    marginTop: theme.spacing.md,
                    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                    backgroundColor: theme.colors.primary,
                    color: theme.colors.onPrimary,
                    borderRadius: theme.borderRadius.sm,
                    textAlign: 'center',
                    ...theme.typography.labelLarge,
                    fontWeight: 600,
                  }}
                >
                  View Analysis →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
