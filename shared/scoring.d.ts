export interface ScoreSummary {
  day: number;
  cash: number;
  installedGpu: number;
  capacity: number;
  progress: number;
  totalRevenue: number;
  dailyProfit: number;
  won: boolean;
  lost: boolean;
}

export interface ScoreComponent {
  key: 'revenue' | 'cashflow' | 'capacity' | 'build' | 'cash' | 'goal' | 'speed';
  label: string;
  max: number;
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  components: ScoreComponent[];
  summary: ScoreSummary;
  maxScore: number;
}

export function capacityOf(state: unknown): number;
export function summarize(state: unknown): ScoreSummary;
export function gradeOf(score: number): ScoreResult['grade'];
export function evaluate(state: unknown): ScoreResult;
export function isPlausibleState(state: unknown): boolean;
