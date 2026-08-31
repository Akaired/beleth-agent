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
  Flag as IconStrategy,
  SlidersHorizontal as IconControls,
  HardDrives as IconServer,
  Cpu as IconCpu,
  Thermometer as IconTemp,
  TerminalWindow as IconLogs,
  FunnelSimple as IconFilter,
  SignOut as IconSignOut,
  SignIn as IconSignIn,
  Lightning as IconLive,
  Broadcast as IconBroadcast,
  Pulse as IconPulse,
  CurrencyDollarSimple as IconEquity,
  TrendUp as IconTrendUp,
  TrendDown as IconTrendDown,
  StackSimple as IconPositions,
  CalendarBlank as IconCalendar,
  CalendarDots as IconTradeCalendar,
  CalendarCheck as IconMarketCalendar,
  Sun as IconSun,
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
  CaretDown as IconCaretDown,
  Crown as IconCrown,
  Bell as IconBell,
  House as IconHome,
  User as IconAccount,
  ShieldStar as IconAdmin,
  FileText as IconDocs,
  UsersThree as IconForum,
  ChartBar as IconReports,
  Gear as IconSettings,
  ArrowRight as IconArrowRight,
  ArrowLeft as IconArrowLeft,
  ArrowUp as IconArrowUp,
  ArrowDown as IconArrowDown,
  ArrowUpRight as IconArrowUpRight,
  DotsSixVertical as IconDragHandle,
  Scales as IconScales,
  Target as IconTarget,
  Door as IconExit,
  Database as IconData,
  BookOpenText as IconStrategy,
  Flask as IconResearch,
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
  ChatCircleText as IconChat,
  ChatsCircle as IconChats,
  Plus as IconPlus,
  Trash as IconTrash,
  ThumbsUp as IconThumbsUp,
  ThumbsDown as IconThumbsDown,
  Copy as IconCopy,
  Check as IconCheck,
  PencilSimple as IconPencil,
  ArrowSquareOut as IconExternal,
  PaperPlaneTilt as IconPublish,
  ArrowUUpLeft as IconUnpublish,
  TextT as IconHeading,
  PushPin as IconPin,
  PushPinSlash as IconUnpin,
  LockSimpleOpen as IconLockOpen,
  FolderSimple as IconFolder,
} from "@phosphor-icons/react/dist/ssr";

/**
 * Beleth's own mark — the pixel sprite, not a Phosphor glyph. Same prop shape
 * as a Phosphor icon (`size` / `className`; `weight` accepted and ignored) so
 * it drops into the nav's icon slot. Desaturated by default so it reads as a
 * quiet nav glyph next to the monochrome Phosphor set; pass `vivid` for the
 * full-colour mascot.
 */
export function IconBeleth({
  size = 16,
  className = "",
  vivid = false,
}: {
  size?: number;
  weight?: "regular" | "bold" | "fill";
  className?: string;
  vivid?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/beleth.png"
      alt=""
      aria-hidden="true"
      width={size}
      style={{ width: size, height: "auto" }}
      className={`shrink-0 [image-rendering:pixelated] ${
        vivid ? "" : "grayscale opacity-60"
      } ${className}`}
    />
  );
}
