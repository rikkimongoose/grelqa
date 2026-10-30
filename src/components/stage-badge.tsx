import { stageLabels, type Stage } from "@/lib/contests";

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge badge-${stage}`}><span aria-hidden="true">●</span> {stageLabels[stage]}</span>;
}
