import { aiExplanation, aiPercentage } from "@/lib/story-annotations";
export function AiGeneration({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return <span className="ai-generation"><span>AI-генерация: {aiPercentage(value)}%</span><span className="ai-explanation">{aiExplanation}</span></span>;
}
