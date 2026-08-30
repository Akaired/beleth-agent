import { levelForXp, RANKS, type ProgressRow } from "@/lib/progress";
import { IconChat, IconHistory, IconTrendUp } from "@/components/icons";

/**
 * The experience bar shown under the avatar on the account page: current title,
 * level, fill toward the next rank, login streak, and the two ways to earn XP.
 * Pure markup — no client hooks.
 */
export function ExperienceBar({ progress }: { progress: ProgressRow }) {
  const info = levelForXp(progress.xp);
  const maxed = info.next === null;
  const pct = Math.round(info.fraction * 100);
  const streak = progress.streak_days;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
            Lv {info.rank.level}
          </span>
          <span className="text-[15px] font-medium tracking-[-0.01em] text-txt">
            {info.rank.title}
          </span>
        </div>
        <span className="font-mono text-[11px] text-sec">
          {info.xp.toLocaleString("en-US")} XP
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-chipbg"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          maxed
            ? `${info.rank.title} — highest rank`
            : `${pct}% to ${info.next?.title}`
        }
      >
        <div
          className="h-full rounded-full bg-acc transition-[width] duration-500"
          style={{ width: `${maxed ? 100 : Math.max(pct, 2)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
        {maxed ? (
          <span className="text-acc">Highest rank reached.</span>
        ) : (
          <span>
            {info.xpToNext.toLocaleString("en-US")} XP to{" "}
            <span className="text-sec">{info.next?.title}</span>
          </span>
        )}
        {streak > 0 && (
          <span className="flex items-center gap-1 text-sec">
            <IconHistory size={11} />
            {streak}-day streak
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3 text-[11.5px] text-sec">
        <span className="flex items-center gap-2">
          <IconTrendUp size={13} className="text-dim" />
          Show up daily — +10 XP, plus a streak bonus up to +14.
        </span>
        <span className="flex items-center gap-2">
          <IconChat size={13} className="text-dim" />
          Talk to Beleth — +3 XP per message, up to 10 a day.
        </span>
      </div>
    </div>
  );
}

/** The full ladder, rendered as a compact reference list. */
export function RankLadder({ xp }: { xp: number }) {
  const current = levelForXp(xp).rank.level;
  return (
    <ol className="flex flex-col gap-0.5">
      {RANKS.map((r) => {
        const reached = xp >= r.minXp;
        const isCurrent = r.level === current;
        return (
          <li
            key={r.level}
            className={`flex items-center justify-between gap-3 rounded px-2 py-1 text-[12px] ${
              isCurrent
                ? "bg-hoverbg text-txt"
                : reached
                  ? "text-sec"
                  : "text-dim"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-[9.5px] tabular-nums text-dim">
                {String(r.level).padStart(2, "0")}
              </span>
              {r.title}
            </span>
            <span className="font-mono text-[10px] tabular-nums">
              {r.minXp.toLocaleString("en-US")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
