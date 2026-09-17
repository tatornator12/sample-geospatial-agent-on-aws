/**
 * The exhibit rail: a 56px strip across the top of the stage.
 * Title at left, sections (routes) centre, quiet sign-out at right.
 * The active section is lit amber with an underline; nothing else on the rail carries colour.
 */
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { theme } from '../theme';
import { logout } from '../utils/auth';

const RAIL_HEIGHT = 56;

export function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sections = [
    { path: '/', label: 'Stage' },
    { path: '/use-cases', label: 'Replay cases' },
    { path: '/technology', label: 'How it works' },
  ];

  return (
    <nav
      aria-label="Primary"
      style={{
        height: `${RAIL_HEIGHT}px`,
        flex: `0 0 ${RAIL_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${theme.spacing.lg}`,
        backgroundColor: theme.colors.background,
        borderBottom: `1px solid ${theme.colors.outline}`,
        position: 'relative',
        zIndex: 100,
      }}
    >
      <Link
        to="/"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: theme.spacing.sm,
          textDecoration: 'none',
        }}
      >
        <span
          style={{
            ...theme.typography.titleLarge,
            fontSize: '20px',
            color: theme.colors.onBackground,
          }}
        >
          Agentic AI for Earth
        </span>
        <span
          style={{
            ...theme.typography.labelCaps,
            color: theme.colors.secondary,
          }}
        >
          on AgentCore
        </span>
      </Link>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: theme.spacing.xs, height: '100%' }}>
        {sections.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive ? 'page' : undefined}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                padding: `0 ${theme.spacing.md}`,
                color: isActive ? theme.colors.primary : theme.colors.secondary,
                textDecoration: 'none',
                ...theme.typography.labelLarge,
                transition: theme.transitions.short,
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = theme.colors.onBackground;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = theme.colors.secondary;
              }}
            >
              {item.label}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: theme.spacing.md,
                  right: theme.spacing.md,
                  bottom: 0,
                  height: '2px',
                  backgroundColor: theme.colors.primary,
                  transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
                  transformOrigin: 'left center',
                  transition: `transform ${theme.transitions.medium}`,
                }}
              />
            </Link>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.lg }}>
        <button
          onClick={handleLogout}
          style={{
            padding: `6px ${theme.spacing.md}`,
            color: theme.colors.secondary,
            border: `1px solid ${theme.colors.outline}`,
            borderRadius: theme.borderRadius.md,
            ...theme.typography.labelLarge,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.colors.onBackground;
            e.currentTarget.style.borderColor = theme.colors.outlineVariant;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.colors.secondary;
            e.currentTarget.style.borderColor = theme.colors.outline;
          }}
        >
          Sign out
        </button>
        <img
          src="/AWS_logo_RGB_1c_White.png"
          alt="AWS"
          style={{ height: '22px', width: 'auto', opacity: 0.85 }}
        />
      </div>
    </nav>
  );
}
