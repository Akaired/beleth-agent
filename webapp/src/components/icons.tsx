/**
 * Central icon set. One import path for the whole app so the library is
 * swappable in one file. Phosphor's SSR build — plain components, no context —
 * so these render in Server and Client Components alike. Pass `size` (px or
 * `"1em"`, the default) and `weight` ("regular" | "bold" | "fill" | …);
 * colour follows `currentColor`.
 */
export {
  Gauge as IconOverview,
  ListChecks as IconDecisions,
  SlidersHorizontal as IconStrategy,
  HandPalm as IconControls,
  SignOut as IconSignOut,
  Lightning as IconLive,
  Broadcast as IconBroadcast,
  Pulse as IconPulse,
  CurrencyDollarSimple as IconEquity,
  TrendUp as IconTrendUp,
  TrendDown as IconTrendDown,
  StackSimple as IconPositions,
  CalendarBlank as IconCalendar,
  ArrowsClockwise as IconCycles,
  Receipt as IconTrades,
  ShieldWarning as IconRefused,
  ShieldCheck as IconShieldCheck,
  Prohibit as IconProhibit,
  CheckCircle as IconCheckCircle,
  XCircle as IconXCircle,
  Warning as IconWarning,
  Play as IconResume,
  Pause as IconPause,
  CaretRight as IconCaretRight,
  CaretLeft as IconCaretLeft,
  ArrowRight as IconArrowRight,
  ArrowUpRight as IconArrowUpRight,
  Scales as IconScales,
  ChartLineUp as IconChart,
  ClockCounterClockwise as IconHistory,
  Eye as IconEye,
  MagnifyingGlass as IconSearch,
  Envelope as IconEnvelope,
  LockSimple as IconLock,
  Code as IconCode,
  GithubLogo as IconGithub,
  List as IconMenu,
  X as IconClose,
} from "@phosphor-icons/react/dist/ssr";
