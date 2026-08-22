import { useMemo } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { AnnotatedTransaction } from "./types";
import {
  groupByDetailed,
  groupByPrimaryCategory,
  isSpending,
  titleCase,
} from "./lib/transactions";

const PALETTE = [
  "#4ade80",
  "#60a5fa",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#34d399",
  "#f87171",
  "#38bdf8",
  "#fb923c",
  "#c084fc",
];

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

interface Props {
  txns: AnnotatedTransaction[];
  drillPrimary: string | null;
  onDrill: (primary: string | null) => void;
}

export default function CategoryChart({ txns, drillPrimary, onDrill }: Props) {
  const spendingTxns = useMemo(() => txns.filter(isSpending), [txns]);

  const data = useMemo(() => {
    if (drillPrimary) {
      return groupByDetailed(spendingTxns, drillPrimary).map((b) => ({
        key: b.detailed,
        label: titleCase(b.detailed),
        value: b.total,
      }));
    }
    return groupByPrimaryCategory(spendingTxns).map((b) => ({
      key: b.primary,
      label: titleCase(b.primary),
      value: b.total,
    }));
  }, [spendingTxns, drillPrimary]);

  const total = useMemo(
    () => data.reduce((sum, d) => sum + d.value, 0),
    [data]
  );

  if (spendingTxns.length === 0) {
    return (
      <div className="card category-chart">
        <h2>Spending by category</h2>
        <p className="empty-state">
          No spending in this range yet. If you just linked an institution, Plaid
          may still be backfilling — try again in a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="card category-chart">
      <div className="category-chart-header">
        <h2>
          {drillPrimary ? titleCase(drillPrimary) : "Spending by category"}
        </h2>
        {drillPrimary && (
          <button
            className="link-button chart-back"
            onClick={() => onDrill(null)}
          >
            ← Back
          </button>
        )}
      </div>
      <div className="category-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={1}
              stroke="#0f1115"
              onClick={(entry: any) => {
                if (!drillPrimary && entry?.payload?.key) {
                  onDrill(entry.payload.key);
                }
              }}
            >
              {data.map((entry, idx) => (
                <Cell
                  key={entry.key}
                  fill={PALETTE[idx % PALETTE.length]}
                  cursor={drillPrimary ? "default" : "pointer"}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#15171d",
                border: "1px solid #22252c",
                borderRadius: 8,
              }}
              formatter={(value: number) => formatCurrency(value)}
            />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              wrapperStyle={{ fontSize: "0.75rem" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="category-chart-total">
          <span className="category-chart-total-label">
            {drillPrimary ? "Subtotal" : "Total"}
          </span>
          <span className="category-chart-total-value">
            {formatCurrency(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
